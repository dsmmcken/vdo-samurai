# Background removal experiment: our own selfie segmenter runner

Can the cutout overlay remove the background without shipping MediaPipe's
engine (14.6 MB of WebAssembly, 4.1 MB gzipped)? Yes. The app runs Google's
**selfie segmenter** (the same 250 KB `.tflite` file MediaPipe's
ImageSegmenter uses) on the runner the face tracker already had
(`src/lib/nn`: a small `.tflite` reader and hand-written WebAssembly SIMD
kernels), extended with the ops this model needs: hard swish, 5x5 depthwise
convs, global average pooling, channel scaling (squeeze-and-excite), bilinear
upsampling and MediaPipe's custom transposed conv.

This folder checks it against MediaPipe and shows the morph between the
cutout and the boxed overlays.

## Results

**Download** (gzipped), loaded only when a cutout overlay is first shown:

| | Ours | MediaPipe |
|---|---|---|
| Engine | 9 KB worker (kernels inlined) | 90 KB JS + 4.1 MB wasm |
| Model | 213 KB | 213 KB |
| **Total** | **≈ 221 KB** | **≈ 4.4 MB** |

`npm run build` fails if it grows past 800 KB (`scripts/check-bundle.mjs`).

**Correctness** (`exact.ts`): on the same 256x256 pictures, our masks match
MediaPipe's (CPU) to 0.0001 at most, on six portraits.
`results/exact.png` shows picture, ours, MediaPipe. `face.ts` checks that
BlazeFace, now on the same shared runner, still matches MediaPipe too.

**Speed** (`speed.ts`, headless Chrome on a Ryzen 9 3950X, one thread): about
11-15 ms a frame. Live, each viewer's worker segments as often as fits about
12 ms a frame (every frame on fast machines, every other one here) and
reuses the last mask in between; the final render segments every frame twice
(as is and mirrored, averaged) for steadier edges. `profile.ts` breaks it
down by op.

**The morph** (`morph.ts`): the engine draws the morph at fixed points, as
the final render does, over a slide: `results/morph-br.png`. The face (red
dot) should glide in a straight line, growing steadily, while the background
closes in behind the head and the shoulders open out.

## Run it

```sh
npm install
./fetch-photos.sh                       # test portraits (not committed)
CHROME=/path/to/chrome node run-headless.mjs exact
CHROME=/path/to/chrome node run-headless.mjs speed
CHROME=/path/to/chrome node run-headless.mjs profile
CHROME=/path/to/chrome node run-headless.mjs morph '?corner=tl&photo=portrait.jpg'
```
