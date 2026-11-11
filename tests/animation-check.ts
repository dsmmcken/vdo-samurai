// Browser side of animation-check.mjs: the library's merge rules, the strip, and
// the sandbox (what a script can and can't do, and that frames are the same
// every time they're drawn).
import { animationSlot, buildStrip, Clock, keepAbsent, slotAnimation, mergeIndex, pinnedAnimations, animationTime, tileAfter, validateAnimation, type AnimationIndex } from '../src/lib/animation-api';
import { AnimationSandbox } from '../src/lib/animation-sandbox';
import { EXAMPLE_ANIMATION, PREVIEW_PAGE, PREVIEW_SLOT } from '../src/lib/animation-prompt';
import { samuraiIntro } from '../src/lib/animation-examples';
import { assetsOf, pack, removeAsset, setAsset, setOption, unpack } from '../src/lib/animation-edit';
import { playAnimation } from '../src/lib/animation-player';
import { segments } from '../src/compositor/plan';
import { now } from '../src/lib/util';

type Check = [string, boolean, unknown?];
const H = (c: string) => c.repeat(64);

async function pixels(b: ImageBitmap) {
  const c = new OffscreenCanvas(b.width, b.height);
  const g = c.getContext('2d')!;
  g.drawImage(b, 0, 0);
  const d = g.getImageData(0, 0, b.width, b.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
  return h;
}

async function rejects(code: string) {
  try {
    await AnimationSandbox.check(code);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export async function run() {
  const out: Check[] = [];
  const ok = (what: string, cond: boolean, got?: unknown) => out.push([what, cond, got]);

  // ---------------------------------------------------------------- merging
  {
    // A adds Intro; both have it. Apart, A edits it (earlier) and B edits it (later). They meet again.
    const v1 = { content: { hash: H('1'), size: 10, deleted: false, ts: 1000, by: 'a' } };
    const A: AnimationIndex = { Intro: structuredClone(v1) };
    const B: AnimationIndex = { Intro: structuredClone(v1) };
    A.Intro.content = { hash: H('a'), size: 11, deleted: false, ts: 2000, by: 'a' };
    B.Intro.content = { hash: H('b'), size: 12, deleted: false, ts: 3000, by: 'b' };
    const ra = mergeIndex(A, structuredClone(B));
    const rb = mergeIndex(B, structuredClone(A));
    ok('later edit wins on both sides', A.Intro.content.hash === H('b') && B.Intro.content.hash === H('b'), [A.Intro.content.hash, B.Intro.content.hash]);
    ok('A learns its copy changed (and fetches it)', ra.content.includes('Intro') && ra.changed.includes('Intro'), ra);
    ok('B sees nothing to change', rb.changed.length === 0, rb);
    ok('merging again changes nothing', mergeIndex(A, structuredClone(B)).changed.length === 0);
  }
  {
    // Same time: the larger peer id wins, the same way everywhere.
    const A: AnimationIndex = { S: { content: { hash: H('a'), size: 1, deleted: false, ts: 5, by: 'a' } } };
    const B: AnimationIndex = { S: { content: { hash: H('b'), size: 1, deleted: false, ts: 5, by: 'b' } } };
    mergeIndex(A, structuredClone(B));
    mergeIndex(B, structuredClone(A));
    ok('a tie goes the same way on both sides', A.S.content.hash === H('b') && B.S.content.hash === H('b'));
  }
  {
    // A deletes after B's edit: stays deleted. A delete before B's edit: B's edit comes back.
    const A: AnimationIndex = { S: { content: { hash: '', size: 0, deleted: true, ts: 50, by: 'a' } } };
    const B: AnimationIndex = { S: { content: { hash: H('b'), size: 1, deleted: false, ts: 40, by: 'b' } } };
    mergeIndex(B, structuredClone(A));
    ok('a later delete wins over an edit', B.S.content.deleted);
    const C: AnimationIndex = { S: { content: { hash: H('c'), size: 1, deleted: false, ts: 60, by: 'c' } } };
    mergeIndex(A, structuredClone(C));
    ok('a later edit brings a deleted animation back', !A.S.content.deleted && A.S.content.hash === H('c'));
  }
  {
    // Pinning and editing are separate: a newer pin doesn't undo an older-but-unseen edit.
    const A: AnimationIndex = { S: { content: { hash: H('1'), size: 1, deleted: false, ts: 10, by: 'a' }, pin: { pinned: true, ts: 30, by: 'a' } } };
    const B: AnimationIndex = { S: { content: { hash: H('2'), size: 1, deleted: false, ts: 20, by: 'b' }, pin: { pinned: false, ts: 5, by: 'b' } } };
    mergeIndex(A, structuredClone(B));
    ok("pin and content merge separately", A.S.content.hash === H('2') && A.S.pin?.pinned === true, A.S);
  }
  {
    // Junk from a peer is ignored.
    const A: AnimationIndex = {};
    const r = mergeIndex(A, { X: { content: { hash: 'nothex', size: 1, deleted: false, ts: 1, by: 'z' } }, Y: 5, Z: { content: { hash: H('f'), size: 99e9, deleted: false, ts: 1, by: 'z' } } });
    ok('malformed or oversized entries are ignored', r.changed.length === 0 && !Object.keys(A).length, A);
  }
  {
    // A peer can't reach Object.prototype through an animation name.
    const A: AnimationIndex = {};
    mergeIndex(A, JSON.parse('{"__proto__": {"content": {"hash": "' + H('e') + '", "size": 1, "deleted": false, "ts": 1, "by": "evil"}}}'));
    mergeIndex(A, { constructor: { content: { hash: H('c'), size: 1, deleted: false, ts: 1, by: 'x' } } });
    ok("'__proto__' is ignored, nothing leaks onto every object", ({} as any).content === undefined && Object.getPrototypeOf(A) === Object.prototype);
    ok("'constructor' is just a name", Object.hasOwn(A, 'constructor') && A.constructor.content.hash === H('c'));
  }
  {
    // A clock behind someone else's still stamps after what it has seen.
    const c = new Clock();
    c.seen(10_000);
    ok('stamps never go behind what was seen', c.next(5_000) === 10_001 && c.next(5_000) === 10_002);
    ok('stamps follow the wall clock when it is ahead', c.next(20_000) === 20_000);
  }
  {
    const idx: AnimationIndex = {
      B: { content: { hash: H('2'), size: 1, deleted: false, ts: 1, by: 'a' }, pin: { pinned: true, ts: 2, by: 'a' } },
      A: { content: { hash: H('1'), size: 1, deleted: false, ts: 1, by: 'a' }, pin: { pinned: true, ts: 3, by: 'a' } },
      C: { content: { hash: '', size: 0, deleted: true, ts: 9, by: 'a' }, pin: { pinned: true, ts: 1, by: 'a' } },
      D: { content: { hash: H('4'), size: 1, deleted: false, ts: 1, by: 'a' }, pin: { pinned: false, ts: 4, by: 'a' } },
    };
    ok('pinned = live and pinned, in pin order', pinnedAnimations(idx).map((p) => p.name).join() === 'B,A', pinnedAnimations(idx));
  }

  // ---------------------------------------------------------------- the cut
  {
    const cam = { kind: 'peer', id: 'p1', view: 'cam' } as const;
    const anim = { kind: 'animation', name: 'I', hash: 'h', at: 0, by: 'p1', microphones: 'none', prev: cam } as const;
    const take = (log: unknown[]) => segments({ take: { id: 't', director: 'p1', startAt: 0, stopAt: 20000 }, stageLog: log } as any);
    const segs = take([{ t: 0, stage: cam }, { t: 5000, stage: anim, animationAt: 5600 }, { t: 12000, stage: cam }]);
    ok("the cut stays on the last shot until the animation starts (no frozen first frame)", segs.map((g) => `${g.stage.kind}:${g.start}-${g.end}`).join() === 'peer:0-5.6,animation:5.6-12,peer:12-20', segs);
    const gone = take([{ t: 0, stage: cam }, { t: 5000, stage: anim, animationAt: 5600 }, { t: 5300, stage: cam }]);
    ok('an animation switched away before it started leaves no trace', gone.length === 1 && gone[0].end === 20, gone);
  }

  // ---------------------------------------------------------------- strip
  {
    const tiles = ['p1', 'p2', 'p3'];
    ok('unplaced extras go last, Multicam first', buildStrip(tiles, [], ['end', 'animation:X']).join() === 'p1,p2,p3,end,animation:X');
    ok('placed extras keep their place', buildStrip(tiles, ['animation:X', 'p1', 'p2', 'end', 'p3'], ['end', 'animation:X']).join() === 'animation:X,p1,p2,end,p3');
    ok('placed last stays last after newcomers', buildStrip([...tiles, 'p4'], ['p1', 'p2', 'p3', 'end'], ['end']).join() === 'p1,p2,p3,p4,end');
    ok('same as before for Multicam alone', buildStrip(tiles, ['p1', 'end', 'p2', 'p3'], ['end']).join() === 'p1,end,p2,p3');
    // p2 and an animation turned off are away; p3 is dragged to the front.
    const kept = keepAbsent(['p3', 'p1', 'end'], ['p1', 'p2', 'animation:X', 'p3', 'end']);
    ok("absent slots keep their place in a new order", kept.join() === 'p3,p1,p2,animation:X,end', kept);
    ok('absent at the front stays at the front', keepAbsent(['p2', 'p1'], ['p0', 'p1', 'p2']).join() === 'p0,p2,p1');
    ok('who comes back takes their old place', buildStrip(['p3', 'p1', 'p2'], kept, ['end', 'animation:X']).join() === 'p3,p1,p2,animation:X,end');
    const strip = ['p1', 'animation:I', 'p2', 'end'] as const;
    ok("a tile's slot gives back its animation's name", slotAnimation(animationSlot('VDO.Samurai intro')) === 'VDO.Samurai intro' && slotAnimation('end') === null);
    ok('tile +1', tileAfter([...strip], 'animation:I', 1) === 'p2');
    ok('tile -1', tileAfter([...strip], 'animation:I', -1) === 'p1');
    ok('tile +3 wraps', tileAfter([...strip], 'animation:I', 3) === 'p1');
    ok('tile -2 wraps', tileAfter([...strip], 'animation:I', -2) === 'end');
    ok('a full turn lands nowhere', tileAfter([...strip], 'animation:I', 4) === null);
  }

  // ---------------------------------------------------------------- timing
  ok('held at the end', animationTime({ duration: 5, end: 'hold' }, 7) === 5);
  ok('looping wraps', Math.abs(animationTime({ duration: 5, end: 'loop' }, 12.5) - 2.5) < 1e-9);
  ok('before the start: frame 0', animationTime({ duration: 5, end: 'prev' }, -0.3) === 0);

  // ---------------------------------------------------------------- validation
  const bad = (d: unknown) => {
    try {
      validateAnimation(d);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const draw = () => {};
  ok('needs a name', !!bad({ duration: 1, draw })?.startsWith('name'));
  ok('needs a duration', !!bad({ name: 'x', draw })?.startsWith('duration'));
  ok('tile 0 is refused', !!bad({ name: 'x', duration: 1, draw, end: { tile: 0 } })?.startsWith('end'));
  ok('a cue must name an audio asset', !!bad({ name: 'x', duration: 1, draw, audio: [{ asset: 'nope' }] })?.startsWith('audio[0]'));
  ok('assets must be data: URLs', !!bad({ name: 'x', duration: 1, draw, assets: { a: 'https://x/y.png' } })?.startsWith('assets.a'));
  const m = validateAnimation({ name: ' Hi ', duration: 2, draw });
  ok('defaults: back to before, Shōgun heard', m.name === 'Hi' && m.end === 'prev' && m.microphones === 'director');

  // ---------------------------------------------------------------- the JSON Schema
  {
    const f = () => {};
    ok('a typo is refused, not ignored', !!bad({ name: 'x', duration: 1, durration: 2, draw: f })?.includes("durration: isn't a known option"), bad({ name: 'x', duration: 1, durration: 2, draw: f }));
    ok('gain over 2 is refused with its path', !!bad({ name: 'x', duration: 1, draw: f, assets: { s: 'data:audio/wav;base64,AA==' }, audio: [{ asset: 's', gain: 3 }] })?.startsWith('audio[0].gain: must be at most 2'));
    ok('an unknown cue field is refused', !!bad({ name: 'x', duration: 1, draw: f, audio: [{ asset: 's', volume: 1 }] })?.includes('audio[0].volume'));
    ok('microphones must be one of three', !!bad({ name: 'x', duration: 1, draw: f, microphones: 'host' })?.startsWith("microphones: must be 'none', 'director' or 'all'"));
    ok('several problems are listed together', (bad({ name: '', duration: -1, draw: 5 })?.split('\n').length ?? 0) >= 3, bad({ name: '', duration: -1, draw: 5 }));
    ok('a placeholder asks for its file', bad({ name: 'x', duration: 1, draw: f, assets: { logo: 'image' } }) === 'assets.logo: add the image file for it');
    ok('a full, valid declaration passes', !bad({ name: 'x', duration: 2, end: { tile: -1 }, microphones: 'all', draw: f, audio: [{ asset: 's', at: 0.5, gain: 1 }], assets: { s: 'data:audio/wav;base64,AA==' } }));
  }

  // ---------------------------------------------------------------- editing a script as text
  {
    const src = `// a { brace } and a , comma in a comment
samurai.animation({
  name: 'Edit me',
  duration: 3,
  draw(ctx, t, { w, h, duration }) {
    const s = \`duration: \${t}, { not: 'this' }\`;
    ctx.fillStyle = 'rgb(1, 2, 3)';
    ctx.fillRect(0, 0, w, h);
  },
  assets: {
    logo: 'image',
    beep: 'audio',
  },
});`;
    const d = setOption(src, 'duration', '7.5');
    ok('setting duration changes only its value', d === src.replace('duration: 3,', 'duration: 7.5,'), d);
    const e = setOption(src, 'end', "{ tile: 1 }");
    ok('a missing option is added after duration', e.includes("duration: 3,\n  end: { tile: 1 },\n  draw("), e);
    const v = setOption(setOption(src, 'microphones', "'none'"), 'microphones', "'all'");
    ok('setting an option twice replaces it', v.split("microphones:").length === 2 && v.includes("microphones: 'all',"), v);
    const slots = assetsOf(src);
    ok('placeholders are found, with their kinds', JSON.stringify(slots.map((x) => [x.name, x.kind, x.missing])) === JSON.stringify([['logo', 'image', true], ['beep', 'audio', true]]), slots);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const filled = setAsset(src, 'logo', png);
    ok('a placeholder is filled in place', filled.includes(`logo: '${png}',`) && assetsOf(filled).find((x) => x.name === 'logo')?.missing === false, assetsOf(filled));
    const gone = removeAsset(filled, 'beep');
    ok('an asset can be removed', !gone.includes('beep') && assetsOf(gone).length === 1, gone);
    const bare = `samurai.animation({ name: 'B', duration: 1, draw(ctx) { ctx.fillRect(0, 0, 1, 1); } })`;
    const withAsset = setAsset(bare, 'logo', png);
    ok('assets are added last when there are none', /draw\(ctx\)[^]*assets: \{\s*logo:/.test(withAsset), withAsset);
    {
      const full = samuraiIntro();
      const { text, files } = pack(full);
      ok('files show as short markers for editing', files.length === 1 && text.length < 8000 && /'⟨file 1 · \d+ KB⟩'/.test(text), text.slice(-120));
      ok('markers unpack to the same script', unpack(text, files) === full);
      ok('an edit around a marker keeps its file', unpack(text.replace("duration: 5", "duration: 6"), files) === full.replace("duration: 5", "duration: 6"));
    }
    ok('an edited script still loads', (await AnimationSandbox.check(setOption(withAsset, 'duration', '4'))).duration === 4);
    ok('the edited example still loads', (await AnimationSandbox.check(setOption(setOption(samuraiIntro(), 'end', "'loop'"), 'microphones', "'all'"))).end === 'loop');
  }

  // ---------------------------------------------------------------- sandbox
  const meta = await AnimationSandbox.check(EXAMPLE_ANIMATION);
  ok('the example animation loads', meta.name === 'Intro' && meta.duration === 5 && meta.microphones === 'none', meta);

  // The built-in VDO.Samurai intro: loads, has its sound, and draws (sun, title, fade-out).
  const intro = await AnimationSandbox.open(samuraiIntro());
  ok('the VDO.Samurai example loads, 5 s with a sound cue', intro.meta.duration === 5 && intro.meta.audio.length === 1 && intro.sounds.shing?.byteLength > 70000, intro.meta);
  {
    const g = new OffscreenCanvas(1920, 1080).getContext('2d')!;
    const at = async (t: number, x: number, y: number) => {
      g.drawImage(await intro.sandbox.bitmap(t), 0, 0);
      return [...g.getImageData(x, y, 1, 1).data];
    };
    const sun = await at(2, 960 + 200, 432); // on the sun, beside the helmet
    const end = await at(5, 960, 432);
    ok('example: the sun is red mid-animation', sun[0] > 180 && sun[1] < 90, sun);
    ok('example: ends faded to black', end[0] + end[1] + end[2] < 10, end);
  }
  intro.sandbox.close();

  // The prompt's preview page draws what the app draws: the example, compared with the sandbox, frame for frame.
  {
    const html = PREVIEW_PAGE.replace(PREVIEW_SLOT, PREVIEW_SLOT.replace('\n\n', '\n' + samuraiIntro() + '\n'));
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-3000px;width:1000px;height:700px';
    frame.srcdoc = html;
    document.body.append(frame);
    const doc = await new Promise<Document>((res) => {
      const wait = () => ((frame.contentDocument?.getElementById('s') as HTMLInputElement | null)?.max ? res(frame.contentDocument!) : setTimeout(wait, 50));
      wait();
    });
    const page = doc.getElementById('c') as HTMLCanvasElement;
    const seekTo = (t: number) => {
      const seek = doc.getElementById('s') as HTMLInputElement;
      seek.value = String(t);
      seek.dispatchEvent(new Event('input'));
    };
    const { sandbox } = await AnimationSandbox.open(samuraiIntro());
    const g = new OffscreenCanvas(1920, 1080).getContext('2d')!;
    let worst = 0;
    for (const t of [0.5, 1.5, 2, 3.5]) {
      seekTo(t);
      const a = page.getContext('2d')!.getImageData(0, 0, 1920, 1080).data;
      const shown = Number((doc.getElementById('s') as HTMLInputElement).value);
      g.drawImage(await sandbox.bitmap(Math.floor(shown * 30) / 30), 0, 0);
      const b = g.getImageData(0, 0, 1920, 1080).data;
      let off = 0;
      for (let i = 0; i < a.length; i += 4 * 97) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) off++;
      worst = Math.max(worst, off / (a.length / (4 * 97)));
    }
    sandbox.close();
    frame.remove();
    ok("the prompt's preview page draws what the app draws", worst < 0.01, `${(worst * 100).toFixed(2)}% of sampled pixels differ`);
  }

  // The same frame twice, from two sandboxes, with randomness and the clock in it.
  const busy = `samurai.animation({ name: 'R', duration: 3, draw(ctx, t, { w, h }) {
    for (let i = 0; i < 200; i++) { ctx.fillStyle = 'hsl(' + Math.random() * 360 + ',80%,60%)'; ctx.fillRect(Math.random() * w, Math.random() * h, 20 + t * 10, 20); }
    ctx.fillStyle = '#fff'; ctx.font = '80px sans-serif'; ctx.fillText(String(Date.now()), 100, 200);
  } });`;
  const a = await AnimationSandbox.open(busy);
  const b = await AnimationSandbox.open(busy);
  const pa = await pixels(await a.sandbox.bitmap(1.5));
  await a.sandbox.bitmap(0.2); // something else in between
  const pa2 = await pixels(await a.sandbox.bitmap(1.5));
  const pb = await pixels(await b.sandbox.bitmap(1.5));
  const pOther = await pixels(await b.sandbox.bitmap(2.5));
  ok('a frame is the same every time, in any sandbox', pa === pa2 && pa === pb, [pa, pa2, pb]);
  ok('different t, different frame', pOther !== pa);
  // Nothing of the last frame leaks into the next (the canvas is reset).
  const leak = await AnimationSandbox.open(`samurai.animation({ name: 'L', duration: 2, draw(ctx, t) { if (t < 1) { ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1920, 1080); ctx.translate(500, 0); ctx.globalAlpha = 0.1; } else { ctx.fillStyle = '#0f0'; ctx.fillRect(0, 0, 10, 10); } } });`);
  await leak.sandbox.bitmap(0.5);
  const bm = await leak.sandbox.bitmap(1.5);
  const c = new OffscreenCanvas(1920, 1080).getContext('2d')!;
  c.drawImage(bm, 0, 0);
  const px = (x: number, y: number) => [...c.getImageData(x, y, 1, 1).data].join();
  ok('each frame starts from black with a fresh context', px(5, 5) === '0,255,0,255' && px(900, 500) === '0,0,0,255', [px(5, 5), px(900, 500)]);
  for (const s of [a, b, leak]) s.sandbox.close();

  // What a script can reach: nothing but drawing.
  const reach = await rejects(`
    const leaks = [];
    for (const n of ['fetch','XMLHttpRequest','WebSocket','indexedDB','caches','navigator','Worker','importScripts','eval','Function','setTimeout','BroadcastChannel','WebAssembly'])
      if (typeof globalThis[n] !== 'undefined') leaks.push(n);
    for (let o = globalThis; o; o = Object.getPrototypeOf(o)) for (const n of ['fetch','indexedDB','navigator']) if (Object.getOwnPropertyDescriptor(o, n)?.value || Object.getOwnPropertyDescriptor(o, n)?.get) leaks.push('proto ' + n);
    for (const f of [function(){}, async function(){}, function*(){}, async function*(){}]) { try { f.constructor('return 1'); leaks.push('constructor'); } catch {} }
    throw new Error('LEAKS:' + leaks.join(','));
  `);
  ok('no network, storage, workers or code-from-strings', reach === 'LEAKS:', reach);
  ok('import() hidden behind a comment is refused too', !!(await rejects(`import/* hi */('data:text/javascript,1'); samurai.animation({ name: 'x', duration: 1, draw() {} });`))?.includes('import'));
  ok('import() is refused', !!(await rejects(`import('https://example.com/x.js'); samurai.animation({ name: 'x', duration: 1, draw() {} });`))?.includes('import'));
  ok('a script that never declares an animation is refused', !!(await rejects(`const x = 1;`))?.includes('samurai.animation'));
  ok('declaring twice is refused', !!(await rejects(`samurai.animation({ name: 'a', duration: 1, draw() {} }); samurai.animation({ name: 'b', duration: 1, draw() {} });`))?.includes('exactly once'));
  ok('a draw() that throws is caught when added', !!(await rejects(`samurai.animation({ name: 'x', duration: 1, draw(ctx, t) { if (t > 0.4) throw new Error('boom'); } });`))?.includes('boom'));
  // The browser keeps scripts in: an opaque origin, a frame with no network, and nobody to message.
  ok('scripts run with a null origin', (await rejects(`throw new Error('ORIGIN:' + origin);`)) === 'ORIGIN:null');
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Animation sandbox"]');
  ok('the sandbox frame allows scripts and nothing else', frame?.getAttribute('sandbox') === 'allow-scripts', frame?.getAttribute('sandbox'));
  ok("the sandbox frame's CSP allows no network", !!frame?.srcdoc.includes("default-src 'none'"));
  ok("a script can't message the page or the frame", !!(await rejects(`postMessage({ t: 'loaded', decl: { name: 'x', duration: 1 }, hasDraw: true, sounds: {} }); samurai.animation({ name: 'x', duration: 1, draw() {} });`))?.includes('postMessage'));
  {
    // The render's way: a worker asks this page for a sandbox and talks to it directly.
    const { serveAnimations } = await import('../src/lib/animation-host');
    const w = new Worker(new URL('/tests/animation-render-worker.ts', location.href), { type: 'module' });
    const serve = serveAnimations(w);
    const got = await new Promise<any>((res) => {
      w.onmessage = (e) => serve(e.data) || res(e.data);
      w.postMessage({ code: `samurai.animation({ name: 'From a worker', duration: 1, draw(ctx) { ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 100, 100); } });` });
    });
    w.terminate();
    ok('a worker (the render) gets frames through the page', got.name === 'From a worker' && got.px?.join() === '0,255,0,255', got);
  }
  // A frame that never finishes is cut off.
  const hang = await AnimationSandbox.open(`samurai.animation({ name: 'H', duration: 10, draw(ctx, t) { if (t > 8 && t < 9.5) for (;;) {} } });`);
  const t0 = performance.now();
  const hung = await hang.sandbox.bitmap(9).then(() => null, (e) => (e as Error).message);
  ok('an endless frame is cut off', !!hung?.includes('endless') && performance.now() - t0 < 5000, hung);

  // A computer too slow for the animation drops frames and stays on time: each
  // frame shown is the one due now, not the next one in line. Every frame here
  // takes ~3 frame times; its red is its frame number.
  {
    const slow = `samurai.animation({ name: 'S', duration: 8, draw(ctx, t) { let x = 0; for (let i = 0; i < N; i++) x += Math.sqrt(i); ctx.fillStyle = 'rgb(' + Math.round(t * 30) + ',0,' + (x > 0 ? 0 : 1) + ')'; ctx.fillRect(0, 0, 1920, 1080); } });`;
    let n = 2e6;
    for (;;) {
      const probe = await AnimationSandbox.open(slow.replace('N', String(n)));
      const t0 = performance.now();
      await probe.sandbox.bitmap(0);
      const ms = performance.now() - t0;
      probe.sandbox.close();
      if (ms > 100 || n > 1e9) break;
      n *= Math.max(2, Math.ceil(100 / Math.max(ms, 1)));
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    canvas.style.width = '1920px';
    document.body.append(canvas);
    const startLocal = now();
    const stop = playAnimation({ code: slow.replace('N', String(n)), startLocal, canvas });
    await new Promise((r) => setTimeout(r, 2500));
    const read = new OffscreenCanvas(1920, 1080).getContext('2d')!;
    read.drawImage(canvas, 0, 0);
    const shown = read.getImageData(5, 5, 1, 1).data[0];
    const due = Math.floor(((now() - startLocal) / 1000) * 30);
    stop();
    canvas.remove();
    ok('a slow computer drops frames and stays on time', shown > 30 && due - shown <= 12, { shown, due });
  }

  // Assets: an image is decoded and drawable; a sound comes back as bytes.
  const png = await (async () => {
    const cv = new OffscreenCanvas(8, 8);
    const g = cv.getContext('2d')!;
    g.fillStyle = '#00f';
    g.fillRect(0, 0, 8, 8);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
  })();
  const wav = (() => {
    const n = 4800;
    const buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o: number, s: string) => [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, 48000, true);
    buf.setUint32(28, 96000, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 8000), true);
    const bytes = new Uint8Array(buf.buffer);
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return 'data:audio/wav;base64,' + btoa(s);
  })();
  const withAssets = await AnimationSandbox.open(`samurai.animation({ name: 'A', duration: 1, assets: { dot: '${png}', beep: '${wav}' }, audio: [{ asset: 'beep', at: 0.25, gain: 0.5 }],
    draw(ctx, t, { img }) { ctx.drawImage(img.dot, 0, 0, 100, 100); } });`);
  const ab = await withAssets.sandbox.bitmap(0.5);
  const c2 = new OffscreenCanvas(1920, 1080).getContext('2d')!;
  c2.drawImage(ab, 0, 0);
  ok('image assets draw', [...c2.getImageData(50, 50, 1, 1).data].join() === '0,0,255,255');
  ok('sound assets come back with their cues', withAssets.sounds.beep?.byteLength === 44 + 9600 && withAssets.meta.audio[0].at === 0.25, withAssets.meta);
  withAssets.sandbox.close();

  return out;
}
