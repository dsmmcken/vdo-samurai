// Microphone level meters for the tiles. One shared AudioContext; each stream
// gets an AnalyserNode that we read on demand.
let ctx: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, { node: AnalyserNode; buf: Float32Array<ArrayBuffer>; trackId: string }>();

/** RMS level of the stream's first audio track, in dBFS (−100 when silent or unavailable). */
export function levelDb(stream: MediaStream): number {
  const track = stream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live' || !track.enabled) return -100;
  let a = analysers.get(stream);
  if (!a || a.trackId !== track.id) {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const node = ctx.createAnalyser();
    node.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(node);
    a = { node, buf: new Float32Array(node.fftSize), trackId: track.id };
    analysers.set(stream, a);
  }
  a.node.getFloatTimeDomainData(a.buf);
  let sum = 0;
  for (const x of a.buf) sum += x * x;
  const rms = Math.sqrt(sum / a.buf.length);
  return rms > 0 ? 20 * Math.log10(rms) : -100;
}
