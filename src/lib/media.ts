// Local capture and the live (meeting) encoder profiles.
//
// We capture once at full quality because the local recording needs it. The
// meeting copy of each track is downscaled and capped per sender, so encoding
// and upload stay tiny. Only the person on stage sends a bigger picture.

export async function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    // Capped at 1080p30 like screen shares: a 4K camera is downscaled by the browser.
    video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
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

/** Screen previews are only sent while that screen is on stage. */
export function screenEncoding(track: MediaStreamTrack, onStage: boolean): RTCRtpEncodingParameters {
  return { active: onStage, scaleResolutionDownBy: scaleFor(track, 720), maxBitrate: 900_000, maxFramerate: 8 };
}

export const MIC_ENCODING: RTCRtpEncodingParameters = { maxBitrate: 32_000 };
