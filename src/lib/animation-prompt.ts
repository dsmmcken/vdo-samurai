// The "make your own animation" prompt, copied from the Animations panel into any AI
// assistant. It has to be complete on its own: the assistant sees nothing else.
import { ANIMATION_FPS, ANIMATION_H, ANIMATION_MAX_BYTES, ANIMATION_MAX_SECONDS, ANIMATION_NAME_MAX, ANIMATION_SCHEMA, ANIMATION_W } from './animation-api';

/** The schema as the AI sees it: without the app's own messages. */
const schemaText = JSON.stringify(ANIMATION_SCHEMA, (k, v) => (k === 'x-hint' ? undefined : v), 2);

export const EXAMPLE_ANIMATION = `// An intro: the title fades and rises in over a slow gradient, then a line
// sweeps under it. Then the stage goes back to whoever was on before.
samurai.animation({
  name: 'Intro',
  duration: 5,
  end: 'prev',
  microphones: 'none',
  draw(ctx, t, { w, h, duration }) {
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, \`hsl(\${230 + t * 6}, 60%, 12%)\`);
    g.addColorStop(1, \`hsl(\${280 + t * 6}, 55%, 22%)\`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const a = ease(t / 1.2) * (1 - ease((t - (duration - 0.6)) / 0.6));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fff';
    ctx.font = '700 120px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Episode 12', w / 2, h / 2 - 20 + (1 - ease(t / 1.2)) * 40);

    const line = ease((t - 0.8) / 1.0) * 520;
    ctx.fillStyle = '#e8b34b';
    ctx.fillRect(w / 2 - line / 2, h / 2 + 70, line, 6);
    ctx.globalAlpha = 1;
  },
});
`;

/** Where a script goes in PREVIEW_PAGE (the line between these markers). */
export const PREVIEW_SLOT = '// ▼ Paste the whole script on the next line ▼\n\n// ▲';

/**
 * A small page for an AI assistant to preview a script in: frames drawn the
 * way the sandbox draws them (animation-worker.ts). Kept short: it goes in
 * the prompt. No backticks or dollar-brace (it lives inside a template).
 */
export const PREVIEW_PAGE = `<!doctype html>
<canvas id="c" width="1920" height="1080" style="width:100%;background:#000"></canvas>
<input id="s" type="range" min="0" step="any" value="0" style="width:100%"> <button id="p">Play</button>
<script>let decl; const samurai = { animation: (d) => (decl = d) };</script>
<script>
${PREVIEW_SLOT}
</script>
<script type="module">
  const ctx = c.getContext('2d'), img = {};
  let seed = 0, ms = 0;
  Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  performance.now = Date.now = () => ms;
  for (const [k, u] of Object.entries(decl.assets || {})) {
    if (/^data:image/.test(u)) img[k] = await createImageBitmap(await (await fetch(u)).blob());
    else if (/^data:(font|application)/.test(u)) document.fonts.add(await new FontFace(k, await (await fetch(u)).arrayBuffer()).load());
  }
  const draw = (t) => { seed = 0x5a3e; ms = t * 1000; ctx.reset(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080); decl.draw(ctx, t, { w: 1920, h: 1080, duration: decl.duration, img }); };
  s.max = decl.duration;
  s.oninput = () => draw(Math.floor(s.value * 30) / 30);
  p.onclick = () => { let start; requestAnimationFrame(function f(now) { start ??= now - s.value * 1000; s.value = Math.min(decl.duration, (now - start) / 1000); s.oninput(); if (s.value < decl.duration) requestAnimationFrame(f); }); };
  s.oninput();
</script>
`;

