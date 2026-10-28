import { useEffect, useMemo, useRef } from 'react';

/**
 * A muted, picture-only view of a stream. It's given a video-only copy of the
 * stream: Firefox only puts its Picture-in-Picture pop-out button on videos
 * that have an audio track (voices play through RemoteAudio instead), and
 * disablePictureInPicture asks every browser not to offer it.
 */
export function Video({ stream, mirror, fit = 'cover', className }: { stream: MediaStream | null; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Rebuilt when the video track changes (camera switched or turned back on).
  const trackIds = stream?.getVideoTracks().map((t) => t.id).join() ?? '';
  const videoOnly = useMemo(() => (stream ? new MediaStream(stream.getVideoTracks()) : null), [stream, trackIds]);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== videoOnly) ref.current.srcObject = videoOnly;
  }, [videoOnly]);
  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      style={{ objectFit: fit, transform: mirror ? 'scaleX(-1)' : undefined }}
    />
  );
}

/** Plays a remote person's microphone. */
export function RemoteAudio({ stream, sinkId }: { stream: MediaStream | null; sinkId?: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  // Chosen speakers / headphones (Chrome's setSinkId); '' is the system default.
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    el?.setSinkId?.(sinkId ?? '').catch((e) => console.warn('[audio] setSinkId failed', e));
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}
