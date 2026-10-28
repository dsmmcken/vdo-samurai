// Local capture and the live (meeting) encoder profiles.
//
// We capture once at full quality because the local recording needs it. The
// meeting copy of each track is downscaled and capped per sender, so encoding
// and upload stay tiny. Only the person on stage sends a bigger picture.

// Capped at 1080p30 like screen shares: a 4K camera is downscaled by the browser.
const VIDEO: MediaTrackConstraints = { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } };
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export type DeviceKind = 'cam' | 'mic' | 'speaker';

/** The device someone picked last time (per browser), if any. */
export function devicePref(kind: DeviceKind): string | null {
  try {
    return localStorage.getItem(`samurai:dev:${kind}`);
  } catch {
    return null;
  }
}
export function setDevicePref(kind: DeviceKind, id: string | null) {
  try {
    if (id) localStorage.setItem(`samurai:dev:${kind}`, id);
    else localStorage.removeItem(`samurai:dev:${kind}`);
  } catch {
    /* storage unavailable */
  }
}

/** Opens a track on the chosen device, falling back to the default if it's gone. */
async function open(kind: 'video' | 'audio', deviceId: string | null): Promise<MediaStreamTrack> {
  const base = kind === 'video' ? VIDEO : AUDIO;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ [kind]: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
    return s.getTracks()[0];
  } catch (e) {
    if (!deviceId) throw e;
    const s = await navigator.mediaDevices.getUserMedia({ [kind]: base });
    return s.getTracks()[0];
  }
}
export const openVideoTrack = (deviceId = devicePref('cam')) => open('video', deviceId);
export const openMicTrack = (deviceId = devicePref('mic')) => open('audio', deviceId);

export async function openCamera(): Promise<MediaStream> {
  const cam = devicePref('cam');
  const mic = devicePref('mic');
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: cam ? { ...VIDEO, deviceId: { exact: cam } } : VIDEO,
      audio: mic ? { ...AUDIO, deviceId: { exact: mic } } : AUDIO,
    });
  } catch (e) {
    if (!cam && !mic) throw e;
    return navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO }); // a saved device was unplugged
  }
}

export async function openScreen(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.contentHint = 'detail';
    // A 4K monitor would otherwise be captured (and encoded) at full size, which
    // some hardware encoders refuse; 1080p is what the final cut uses anyway.
    await track.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } }).catch(() => {});
  }
  return stream;
}

export type CamRole = 'tile' | 'grid' | 'stage';

const CAM: Record<CamRole, { height: number; maxBitrate: number; maxFramerate: number }> = {
  tile: { height: 180, maxBitrate: 120_000, maxFramerate: 15 },
  grid: { height: 270, maxBitrate: 250_000, maxFramerate: 20 },
  stage: { height: 540, maxBitrate: 600_000, maxFramerate: 24 },
};

const scaleFor = (track: MediaStreamTrack, height: number) =>
  Math.max(1, (track.getSettings().height || height) / height);

export function camEncoding(track: MediaStreamTrack, role: CamRole): RTCRtpEncodingParameters {
  const p = CAM[role];
  return { active: true, scaleResolutionDownBy: scaleFor(track, p.height), maxBitrate: p.maxBitrate, maxFramerate: p.maxFramerate };
}

/**
 * A screen sent as a plain WebRTC track (screencast.ts covers the usual case),
 * only while it's on stage. Full size: any downscale blurs small text.
 */
export function screenEncoding(track: MediaStreamTrack, onStage: boolean): RTCRtpEncodingParameters {
  return { active: onStage, scaleResolutionDownBy: scaleFor(track, 1080), maxBitrate: 900_000, maxFramerate: 8 };
}

export const MIC_ENCODING: RTCRtpEncodingParameters = { maxBitrate: 32_000 };
