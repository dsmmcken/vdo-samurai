// Host-side compositing benchmark: N full-res clips -> one 1080p grid MP4.
import * as MB from '/mediabunny.mjs';

const W = 1920;
const H = 1080;
const FPS = 30;
const TARGET = { clips: 8, seconds: 20 * 60 }; // the real workload we extrapolate to
const $ = (id) => document.getElementById(id);
const log = (msg) => {
  $('log').textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  $('log').scrollTop = 1e9;
  console.log('[bench]', msg);
};

const caps = await probeCapabilities();
renderTable($('caps'), caps.rows);

const params = new URLSearchParams(location.search);
for (const k of ['clips', 'seconds', 'hw']) {
  if (!params.has(k)) continue;
  const v = params.get(k);
  if (![...$(k).options].some((o) => o.value === v)) $(k).add(new Option(v, v));
  $(k).value = v;
}
$('run').onclick = () => start('composite');
$('decode').onclick = () => start('decode');
if (params.get('auto')) start(params.get('mode') || 'composite');

async function probeCapabilities() {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const support = {};
  for (const hw of ['prefer-hardware', 'prefer-software']) {
    const dec = await VideoDecoder.isConfigSupported({ codec: 'avc1.640028', codedWidth: W, codedHeight: H, hardwareAcceleration: hw }).catch(() => ({}));
    const enc = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: FPS, hardwareAcceleration: hw }).catch(() => ({}));
    support[hw] = { decode: !!dec.supported, encode: !!enc.supported };
  }
  const yn = (b) => `<span class="${b ? 'yes' : 'no'}">${b ? 'yes' : 'no'}</span>`;
  return {
    renderer,
    support,
    cores: navigator.hardwareConcurrency,
    rows: [
      ['GPU (WebGL renderer)', escapeHtml(renderer)],
      ['H.264 1080p hardware decode', yn(support['prefer-hardware'].decode)],
      ['H.264 1080p hardware encode', yn(support['prefer-hardware'].encode)],
      ['H.264 1080p software decode / encode', `${yn(support['prefer-software'].decode)} / ${yn(support['prefer-software'].encode)}`],
      ['CPU threads', navigator.hardwareConcurrency],
    ],
  };
}

async function start(mode) {
  const clips = Number($('clips').value);
  const seconds = Number($('seconds').value);
  const hw = $('hw').value;
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  $('estimate').textContent = '–';
  renderTable($('result'), []);
  try {
    const result = await run({ mode, clips, seconds, hw });
    report(result);
  } catch (e) {
    $('status').textContent = `Failed: ${e.message}`;
    log(`FAILED: ${e.stack || e}`);
    post({ summary: `FAILED ${mode} ${clips}x${seconds}s hw=${hw}: ${e.message}`, error: String(e), caps, ua: navigator.userAgent });
  } finally {
    for (const b of document.querySelectorAll('button')) b.disabled = false;
  }
}

