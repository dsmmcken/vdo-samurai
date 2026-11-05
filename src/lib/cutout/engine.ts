// Background removal for the presenter's camera overlay, and the morph
// between the cutout and the boxed shapes. Runs in a worker: the live
// overlay's (worker.ts) or the final render's.
//
// Each camera picture goes to the GPU once, as a mipmapped texture. The
// cutout's framing is drawn from it at 256x256 and read back for the selfie
// segmenter (segmenter.ts, on the CPU in WebAssembly). Its mask goes back up as
// a texture, and one shader draws the picture through it: the mask's edge is
// snapped to edges in the picture (a joint bilateral filter, as video-call
// backgrounds do) and cut with a one-pixel anti-aliased edge. The same shader
// draws the morph's clips (overlay.ts).
//
// Two qualities: 'live' segments every frame while that's cheap and skips
// frames on slow machines; 'best' (the final render) segments every frame
// twice, as is and mirrored, averages the two, and filters the edge wider.
import modelUrl from '../../assets/selfie_segmenter.tflite?url';
import kernelsUrl from '../nn/kernels.wasm?url';
import type { CutLayout } from '../overlay';
import { SEG_SIZE, Segmenter } from './segmenter';

export type Quality = 'live' | 'best';

const QUALITY = {
  // keep: share of the last mask kept each frame (less flicker, a little lag).
  live: { keep: 0.4, radius: 3, mirrored: false, budgetMs: 12 },
  best: { keep: 0.3, radius: 4, mirrored: true, budgetMs: Infinity },
};

const abs = (u: string) => new URL(u, self.location.href).href;

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// Textures: row 0 is the top of the picture, like the camera and the mask.
const SEG_FS = `#version 300 es
precision highp float;
uniform sampler2D uCam;
uniform vec4 uRect;
uniform float uLod;
out vec4 o;
void main() {
  o = textureLod(uCam, uRect.xy + gl_FragCoord.xy / ${SEG_SIZE}.0 * uRect.zw, uLod);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D uCam;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform vec4 uMap;
uniform float uLod;
uniform vec4 uSeg;
uniform vec4 uBg;
uniform float uBgR;
uniform vec4 uPerson;
uniform float uPersonR;
uniform float uStep;
uniform int uRadius;
out vec4 o;
// Coverage of a rounded rectangle (x, y, w, h; radius r), anti-aliased.
float cover(vec2 p, vec4 b, float r) {
  vec2 h = b.zw * 0.5;
  r = min(r, min(h.x, h.y));
  vec2 q = abs(p - b.xy - h) - h + r;
  return clamp(0.5 - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r), 0.0, 1.0);
}
vec2 camAt(vec2 p) { return p * uMap.xy + uMap.zw; }
float maskAt(vec2 uv) {
  vec2 m = (uv - uSeg.xy) / uSeg.zw;
  return m == clamp(m, 0.0, 1.0) ? textureLod(uMask, m, 0.0).r : 0.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec3 c0 = textureLod(uCam, camAt(p), uLod).rgb;
  float bg = uBg.z > 0.0 ? cover(p, uBg, uBgR) : 0.0;
  float pc = cover(p, uPerson, uPersonR);
  // Each mask sample is weighted by distance and by how close its colour is
  // to this pixel's, so the edge follows the picture rather than the coarse mask.
  float m = 0.0;
  if (pc > 0.0 && bg < 1.0) {
    float s2 = float(uRadius * uRadius) * 0.9;
    float sum = 0.0;
    float wsum = 0.0;
    for (int j = -uRadius; j <= uRadius; j++) {
      for (int i = -uRadius; i <= uRadius; i++) {
        vec2 q = camAt(p + vec2(float(i), float(j)) * uStep);
        vec3 d = textureLod(uCam, q, uLod).rgb - c0;
        float w = exp(-float(i * i + j * j) / s2 - dot(d, d) * 60.0);
        sum += w * maskAt(q);
        wsum += w;
      }
    }
    m = sum / wsum;
  }
  float e = clamp(fwidth(m), 0.01, 0.25);
  float a = max(bg, smoothstep(0.6 - e, 0.6 + e, m) * pc);
  o = vec4(c0 * a, a);
}`;

/**
 * Draws the cutout (or a morph) onto `canvas`, transparent elsewhere, with
 * premultiplied alpha. `ready` settles once the model has loaded; until then
 * only the background part of a morph can show.
 */
export class CutoutEngine {
  readonly ready: Promise<void>;
  private gl: WebGL2RenderingContext;
  private seg: Segmenter | null = null;
  private q: (typeof QUALITY)[Quality];
  private vao: WebGLVertexArrayObject;
  private segProg: WebGLProgram;
  private drawProg: WebGLProgram;
  private cam: WebGLTexture;
  private camW = 0;
  private camH = 0;
  private fresh = false;
  private segFb: WebGLFramebuffer;
  private pixels = new Uint8Array(SEG_SIZE * SEG_SIZE * 4);
  private mask: WebGLTexture;
  private smooth: Float32Array | null = null;
  private bytes = new Uint8Array(SEG_SIZE * SEG_SIZE);
  private segMs = 0;
  private runs = 0;
  private sinceSeg = Infinity;
  private closed = false;

