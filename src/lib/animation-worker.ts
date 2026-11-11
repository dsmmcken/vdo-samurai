// The animation sandbox's worker: runs one animation script. It's started from the
// null-origin sandbox frame (animation-host.ts), so the browser already keeps it
// off the network (the frame's CSP) and away from this app's storage and
// pages (its opaque origin). On top of that, before the script runs it
// removes every way to reach out or to make code from strings, so a script
// can only draw. One worker per animation; it's thrown away after.
//
// This is one self-contained function, sent to the frame as text: it can't
// import anything. It reports what the script declared as plain data; the
// page checks that against the schema (animation-api.ts).
//
// First message: { port }. Then, on that port:
//   { t: 'load', code }          → { t: 'loaded', decl, sounds: { name: ArrayBuffer } } | { t: 'error', message }
//   { t: 'frame', id, at, w, h } the frame at `at` seconds, as a picture (scaled to w × h if given)
//                                → { t: 'frame', id, bitmap } | { t: 'error', id, message }
// (Frames come back as pictures rather than drawn on a canvas handed in: a
// canvas handed into the frame's process stops it starting workers in Chrome.)
export function animationWorkerMain() {
  const W = 1920;
  const H = 1080;
  type Draw = (ctx: OffscreenCanvasRenderingContext2D, t: number, animation: object) => void;

  // Taken before the lockdown: the sandbox's own tools.
  const makeFunction = Function;
  const bitmapOf = createImageBitmap.bind(self);
  const realNow = performance.now.bind(performance);
  const RealDate = Date;

  let port: MessagePort | null = null;
  const post = (m: unknown, transfer: Transferable[] = []) => port!.postMessage(m, transfer);
  let draw: Draw | null = null;
  let name = '';
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  let animation: object = {};
  /** Animation time while draw() runs: what Date.now() and performance.now() say. */
  let animationMs = 0;

  /** The same "random" numbers on every frame, on every computer: a seeded generator, reset before each frame. */
  let seed = 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const bytesOf = (url: string) => {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const mimeOf = (url: string) => url.slice(5, url.indexOf(';'));
  const kindOf = (url: string) => (/^data:image\//.test(url) ? 'image' : /^data:audio\//.test(url) ? 'audio' : /^data:(font\/|application\/(font-woff|x-font-))/.test(url) ? 'font' : null);

  /** Removes `names` from the global object and everything it inherits from. */
  const strip = (names: string[]) => {
    for (let o: any = self; o; o = Object.getPrototypeOf(o))
      for (const n of names)
        try {
          if (Object.prototype.hasOwnProperty.call(o, n)) delete o[n];
        } catch {
          /* shadowed below */
        }
    for (const n of names)
      try {
        if (n in self) Object.defineProperty(self, n, { value: undefined, writable: false, configurable: false });
      } catch {
        /* gone already */
      }
  };

  const lockdown = () => {
    strip([
      'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts',
      'indexedDB', 'caches', 'cookieStore', 'navigator', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel',
      'RTCPeerConnection', 'RTCDataChannel', 'Notification', 'FileSystemHandle', 'FileSystemDirectoryHandle',
      'FileSystemFileHandle', 'FileSystemSyncAccessHandle', 'StorageManager', 'Request', 'Response', 'Headers',
      'eval', 'Function', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'WebAssembly', 'location', 'close',
      'postMessage', 'onmessage',
    ]);
    // Every route back to a code-from-a-string constructor goes through some function's .constructor.
    const refuse = function () {
      throw new Error('Animations cannot create code from strings.');
    };
    for (const f of [function () {}, async function () {}, function* () {}, async function* () {}])
      try {
        Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: refuse, writable: false, configurable: false });
      } catch {
        /* already done */
      }
    Math.random = random;
    performance.now = () => animationMs;
    const AnimationDate = function (this: unknown, ...a: unknown[]) {
      return a.length ? new (RealDate as any)(...a) : new RealDate(animationMs);
    } as unknown as DateConstructor;
    AnimationDate.now = () => animationMs;
    AnimationDate.parse = RealDate.parse;
    AnimationDate.UTC = RealDate.UTC;
    (AnimationDate as any).prototype = RealDate.prototype;
    (self as any).Date = AnimationDate;
  };

  /** What the script declared, as plain data for the page to check: functions and file contents left out. */
  const describe = (d: any) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { decl: d === undefined ? null : typeof d, hasDraw: false };
    const decl: Record<string, unknown> = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (k === 'draw') continue;
      if (k === 'assets' && v && typeof v === 'object' && !Array.isArray(v)) {
        const a: Record<string, unknown> = {};
        for (const n of Object.keys(v)) a[n] = typeof v[n] === 'string' ? (v[n].startsWith('data:') ? v[n].slice(0, v[n].indexOf(',') + 1) : v[n].slice(0, 200)) : 0;
        decl.assets = a;
        continue;
      }
      try {
        decl[k] = typeof v === 'function' ? '[a function]' : v === undefined ? undefined : JSON.parse(JSON.stringify(v));
      } catch {
        decl[k] = '[not plain data]';
      }
    }
    return { decl, hasDraw: typeof d.draw === 'function' };
  };

  const load = async (code: string) => {
    // import() can't be switched off from inside, so a script may not use it at all (the frame's CSP would block it too).
    if (/\bimport(\s|\/\*[^]*?\*\/|\/\/[^\n]*\n)*[(.]/.test(code)) throw new Error("Animations can't import anything (no import(...)); their files go in assets.");
    let declared: any = null;
    let calls = 0;
    const samurai = Object.freeze({
      animation(d: unknown) {
        calls++;
        declared = d;
      },
      width: W,
      height: H,
    });
    lockdown();
    makeFunction('samurai', `"use strict";\n${code}\n//# sourceURL=animation.js`)(samurai);
    if (calls === 0) throw new Error('The script must call samurai.animation({ ... }).');
    if (calls > 1) throw new Error('The script must call samurai.animation() exactly once.');
    const { decl, hasDraw } = describe(declared);
    const images: Record<string, ImageBitmap> = {};
    const sounds: Record<string, ArrayBuffer> = {};
    if (decl && typeof decl === 'object' && declared.assets && typeof declared.assets === 'object')
      for (const [n, url] of Object.entries(declared.assets as Record<string, unknown>)) {
        if (typeof url !== 'string' || !url.startsWith('data:')) continue; // placeholders and mistakes: the page says what's wrong
        try {
          const kind = kindOf(url);
          if (kind === 'image') images[n] = await bitmapOf(new Blob([bytesOf(url)], { type: mimeOf(url) }));
          else if (kind === 'audio') sounds[n] = bytesOf(url).buffer as ArrayBuffer;
          else if (kind === 'font') {
            const face = new FontFace(n, bytesOf(url).buffer as ArrayBuffer);
            await face.load();
            (self as any).fonts?.add(face);
          }
        } catch (e) {
          throw new Error(`assets.${n}: couldn't be decoded (${(e as Error)?.message ?? e})`);
        }
      }
    if (hasDraw) {
      draw = declared.draw.bind(declared);
      name = typeof declared.name === 'string' ? declared.name : '';
      const duration = typeof declared.duration === 'number' && declared.duration > 0 ? declared.duration : 1;
      animation = Object.freeze({ w: W, h: H, duration, img: Object.freeze(images) });
      // Try a few frames now, so a broken script fails when it's added, not on stage.
      for (const t of [0, duration / 2, duration]) frame(t);
    }
    return { decl, hasDraw, sounds };
  };

  const frame = (t: number) => {
    if (!draw) throw new Error('no animation loaded');
    seed = 0x5a3e;
    animationMs = t * 1000;
    ctx.reset();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    try {
      draw(ctx, t, animation);
    } finally {
      ctx.restore();
    }
  };

  const onPort = async (e: MessageEvent) => {
    const m = e.data;
    try {
      if (m?.t === 'load') {
        const r = await load(String(m.code));
        post({ t: 'loaded', decl: r.decl, hasDraw: r.hasDraw, sounds: r.sounds }, Object.values(r.sounds));
      } else if (m?.t === 'frame') {
        const began = realNow();
        frame(Number(m.at));
        const ms = realNow() - began;
        // Live views ask for their own size: much less to send than 1080p.
        const w = Math.round(Number(m.w)), h = Math.round(Number(m.h));
        const bitmap = w > 0 && h > 0 && (w !== W || h !== H) ? await bitmapOf(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' }) : canvas.transferToImageBitmap();
        post({ t: 'frame', id: m.id, bitmap, ms }, [bitmap]);
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      post({ t: 'error', id: m?.id, message: name ? `${name}: ${message}` : message });
    }
  };

  // The first message brings the port to whoever opened this animation; everything after goes over it.
  self.onmessage = (e) => {
    if (port || !(e.data?.port instanceof MessagePort)) return;
    port = e.data.port as MessagePort;
    self.onmessage = null;
    port.onmessage = onPort;
  };
}
