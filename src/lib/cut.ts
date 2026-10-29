// Trims a recording to what the final cut uses, before it's uploaded.
//
// The director knows the whole edit when the take stops (the stage log), so it
// tells each guest which stretches of their files it will show. The guest
// copies those stretches into a new file, packet for packet (no re-encode, no
// quality loss): video from the keyframe at or before each stretch, through
// its end. Audio is copied whole: it's small, and the render measures and
// polishes each voice over the whole take.
import type { RecFile } from './types';
import { ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget, type EncodedPacket } from 'mediabunny';

/** [start, end) in seconds of file time. */
export type Span = [number, number];

/** Only exact-timed MP4 from our own capture; MediaRecorder's fallback files go whole. */
export const cuttable = (f: RecFile) => f.timing === 'capture' && f.mime.startsWith('video/mp4');

/** Sorted, with overlapping or touching spans joined. */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...spans].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export interface CutResult {
  /** Video kept, seconds (from keyframes, so a little more than asked). */
  videoSeconds: number;
  /** The stretches kept, first to last packet (file seconds). */
  kept: Span[];
  /** Every kept video packet's timestamp and whether it's a keyframe, in order (to check the output against). */
  stamps: [number, boolean][];
  videoPackets: number;
  audioPackets: number;
}

/**
 * Writes `file` with only `keep` of its video (all of its audio) to `writable`;
 * with nothing to keep, no video track. A plain MP4, not fragmented like the
 * recordings: its sync-sample table lists every keyframe, where a fragmented
 * file lost the mark on keyframes that fell mid-fragment (verifyCut caught it).
 */
export async function cutRecording(file: Blob, keep: Span[], writable: WritableStream<any>): Promise<CutResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const spans = mergeSpans(keep);
  const vt = spans.length ? await input.getPrimaryVideoTrack() : null;
  const at = await input.getPrimaryAudioTrack();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable) });
  const vsrc = vt?.codec ? new EncodedVideoPacketSource(vt.codec) : null;
  const asrc = at?.codec ? new EncodedAudioPacketSource(at.codec) : null;
  if (vsrc) output.addVideoTrack(vsrc, { rotation: vt!.rotation });
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  const result: CutResult = { videoSeconds: 0, kept: [], stamps: [], videoPackets: 0, audioPackets: 0 };
  const video = vt && vsrc ? keptVideo(new EncodedPacketSink(vt), spans, result) : null;
  const audio = at && asrc ? new EncodedPacketSink(at).packets() : null;
  const vConfig = { decoderConfig: (await vt?.getDecoderConfig()) ?? undefined };
  const aConfig = { decoderConfig: (await at?.getDecoderConfig()) ?? undefined };

  // Both tracks in timestamp order, so the muxer can interleave as it goes.
  let v = video ? await video.next() : null;
  let a = audio ? await audio.next() : null;
  let firstV = true;
  let firstA = true;
  while ((v && !v.done) || (a && !a.done)) {
    const takeVideo = v && !v.done && (!a || a.done || v.value.timestamp <= a.value.timestamp);
    if (takeVideo) {
      await vsrc!.add(v!.value as EncodedPacket, firstV ? (vConfig as EncodedVideoChunkMetadata) : undefined);
      firstV = false;
      v = await video!.next();
    } else {
      await asrc!.add(a!.value as EncodedPacket, firstA ? (aConfig as EncodedAudioChunkMetadata) : undefined);
      firstA = false;
      result.audioPackets++;
      a = await audio!.next();
    }
  }
  await output.finalize();
  return result;
}

/** The video packets to keep, in decode order: each span from its keyframe on, never a packet twice. */
async function* keptVideo(sink: EncodedPacketSink, spans: Span[], result: CutResult) {
  let last = -Infinity; // timestamp of the last packet kept
  for (const [a, b] of spans) {
    let p = (await sink.getKeyPacket(a)) ?? (await sink.getFirstPacket());
    let from: number | null = null;
    while (p && p.timestamp < b) {
      if (p.timestamp > last) {
        from ??= p.timestamp;
        last = p.timestamp;
        result.videoPackets++;
        result.stamps.push([p.timestamp, p.type === 'key']);
        yield p;
      }
      p = await sink.getNextPacket(p);
    }
    if (from !== null) {
      result.videoSeconds += last - from + (p ? p.timestamp - last : 0);
      result.kept.push([from, last]);
    }
  }
}

/**
 * Reads a cut file back and checks its video lands exactly where the source's
 * did. Returns what's wrong, or null when it matches.
 */
export async function verifyCut(cut: Blob, stamps: [number, boolean][]): Promise<string | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(cut) });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) return stamps.length ? `no video track (expected ${stamps.length} frames)` : null;
  let i = 0;
  for await (const p of new EncodedPacketSink(vt).packets(undefined, undefined, { metadataOnly: true })) {
    if (i >= stamps.length) return `more frames than kept (${stamps.length})`;
    const [ts, key] = stamps[i];
    if (Math.abs(p.timestamp - ts) > 0.002) return `frame ${i} at ${p.timestamp.toFixed(3)} s, was ${ts.toFixed(3)} s`;
    if ((p.type === 'key') !== key) return `frame ${i} (${ts.toFixed(3)} s) is ${p.type === 'key' ? 'a keyframe' : 'not a keyframe'} now, was ${key ? 'one' : 'not'}`;
    i++;
  }
  return i === stamps.length ? null : `${i} frames of ${stamps.length}`;
}
