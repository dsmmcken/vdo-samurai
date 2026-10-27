import { useEffect, useRef } from 'react';

export function Video({ stream, mirror, fit = 'cover', className }: { stream: MediaStream | null; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted style={{ objectFit: fit, transform: mirror ? 'scaleX(-1)' : undefined }} />;
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