  constructor(
    readonly canvas: OffscreenCanvas,
    quality: Quality,
  ) {
    this.q = QUALITY[quality];
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.segProg = program(gl, SEG_FS);
    this.drawProg = program(gl, DRAW_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.cam = texture(gl, gl.LINEAR_MIPMAP_LINEAR);
    this.mask = texture(gl, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SEG_SIZE, SEG_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, this.bytes);
    const segTex = texture(gl, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SEG_SIZE, SEG_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.segFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.segFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, segTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.ready = Segmenter.load(abs(modelUrl), abs(kernelsUrl)).then((seg) => {
      if (!this.closed) this.seg = seg;
    });
  }

  /** Whether a mask has been found yet (the person can show). */
  get masked() {
    return this.smooth !== null;
  }

  /** Forgets the mask: the next picture is segmented afresh, with nothing carried over. */
  reset() {
    this.smooth = null;
    this.sinceSeg = Infinity;
  }

  /** A new camera picture (the caller still owns it). */
  setFrame(frame: VideoFrame) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cam);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.camW = frame.displayWidth;
    this.camH = frame.displayHeight;
    this.fresh = true;
  }

  /**
   * Draws `layout` (stage pixels, overlay.ts) over a `w` x `h` canvas
   * covering its bounds, finding the person in the latest picture first if
   * it's new. Returns whether the person could be drawn (a mask exists).
   */
  draw(layout: CutLayout, w: number, h: number): boolean {
    const gl = this.gl;
    const vw = this.camW;
    const vh = this.camH;
    if (!vw || !vh) return false;
    if (this.fresh && this.seg) {
      this.fresh = false;
      if (++this.sinceSeg * this.q.budgetMs >= this.segMs) this.segment(layout);
    }

    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Stage pixels to canvas pixels, and canvas pixels back to the camera.
    const { bounds: b, map, seg } = layout;
    const s = w / b.w;
    const f = map.flip ? -1 : 1;
    const box = (x: Box | null): [number, number, number, number, number] => (x ? [(x.x - b.x) * s, (x.y - b.y) * s, x.w * s, x.h * s, x.r * s] : [0, 0, 0, 0, 0]);
    const camPerPx = 1 / (s * map.k); // camera pixels per canvas pixel
    const p = this.drawProg;
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cam);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.uniform1i(u('uCam'), 0);
    gl.uniform1i(u('uMask'), 1);
    gl.uniform2f(u('uSize'), w, h);
    gl.uniform4f(u('uMap'), (f * camPerPx) / vw, camPerPx / vh, (map.hu + (f * (b.x - map.px)) / map.k) / vw, (map.hv + (b.y - map.py) / map.k) / vh);
    gl.uniform1f(u('uLod'), Math.max(0, Math.log2(camPerPx)));
    gl.uniform4f(u('uSeg'), seg.x / vw, seg.y / vh, seg.w / vw, seg.h / vh);
    const [bx, by, bw, bh, br] = box(layout.bg);
    gl.uniform4f(u('uBg'), bx, by, bw, bh);
    gl.uniform1f(u('uBgR'), br);
    const [px, py, pw, ph, pr] = box(layout.person);
    gl.uniform4f(u('uPerson'), px, py, pw, ph);
    gl.uniform1f(u('uPersonR'), pr);
    // Filter taps about a mask pixel apart (finer for 'best', which takes more).
    const maskPx = (seg.w / SEG_SIZE) * map.k * s;
    gl.uniform1f(u('uStep'), Math.max(1, (maskPx * 3) / this.q.radius));
    gl.uniform1i(u('uRadius'), this.q.radius);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.masked;
  }

  close() {
    this.closed = true;
    this.seg = null;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Finds the person in the cutout's framing of the current picture. */
  private segment(layout: CutLayout) {
    const gl = this.gl;
    const seg = this.seg!;
    const { seg: c } = layout;
    const t0 = performance.now();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.segFb);
    gl.viewport(0, 0, SEG_SIZE, SEG_SIZE);
    gl.useProgram(this.segProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cam);
    gl.uniform1i(gl.getUniformLocation(this.segProg, 'uCam'), 0);
    gl.uniform4f(gl.getUniformLocation(this.segProg, 'uRect'), c.x / this.camW, c.y / this.camH, c.w / this.camW, c.h / this.camH);
    gl.uniform1f(gl.getUniformLocation(this.segProg, 'uLod'), Math.max(0, Math.log2(Math.max(c.w, c.h) / SEG_SIZE)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, SEG_SIZE, SEG_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);

    let conf = seg.run(this.pixels);
    if (this.q.mirrored) {
      conf = conf.slice();
      const flipped = seg.run(this.pixels, true);
      for (let i = 0; i < conf.length; i++) conf[i] = (conf[i] + flipped[i]) / 2;
    }
    const keep = this.smooth ? this.q.keep : 0;
    const sm = (this.smooth ??= new Float32Array(conf.length));
    const out = this.bytes;
    for (let i = 0; i < conf.length; i++) {
      sm[i] = conf[i] + (sm[i] - conf[i]) * keep;
      out[i] = sm[i] * 255 + 0.5;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SEG_SIZE, SEG_SIZE, gl.RED, gl.UNSIGNED_BYTE, out);

    // The first run warms up (compiles); judge the cost from the ones after.
    const ms = performance.now() - t0;
    if (this.runs++) this.segMs = this.segMs ? this.segMs * 0.8 + ms * 0.2 : ms;
    this.sinceSeg = 0;
  }
}

type Box = CutLayout['person'];

function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`cutout shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`cutout program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function texture(gl: WebGL2RenderingContext, min: number) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
