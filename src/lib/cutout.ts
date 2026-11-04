// Background removal for the presenter's camera overlay, entirely on the GPU.
//
// MediaPipe's selfie segmenter runs in this canvas's own WebGL2 context, so its
// person mask comes back as a texture we can sample directly: no readback. A
// shader blends it with the last frame's (less flicker), and another draws the
// camera through it, cropped like any framed view, fading out at the bottom
// where the body is cut off. Used by the live overlay and by the final cut.
import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import loaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import modelUrl from "../assets/selfie_segmenter.tflite?url";

/** How much of the overlay's height the head fills: less than other views, so shoulders show. */
export const CUTOUT_FILL = 0.4;

/** Share of the last mask kept each frame. */
const KEEP = 0.4;
/** Masks are stored at most this wide; sampled with linear filtering, so edges stay soft. */
const MASK_MAX_W = 640;

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

const abs = (u: string) => new URL(u, self.location.href).href;

// The wasm loader hands its factory over through a global, so loads go one at a time.
let loading: Promise<unknown> = Promise.resolve();
function loadSegmenter(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<ImageSegmenter> {
  const next = loading.then(async () => {
    const [{ ImageSegmenter }, loader] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      import(/* @vite-ignore */ abs(loaderUrl)),
    ]);
    // An ES module loader works in module workers too, where importScripts doesn't.
    (self as unknown as { ModuleFactory: unknown }).ModuleFactory =
      loader.default;
    const seg = await ImageSegmenter.createFromOptions(
      { wasmLoaderPath: "", wasmBinaryPath: abs(wasmUrl) },
      {
        canvas,
        baseOptions: { modelAssetPath: abs(modelUrl), delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      },
    );
    // By default it resizes the canvas to every input, which we'd then undo: twice the cost per frame.
    for (const v of Object.values(seg))
      if (typeof v?.setAutoResizeCanvas === "function")
        v.setAutoResizeCanvas(false);
    return seg;
  });
  loading = next.catch(() => {});
  return next;
}

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Mask rows run top-down, like the camera texture (and MediaPipe's mask).
const MASK_FS = `#version 300 es
precision highp float;
uniform sampler2D uConf;
uniform sampler2D uPrev;
uniform float uKeep;
in vec2 uv;
out vec4 o;
void main() {
  o = vec4(mix(texture(uConf, uv).r, texture(uPrev, uv).r, uKeep), 0.0, 0.0, 1.0);
}`;

const DRAW_FS = `#version 300 es
precision highp float;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec4 uCrop;
uniform float uMirror;
in vec2 uv;
out vec4 o;
void main() {
  vec2 b = vec2(uv.x, 1.0 - uv.y);
  vec2 s = uCrop.xy + vec2(uMirror > 0.5 ? 1.0 - b.x : b.x, b.y) * uCrop.zw;
  float a = smoothstep(0.3, 0.7, texture(uMask, s).r);
  a *= smoothstep(0.0, 0.18, 1.0 - b.y) * smoothstep(0.0, 0.04, min(b.y, min(b.x, 1.0 - b.x)));
  o = vec4(texture(uVideo, s).rgb * a, a);
}`;

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

/**
 * Draws a camera with its background removed onto `canvas` (transparent
 * elsewhere, premultiplied alpha). `ready` settles once the model has loaded;
 * until then `draw` only clears.
 */
export class Cutout {
  readonly ready: Promise<void>;
  private gl: WebGL2RenderingContext;
  private seg: ImageSegmenter | null = null;
  private clock = 0;
  private vao: WebGLVertexArrayObject;
  private maskProg: WebGLProgram;
  private drawProg: WebGLProgram;
  private video: WebGLTexture;
  private masks: [Target, Target] | null = null;
  private closed = false;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    // Ours before MediaPipe's: it then shares this context, with these settings.
    const offscreen =
      typeof OffscreenCanvas !== "undefined" &&
      canvas instanceof OffscreenCanvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: offscreen,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.maskProg = program(gl, MASK_FS);
    this.drawProg = program(gl, DRAW_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.video = texture(gl);
    this.ready = loadSegmenter(canvas).then((seg) => {
      if (this.closed) seg.close();
      else this.seg = seg;
    });
  }

  /**
   * Segments `src` and draws the `crop` of it (source pixels) over the whole
   * canvas, resized to `w` x `h`. `at` is a timestamp in ms; it must not go
   * backwards. Returns false if nothing was drawn (model not loaded yet).
   */
  draw(
    src: HTMLVideoElement | VideoFrame,
    crop: Crop,
    w: number,
    h: number,
    at: number,
    mirror = false,
  ): boolean {
    const gl = this.gl;
    if (this.seg) {
      this.clock = Math.max(this.clock + 1, Math.round(at));
      try {
        this.seg.segmentForVideo(src, this.clock, (r) => {
          const conf = r.confidenceMasks?.[0];
          if (conf)
            this.absorb(conf.getAsWebGLTexture(), conf.width, conf.height);
        });
      } catch (e) {
        console.warn("[cutout] segmentation failed; keeping the last mask", e); // e.g. a frame not decoded yet
      }
    }
    // MediaPipe leaves its own GL state behind.
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.reset();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const mask = this.masks?.[0];
    if (!mask) return false;

    const [vw, vh] =
      "videoWidth" in src
        ? [src.videoWidth, src.videoHeight]
        : [src.displayWidth, src.displayHeight];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.video);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    const p = this.drawProg;
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, "uVideo"), 0);
    gl.uniform1i(gl.getUniformLocation(p, "uMask"), 1);
    gl.uniform1f(gl.getUniformLocation(p, "uMirror"), mirror ? 1 : 0);
    gl.uniform4f(
      gl.getUniformLocation(p, "uCrop"),
      crop.x / vw,
      crop.y / vh,
      crop.w / vw,
      crop.h / vh,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  close() {
    this.closed = true;
    this.seg?.close();
    this.seg = null;
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Folds the model's confidence (valid only during its callback) into our smoothed mask. */
  private absorb(conf: WebGLTexture, cw: number, ch: number) {
    const gl = this.gl;
    const k = Math.max(1, cw / MASK_MAX_W);
    const w = Math.round(cw / k);
    const h = Math.round(ch / k);
    if (!this.masks || this.masks[0].w !== w || this.masks[0].h !== h) {
      for (const m of this.masks ?? []) {
        gl.deleteTexture(m.tex);
        gl.deleteFramebuffer(m.fb);
      }
      this.masks = [target(gl, w, h), target(gl, w, h)];
    }
    const [prev, next] = this.masks;
    this.reset();
    gl.activeTexture(gl.TEXTURE0);
    // A single-channel float texture isn't filterable.
    gl.bindTexture(gl.TEXTURE_2D, conf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, next.fb);
    gl.viewport(0, 0, w, h);
    const p = this.maskProg;
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, "uConf"), 0);
    gl.uniform1i(gl.getUniformLocation(p, "uPrev"), 1);
    gl.uniform1f(gl.getUniformLocation(p, "uKeep"), KEEP);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.masks = [next, prev];
  }

  private reset() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
}

function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(`cutout shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, "p");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`cutout program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function texture(gl: WebGL2RenderingContext) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** A mask buffer, starting empty, so the person fades in. */
function target(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = texture(gl);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0,
  );
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb, w, h };
}
