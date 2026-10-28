# Screen share quality bench

`bench.html` loops a synthetic 1080p "screen" (an editor with 13 px code text) through a
local WebRTC connection and measures what a viewer gets under different codec, size,
bitrate and frame rate settings. `node run.mjs [filter]` runs it in headless Chromium
(set `CHROME=` to the binary). Results land in `results/bench.json`.

The timeline for each setting is 8 s static, 6 s of brisk scrolling, then static again.
Text quality is the luma PSNR of a code crop, with the received picture shown at 1080p
like a full stage. It's measured three times: at the end of the first static phase, and
0.5 s / 2 s / 6 s after the scroll stops.

Headless Chromium 145, software encoders, one connection (the app sends one per viewer).

| setting                  | static kbps | scroll kbps | scroll fps | enc ms/frame | text dB static | after scroll 0.5/2/6 s |
|--------------------------|------------:|------------:|-----------:|-------------:|---------------:|-----------------------:|
| VP8 720p 900k 8fps (today) |       207 |        1049 |          8 |          4.7 |           25.3 | 25.5 / 25.7 / 25.7 |
| VP8 1080p 900k 8fps      |         417 |        1016 |          7 |          5.3 |           44.7 | 32.4 / 38.0 / 45.5 |
| VP9 720p 900k 8fps       |         173 |         734 |          6 |          6.2 |           25.3 | 25.3 / 25.7 / 25.7 |
| VP9 1080p 900k 8fps      |         361 |         749 |          5 |          7.1 |           45.9 | 32.5 / 39.8 / 46.5 |
| AV1 720p 900k 8fps       |          86 |        1027 |          8 |          5.4 |           25.3 | 25.7 / 25.7 / 25.7 |
| **AV1 1080p 900k 8fps**  |     **136** |     **357** |      **8** |      **4.8** |       **46.8** | **48.4 / 48.4 / 48.4** |
| AV1 1080p 600k 8fps      |         137 |         361 |          8 |          4.8 |           47.0 | 48.4 / 48.4 / 48.4 |
| AV1 1080p 1500k 15fps    |         141 |         492 |         15 |          5.4 |           46.6 | 48.4 / 48.4 / 48.4 |
| VP9 1080p 1500k 15fps    |         357 |        1259 |         11 |          7.1 |           45.9 | 48.2 / 48.2 / 48.2 |
| H264 1080p 900k 8fps     |         127 |         315 |          8 |         14.5 |           38.1 | 40.4 / 40.4 / 40.4 |
| AV1 1080p, `text` hint   |         136 |         349 |          8 |          5.0 |           46.8 | 48.0 / 48.0 / 48.0 |
| AV1 1080p, L1T3          |         150 |         725 |          8 |          4.7 |           46.7 | 48.3 / 48.3 / 48.3 |

Findings:

- The 720p downscale is what blurs text. Every codec at 720p is stuck at about 25.7 dB,
  which is the scaling ceiling: scaling down and back up with no codec at all gives the
  same number. Small text doesn't survive a 1.5x downscale, whatever the bitrate.
- At the same 900k cap, AV1 at 1080p is sharper than anything else and uses less
  bandwidth than today's setting: about 35% less while static, about 65% less while
  scrolling. It's sharp again within 0.5 s of a scroll stopping. VP8 and VP9 at 1080p
  are sharp only once things are still, take about 6 s to recover after a scroll, and
  cost about 2x today's static bitrate.
- AV1 never comes close to its cap here, so the cap is only a safety limit. 15 fps costs
  AV1 only about 35% more while scrolling.
- Software H.264 (OpenH264) is the worst choice: blurrier and 3x the encode time.
- The `text` content hint and L1T3 temporal layers don't help. L1T3 doubles the
  scrolling bitrate.

Caveats: the content is synthetic and the scroll is a pure translation (easy for motion
search), with no video playing on the screen and no network loss. Encode times are from a
fast desktop, and each viewer costs one encode in the app's mesh.

## Sender CPU per viewer (`cpu-run.mjs`)

The app's mesh encodes the share separately for every viewer. `cpu-run.mjs` puts the
sender and the viewers in separate headless browsers and counts only the sender's CPU
(from /proc). It subtracts the cost of drawing the fake screen with nobody watching.
The numbers are the percentage of one core on a fast 32-thread desktop, with software
encoders.

| setting          | viewers | still | scrolling |
|------------------|--------:|------:|----------:|
| VP8 720p (today) | 1 / 2 / 4 / 6 | 6 / 10 / 24 / 38 % | 11 / 20 / 44 / 67 % |
| AV1 1080p 8 fps  | 1 / 2 / 4 / 6 | 7 / 16 / 44 / 76 % | 17 / 39 / 103 / 160 % |
| AV1 1080p 15 fps | 1 / 2 / 4 / 6 | 8 / 16 / 44 / 77 % | 29 / 69 / 184 / 308 % |

The cost grows linearly with viewers, and AV1 at 1080p is about 2.3x today's cost. The
"still" figures are pessimistic: the fake screen repaints 5 times a second, but a real
still screen capture delivers about 1 frame a second.

## Encode once with WebCodecs (`webcodecs.html`, `PAGE=webcodecs.html node run.mjs`)

This is AV1 through WebCodecs in constant-quality mode (`bitrateMode: 'quantizer'`, with
a quantizer chosen per frame) at 8 fps. The timeline is 4 s still, 6 s scrolling
(36 px per frame), then 6 s still. Text quality is measured on the decoded picture.

- `contentHint: 'text'` (or `'detail'`) turns on AV1's screen tools. Without it, every
  scrolled frame is about 180 KB (11.6 Mbps). With it, the same scroll costs 0.4 Mbps.
  The app won't send this way unless the browser keeps the hint.
- Decoders hold back about 3 frames unless configured with `optimizeForLatency: true`.
- At q40 the text comes out around 50 dB. "Settling" re-encodes the picture as a sharp
  key frame at q10 once it has been still for a moment, which gives about 56 dB, close to
  the original even at 2x zoom (see `results/crop-*.png`). It costs one key frame of
  about 140 KB per settle. Re-encoding the still frame as a sharp *delta* frame only
  worked the first time: after a scroll, libaom keeps the blocks it sees as unchanged.
- The small changes after a settle (a blinking caret, a typed word) are tiny deltas on
  top of the sharp picture, so it stays sharp.

## The app's own code (`app.html`, `node app-run.mjs` against the vite dev server)

This feeds `src/lib/screencast.ts` (sharer worker -> data channel -> viewer decoder) with
the fake screen at 12 fps:

| phase          | kbps | frames | key frames | viewer's text quality, dB |
|----------------|-----:|-------:|-----------:|------------------------|
| still 4 s      |  492 |      2 |          2 | 49.8 → 55.7 (settled)   |
| scroll 6 s     |  417 |     72 |          0 | 51.4 when it stops      |
| still 6 s      |  186 |      1 |          1 | 56.1                    |
| caret blink 6 s|    1 |     12 |          0 | 56.3                    |
