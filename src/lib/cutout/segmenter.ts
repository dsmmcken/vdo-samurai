// Google's selfie segmenter (selfie_segmenter.tflite, 250 KB, Apache-2.0: the
// model MediaPipe's ImageSegmenter uses for people) on our own runner
// (nn/net.ts) instead of MediaPipe's 14 MB engine. It takes a 256x256 picture
// and says, for each pixel, how sure it is that it's part of a person.
//
//   const seg = await Segmenter.load(modelUrl, kernelsUrl);
//   const mask = seg.run(rgba); // 256x256 confidences, valid until the next run

import { Net } from '../nn/net';

export const SEG_SIZE = 256;

export class Segmenter {
  static async load(modelUrl: string, kernelsUrl: string) {
    return new Segmenter(await Net.load(modelUrl, kernelsUrl));
  }

  private input: Float32Array;
  private output: Float32Array;

  constructor(private net: Net) {
    const [, h, w, c] = net.inputShapes[0];
    if (h !== SEG_SIZE || w !== SEG_SIZE || c !== 3) throw new Error(`segmenter: unexpected input ${net.inputShapes[0]}`);
    this.input = net.inputs[0];
    this.output = net.outputs[0];
  }

  /**
   * Confidences (0..1, row by row from the top) for a 256x256 RGBA picture.
   * `flip` segments it mirrored left to right (the mask comes back unmirrored).
   */
  run(rgba: Uint8Array | Uint8ClampedArray, flip = false): Float32Array {
    const S = SEG_SIZE;
    const input = this.input;
    // The model takes RGB in 0..1.
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const j = (y * S + (flip ? S - 1 - x : x)) * 4;
        const i = (y * S + x) * 3;
        input[i] = rgba[j] / 255;
        input[i + 1] = rgba[j + 1] / 255;
        input[i + 2] = rgba[j + 2] / 255;
      }
    this.net.run();
    if (!flip) return this.output;
    const out = this.output;
    for (let y = 0; y < S; y++) out.subarray(y * S, y * S + S).reverse();
    return out;
  }
}