async function run({ mode, clips, seconds, hw }) {
  // Load clips into memory first so disk/network time isn't counted as compositing.
  $('status').textContent = 'Loading clips…';
  const t0 = performance.now();
  const blobs = await Promise.all(
    Array.from({ length: clips }, (_, i) => fetch(`/clips/clip${i % 8}.mp4`).then((r) => r.blob())),
  );
  const loadMs = performance.now() - t0;
  log(`loaded ${clips} clips (${mb(blobs.reduce((s, b) => s + b.size, 0))}) in ${(loadMs / 1000).toFixed(1)}s`);

  const inputs = blobs.map((b) => new MB.Input({ source: new MB.BlobSource(b), formats: MB.ALL_FORMATS }));
  const videoTracks = await Promise.all(inputs.map((i) => i.getPrimaryVideoTrack()));
  const audioTracks = await Promise.all(inputs.map((i) => i.getPrimaryAudioTrack()));
  const duration = Math.min(seconds, ...(await Promise.all(videoTracks.map((t) => t.computeDuration()))));
  const totalFrames = Math.floor(duration * FPS);
  const videoIters = videoTracks.map((t) => new MB.VideoSampleSink(t, { hardwareAcceleration: hw }).samples(0, duration));
  log(`${mode}: ${clips} clips × ${duration}s, ${videoTracks[0].displayWidth}x${videoTracks[0].displayHeight} ${videoTracks[0].codec}, acceleration=${hw}`);

  const timing = { decodeWait: 0, draw: 0, encodeWait: 0, audio: 0 };
  $('status').textContent = mode === 'decode' ? 'Decoding…' : 'Compositing…';
  const tStart = performance.now();
  let result;

  if (mode === 'decode') {
    // Decode every frame of every clip in parallel, nothing else.
    let frames = 0;
    await Promise.all(
      videoIters.map(async (it) => {
        for await (const s of it) {
          s.close();
          if (++frames % 60 === 0) progress(frames / clips / FPS, duration, tStart);
        }
      }),
    );
    result = { frames };
  } else {
    result = await composite({ clips, duration, totalFrames, hw, videoIters, audioTracks, timing, tStart });
  }

  const wallS = (performance.now() - tStart) / 1000;
  return { mode, clips, seconds: duration, hw, wallS, loadS: loadMs / 1000, timing, ...result };
}

async function composite({ clips, duration, totalFrames, hw, videoIters, audioTracks, timing, tStart }) {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cols = Math.ceil(Math.sqrt(clips));
  const rows = Math.ceil(clips / cols);
  const tw = Math.floor(W / cols);
  const th = Math.floor(H / rows);

  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const video = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: 8e6, keyFrameInterval: 2, hardwareAcceleration: hw });
  output.addVideoTrack(video, { frameRate: FPS });
  const withAudio = audioTracks.every(Boolean);
  // Open-source Chromium has no AAC encoder; branded Chrome does.
  const aac = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128e3 }).catch(() => ({}));
  const audioCodec = aac.supported ? 'aac' : 'opus';
  const audio = withAudio ? new MB.AudioBufferSource({ codec: audioCodec, bitrate: 128e3 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const sampleRate = withAudio ? audioTracks[0].sampleRate : 0;
  const audioPulls = withAudio ? audioTracks.map((t) => new AudioPull(new MB.AudioSampleSink(t).samples(0, duration))) : [];

  // Each clip holds its current frame and the one after; we show the latest frame <= t.
  const state = await Promise.all(videoIters.map(async (it) => ({ it, cur: null, next: (await it.next()).value ?? null })));

  for (let k = 0; k < totalFrames; k++) {
    const t = k / FPS;

    if (audio && k % FPS === 0) {
      const a0 = performance.now();
      const n = Math.min(sampleRate, Math.round((duration - t) * sampleRate));
      if (n > 0) await audio.add(await mixAudio(audioPulls, n, sampleRate));
      timing.audio += performance.now() - a0;
    }

    const d0 = performance.now();
    for (const s of state) {
      while (s.next && s.next.timestamp <= t + 1e-6) {
        s.cur?.close();
        s.cur = s.next;
        s.next = (await s.it.next()).value ?? null;
      }
    }
    const d1 = performance.now();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    state.forEach((s, i) => s.cur?.draw(ctx, (i % cols) * tw, Math.floor(i / cols) * th, tw, th));
    const d2 = performance.now();
    await video.add(t, 1 / FPS);
    const d3 = performance.now();
    timing.decodeWait += d1 - d0;
    timing.draw += d2 - d1;
    timing.encodeWait += d3 - d2;

    if (k % 15 === 0) progress(t, duration, tStart);
  }
  for (const s of state) {
    s.cur?.close();
    s.next?.close();
    await s.it.return();
  }

  $('status').textContent = 'Finalizing file…';
  await output.finalize();
  const bytes = output.target.buffer.byteLength;
  const url = URL.createObjectURL(new Blob([output.target.buffer], { type: 'video/mp4' }));
  $('download').href = url;
  $('download').download = `composite-${clips}x${Math.round(duration)}s.mp4`;
  $('download').style.display = 'inline-block';
  $('preview').src = url;
  $('preview').style.display = 'block';
  return { frames: totalFrames, outputBytes: bytes, audioCodec, layout: `${cols}x${rows} tiles of ${tw}x${th}` };
}

// Pulls decoded audio for one clip and hands out fixed-size stereo chunks.
class AudioPull {
  constructor(iter) {
    this.it = iter;
    this.ch = [new Float32Array(0), new Float32Array(0)];
  }
  async take(n) {
    while (this.ch[0].length < n) {
      const { value, done } = await this.it.next();
      if (done) break;
      const buf = value.toAudioBuffer();
      value.close();
      for (let c = 0; c < 2; c++) this.ch[c] = concat(this.ch[c], buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
    }
    const out = this.ch.map((a) => {
      const chunk = new Float32Array(n);
      chunk.set(a.subarray(0, n));
      return chunk;
    });
    this.ch = this.ch.map((a) => a.slice(Math.min(n, a.length)));
    return out;
  }
}

async function mixAudio(pulls, n, sampleRate) {
  const parts = await Promise.all(pulls.map((p) => p.take(n)));
  const mixed = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate });
  for (let c = 0; c < 2; c++) {
    const out = mixed.getChannelData(c);
    for (const p of parts) for (let i = 0; i < n; i++) out[i] += p[c][i] / pulls.length;
  }
  return mixed;
}

