import { useEffect, useRef } from 'react';

interface VideoElementProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}

export function VideoElement({ stream, muted = false, className = '' }: VideoElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      // Explicitly play to handle browser autoplay restrictions
      video.play().catch((err) => {
        // Autoplay was prevented, user interaction may be required
        console.warn('Video autoplay prevented:', err);
      });
    }
  }, [stream]);

  if (!stream) {
    return null;
  }

  return (
    <div
      className={`overflow-hidden rounded-lg ${className}`}
      style={{ anchorName: '--video-anchor' } as React.CSSProperties}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="block w-full h-full object-cover"
      />
    </div>
  );
}
