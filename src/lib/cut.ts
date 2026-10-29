// Trims a recording to what the final cut uses, before it's uploaded.
//
// The director knows the whole edit when the take stops (the stage log), so it
// tells each guest which stretches of their files it will show. The guest
// copies those stretches into a new file, packet for packet (no re-encode, no
// quality loss): video from the keyframe at or before each stretch, through
// its end. Audio is copied whole: it's small, and the render measures and
// polishes each voice over the whole take.
import type { RecFile } from './types';
import { ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny';

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
  /** The kept stretches by the source's packet order (sequence numbers): timestamps can repeat. */
  keptSeq: [number, number][];
  videoPackets: number;
  audioPackets: number;
}

/**
 * Writes `file` with only `keep` of its video (all of its audio) to `writable`;
 * with nothing to keep, no video track. A plain MP4, not fragmented like the
 * recordings: one sync-sample table lists every keyframe.
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

  const result: CutResult = { videoSeconds: 0, kept: [], stamps: [], keptSeq: [], videoPackets: 0, audioPackets: 0 };
  const video = vt && vsrc ? keptVideo(new EncodedPacketSink(vt), spans, result, vt.codec === 'avc') : null;
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

/**
 * The video packets to keep, in decode order: each span from the last real
 * keyframe at or before it, never a packet twice. Packets are told apart by
 * their order in the file, not their timestamps: recordings made with a
 * snapped frame rate have pairs of frames sharing one timestamp, and a
 * timestamp check dropped the second of each pair (the picture then froze
 * until the next keyframe). For H.264 the frame's own data says whether it's
 * a keyframe, and a packet marked otherwise is copied with the right mark.
 */
async function* keptVideo(sink: EncodedPacketSink, spans: Span[], result: CutResult, avc: boolean) {
  const isKey = (p: EncodedPacket) => (avc ? isIdr(p.data) : p.type === 'key');
  let lastSeq = -Infinity; // the last packet kept, by order in the file
  for (const [a, b] of spans) {
    // A marked keyframe at or before `a`, backing up until the data agrees...
    let start = (await sink.getKeyPacket(a)) ?? (await sink.getFirstPacket());
    while (start && !isKey(start)) {
      const prev = await sink.getKeyPacket(start.timestamp - 0.001);
      if (!prev || prev.timestamp >= start.timestamp) break; // the first packet: start there anyway
      start = prev;
    }
    if (!start) continue;
    // ...then the last real keyframe up to `a` (one might not be marked).
    let from = start;
    for await (const p of sink.packets(start)) {
      if (p.timestamp > a) break;
      if (isKey(p)) from = p;
    }
    let first: EncodedPacket | null = null;
    let end: EncodedPacket | null = null;
    for await (const p of sink.packets(from)) {
      if (p.timestamp >= b) break;
      if (p.sequenceNumber <= lastSeq) continue; // already kept for the span before
      const key = isKey(p);
      const out = key === (p.type === 'key') ? p : new EncodedPacket(p.data, key ? 'key' : 'delta', p.timestamp, p.duration, p.sequenceNumber, p.byteLength, p.sideData);
      first ??= p;
      lastSeq = p.sequenceNumber;
      end = p;
      result.videoPackets++;
      result.stamps.push([p.timestamp, key]);
      yield out;
    }
    if (first && end) {
      result.videoSeconds += end.timestamp + end.duration - first.timestamp;
      result.kept.push([first.timestamp, end.timestamp]);
      result.keptSeq.push([first.sequenceNumber, end.sequenceNumber]);
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

/**
 * Whether an H.264 frame really is a keyframe, from its own data: an IDR
 * slice (NAL type 5) in the length-prefixed NAL units MP4 stores.
 */
export function isIdr(data: Uint8Array) {
  for (let i = 0; i + 4 < data.length; ) {
    const len = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
    if ((data[i + 4] & 0x1f) === 5) return true;
    if (len <= 0) break;
    i += 4 + len;
  }
  return false;
}

/**
 * Reads the source straight through (as a decoder does) and checks the cut has
 * every one of its video frames inside the kept stretches, marked keyframe
 * exactly when the frame's data is one. (verifyCut checks the cut against what
 * was picked; this checks the picking.) Returns what's wrong, or null.
 */
export async function verifyAgainstSource(src: Blob, r: CutResult): Promise<string | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(src) });
  const vt = r.keptSeq.length ? await input.getPrimaryVideoTrack() : null;
  if (!vt) return null;
  // The source's packets inside the kept stretches, in file order, each with whether its data is a keyframe.
  const want: [number, boolean][] = [];
  for await (const p of new EncodedPacketSink(vt).packets()) {
    if (r.keptSeq.some(([a, b]) => p.sequenceNumber >= a && p.sequenceNumber <= b)) want.push([p.timestamp, vt.codec === 'avc' ? isIdr(p.data) : p.type === 'key']);
  }
  if (want.length !== r.stamps.length) return `${r.stamps.length} frames picked, ${want.length} in the source's kept stretches`;
  for (let i = 0; i < want.length; i++) {
    const [ts, key] = want[i];
    if (Math.abs(ts - r.stamps[i][0]) > 0.002) return `frame ${i}: picked ${r.stamps[i][0].toFixed(3)} s, the source has ${ts.toFixed(3)} s`;
    if (key !== r.stamps[i][1]) return `frame ${i} (${ts.toFixed(3)} s): picked as ${r.stamps[i][1] ? 'key' : 'delta'}, its data says ${key ? 'keyframe' : 'not'}`;
  }
  return null;
}