function concat(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function progress(t, duration, tStart) {
  const wall = (performance.now() - tStart) / 1000;
  $('bar').value = t / duration;
  $('done').textContent = `${t.toFixed(1)} / ${duration.toFixed(0)} s`;
  $('speed').textContent = wall > 0 ? `${(t / wall).toFixed(2)}×` : '–';
}

function report(r) {
  const speed = r.seconds / r.wallS; // media seconds per wall second, for this many clips
  const perClipSpeed = (speed * r.clips) / TARGET.clips; // assume cost scales with clip count
  const estimateS = TARGET.seconds / perClipSpeed;
  const ms = (x) => `${(x / r.frames).toFixed(1)} ms/frame`;
  $('status').textContent = 'Done';
  $('bar').value = 1;
  $('estimate').textContent = `${fmtDuration(estimateS)}${r.mode === 'decode' ? ' (decode only)' : ''}`;
  const rows = [
    ['Mode', r.mode],
    ['Clips × length', `${r.clips} × ${r.seconds}s`],
    ['Acceleration setting', r.hw],
    ['Wall time', `${r.wallS.toFixed(1)} s`],
    ['Speed', `${speed.toFixed(2)}× real time`],
  ];
  if (r.mode === 'composite') {
    rows.push(
      ['Waiting on decoders', ms(r.timing.decodeWait)],
      ['Drawing grid', ms(r.timing.draw)],
      ['Waiting on encoder', ms(r.timing.encodeWait)],
      ['Audio mix', `${(r.timing.audio / 1000).toFixed(1)} s total`],
      ['Layout', r.layout],
      ['Output size', mb(r.outputBytes)],
    );
  }
  renderTable($('result'), rows);
  const summary = `${r.mode} ${r.clips}x${r.seconds}s hw=${r.hw}: ${speed.toFixed(2)}x realtime, est ${fmtDuration(estimateS)} for 8x20min`;
  log(summary);
  post({ summary, ...r, speed, estimateS, caps: { renderer: caps.renderer, support: caps.support, cores: caps.cores }, ua: navigator.userAgent });
}

function post(body) {
  fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}

function renderTable(el, rows) {
  el.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}
function fmtDuration(s) {
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
}
function mb(b) {
  return `${(b / 1e6).toFixed(0)} MB`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
