# Face detection experiment: our own BlazeFace runner

Can we find faces for auto-framing without shipping MediaPipe's 9.6 MB engine?
Yes. This folder runs Google's **BlazeFace short-range** model (the same
230 KB `.tflite` file MediaPipe uses) with a runner we wrote: a small `.tflite`
reader, the nine ops the model needs, and hand-written WebAssembly SIMD inner
loops.

## Results

Measured in headless Chrome 145 on a Ryzen 9 3950X, single thread.

**Download** (gzipped)

| | Ours | MediaPipe |
|---|---|---|
| Engine | 5 KB JS + 0.9 KB wasm | 90 KB JS + 2.9 MB wasm |
| Model | 199 KB | 199 KB |
| **Total** | **≈ 205 KB** | **≈ 3.2 MB** |

**Correctness.** Given the same 128x128 image, our output matches MediaPipe's
to the third decimal place on scores and boxes (`exact.html`).

**Speed** (`speed.html`, `compare.html`)

| | Ours | MediaPipe |
|---|---|---|
| Network only, 128x128 input | 4.1 ms | about 4 ms |
| Whole 1280x720 frame (resize + network) | 4.6 ms | 8.8 ms |
| Tracking a face (`FaceTracker`, crop around the face) | 4.5 ms | |
| Plain-JS fallback (no WebAssembly SIMD) | 33 ms | |

At 4 detections a second, that's about 2% of one core.

**Finding faces** (`compare.html`). There are 48 frames: 8 photos x 6
placements (right, left, far, tilted 20°, dim, backlit). The contact sheet is
saved to `results/sheet.jpg`.

| Detector | Found |
|---|---|
| Ours, whole frame letterboxed (what MediaPipe's API does) | 33 |
| **Ours, through `FaceTracker`** | **39** |
| MediaPipe, whole frame | 31 |

`FaceTracker` searches a 16:9 frame as two overlapping squares. After that it
looks only in a crop about 3x the size of the last face, so the face fills the
model's 128x128 input. That makes it surer, steadier and tighter, especially
on small or far faces. No detector produced a false box. All three miss the Ada
Lovelace painting, a full-length figure with a tiny face.

## How it works

- `tflite.js` reads the FlatBuffer: tensors, float16 weights (converted to
  float32 at load) and the op list.
- `blazeface.js` simplifies the graph:
  - DEQUANTIZE and RESHAPE become aliases;
  - each ReLU is folded into the conv or add before it;
  - all tensors are laid out in one WebAssembly memory, where intermediate
    results reuse freed space (4.8 MB in total).

  It then runs the ops. It also handles letterboxing, SSD anchor decoding and
  MediaPipe's weighted non-max suppression.
- `kernels.wat` holds the SIMD loops: 1x1 conv (4 outputs x 2 pixels per
  pass), 3x3 depthwise, im2col for the 5x5 stem, 2x2 max-pool, channel pad and
  add. `node build-wasm.mjs` assembles it to `kernels.wasm` (1.6 KB). wabt is
  needed only at build time.
- `tracker.js` contains `FaceTracker`, which does the search and follow logic.
- `demo.html` is a live webcam page with a calm auto-framing preview:
  - a dead zone of 8% of the frame;
  - a move must last 0.6 s before the crop re-aims;
  - an eased glide of about 1 s;
  - if the face is lost, the crop holds for 2 s, then eases back out.

  It has a 16:9 stage mode and a circle-overlay mode, and can run MediaPipe
  alongside for comparison.

## Run it

```sh
npm install
./fetch-faces.sh          # model + test photos (not committed)
node build-wasm.mjs       # only after editing kernels.wat
node serve.mjs            # then open http://localhost:8098/demo.html

# headless checks (CHROME = a Chromium binary)
node run-headless.mjs exact.html     # ours == MediaPipe on identical input
node run-headless.mjs speed.html     # network timing, SIMD vs plain JS vs MediaPipe
node run-headless.mjs compare.html   # 48-frame detection test + results/sheet.jpg
node run-headless.mjs profile.html   # time per op type
```

## Not done yet

- Not tried on real webcams with real people: glasses, backlit windows,
  looking down at a keyboard, several people in frame. `demo.html` is for that.
- Not timed on slow laptops or phones. Expect several times slower than here,
  which is still small at a few detections a second.
- In the app, detection would run in the capture worker, from a
  `VideoFrame`, rather than on the main thread as in the demo.