export const ANIMATION_PROMPT = `You are helping me write a "scripted animation" for VDO.Samurai, a browser app for recording meetings. It's a short JavaScript canvas animation (an intro, an outro, a title card, an interstitial) that plays on the main stage for everyone in the meeting and is drawn again, frame by frame, into the final 1080p video. Write the complete script for the animation I describe at the end.

## The API

The script calls \`samurai.animation({...})\` exactly once, at the top level, with its properties in this order:

\`\`\`js
samurai.animation({
  name: 'Intro',          // required, at most ${ANIMATION_NAME_MAX} characters
  duration: 6,            // required, in seconds (at most ${ANIMATION_MAX_SECONDS})
  end: 'prev',            // when it's over: 'prev' back to what was on stage before (default),
                          //   'hold' stay on the last frame, 'loop' start over until someone switches,
                          //   { tile: 1 } go to the next tile in the strip ({ tile: -1 } the one before)
  microphones: 'director', // which microphones are kept in the final video while it plays:
                          //   'none', 'director' (default: the host can talk over it) or 'all'
  draw(ctx, t, animation) {   // required: paints ONE frame
    // ctx:   a CanvasRenderingContext2D on a ${ANIMATION_W}x${ANIMATION_H} canvas
    // t:     seconds since the animation started (held at duration once it ends; wraps when looping)
    // animation: { w: ${ANIMATION_W}, h: ${ANIMATION_H}, duration, img: { logo: ImageBitmap, ... } }
  },
  audio: [                // optional, after draw: when each sound starts
    { asset: 'theme', at: 0, gain: 0.8 },  // at: seconds into the animation (into each pass when looping); gain 0..2
  ],
  assets: {               // optional, ALWAYS LAST: images, sounds and fonts the animation uses, by name
    logo: 'data:image/png;base64,iVBORw0KG...',  // png, jpeg, webp, gif or avif: ctx.drawImage(animation.img.logo, ...)
    theme: 'data:audio/mpeg;base64,SUQzBA...',   // mp3, wav, ogg, m4a or flac: started by the audio cues above
    title: 'font',        //   ttf, otf, woff or woff2: used as ctx.font = '64px title' (here a placeholder, see below)
  },
});
\`\`\`

Assets: if I attach images, sounds or fonts, put each one into \`assets\` as a complete base64 data: URL with its real type (data:image/png;base64,...), always at the end of the script. Embed the whole file, never a shortened one: if you can run code, read my file and write the finished .js file for me to download; if a file is too big to write out in full, leave a placeholder instead. A placeholder is the kind as a string ('image', 'audio' or 'font'), and VDO.Samurai asks me for that file when I add the script. Use placeholders, too, for anything the animation needs that I didn't attach, and tell me in one line which files those are (for example "logo: a PNG of your logo, ideally square with a transparent background").

## Rules (the app enforces them)

- draw(ctx, t) must be a pure function of t: paint the whole frame every time. The canvas is cleared to black and the context reset before each call. Frames are drawn at ${ANIMATION_FPS} fps live and in the final video, and the video may draw any t in any order, so never keep state between calls (nothing that accumulates frame to frame; compute every position from t).
- Math.random() gives the same sequence on every frame (good for stable scattered stars or petals; derive flicker from t). Date.now() and performance.now() return the animation time in ms.
- Nothing can be loaded: no fetch, no import, no network, no DOM, no document, no window, no setTimeout, no eval or new Function. Everything comes from canvas drawing or the assets.
- Fonts: system fonts (system-ui, sans-serif, serif, monospace) or a font asset, used by its name.
- Sounds play only through the audio list; draw() can't start a sound.
- The whole animation, files included, must stay under ${ANIMATION_MAX_BYTES / 1048576} MB, so ask for compressed images and short music.
- Use the whole ${ANIMATION_W}x${ANIMATION_H} frame, with text inside the middle 90% (title safe).

The object passed to samurai.animation() must match this JSON Schema (the app checks it, and refuses anything else, typos included; draw is a function):

\`\`\`json
${schemaText}
\`\`\`

## Example

\`\`\`js
${EXAMPLE_ANIMATION}\`\`\`

## Previewing (optional)

If you can run code or show web pages, check your work in this page: paste the whole script on the marked line, then scrub or play. It draws frames the way VDO.Samurai does (cleared to black each frame, the same Math.random, scene time from Date.now() and performance.now()).

\`\`\`html
${PREVIEW_PAGE}\`\`\`

## Your answer

If I haven't described the animation yet (the section below is empty), don't write anything yet. Say in one sentence that you're ready, then ask me briefly: what it's for (intro, outro, title card, interstitial), how long, what it should say, how it should look, whether I have a logo, music or fonts to attach, and how it should end. If I've described it but left something out, choose sensibly and say what you chose; don't hold the script back for small details.

Once you have my description, reply with the complete script in one code block (or as a .js file to download), then one line naming any placeholders I still need to fill. Make it look polished: smooth easing, good typography, nothing popping in or out abruptly.

## The animation I want

`;

/** What to tell your AI assistant about the animation: [what, for example]. */
export const ANIMATION_ASK: [string, string][] = [
  ["What it's for", 'An intro, an outro, a title card, an interstitial'],
  ['How long you want it', 'In seconds: 3 to 8 suits most intros'],
  ['What it should say', 'Show name, episode, guests, a call to action'],
  ['How you want it to look', 'Colours, fonts, calm or energetic'],
  ['Your logo, music or fonts', "Attach the files to your message and they'll go into the script"],
  ['How you want it to end', 'Back to the speaker, hold, loop, or on to the next tile'],
];
