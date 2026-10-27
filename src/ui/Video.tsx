import { useEffect, useRef } from 'react';

export function Video({ stream, mirror, fit = 'cover', className }: { stream: MediaStream | null; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted style={{ objectFit: fit, transform: mirror ? 'scaleX(-1)' : undefined }} />;
}

/** Plays a remote person's microphone. */
export function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}
