import { useEffect, useRef } from 'react';

interface VideoElementProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}

export function VideoElement({ stream, muted = false, className = '' }: VideoElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  console.log('[VideoElement] Rendering with stream:', !!stream, stream?.getVideoTracks());

  useEffect(() => {
    const video = videoRef.current;
    console.log('[VideoElement] useEffect - video element:', !!video, 'stream:', !!stream);
    if (video && stream) {
      const videoTracks = stream.getVideoTracks();
      console.log('[VideoElement] Setting srcObject, video tracks:', videoTracks, 'enabled:', videoTracks.map(t => t.enabled));
      video.srcObject = stream;
      // Explicitly play to handle browser autoplay restrictions
      video.play().catch((err) => {
        // Autoplay was prevented, user interaction may be required
        console.warn('Video autoplay prevented:', err);
      });
    }
  }, [stream]);

  if (!stream) {
    console.log('[VideoElement] No stream, returning null');
    return null;
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={`${className}`}
    />
  );
}
