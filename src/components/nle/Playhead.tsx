import { useRef, useCallback, useEffect, useState } from 'react';

interface PlayheadProps {
  position: number; // in milliseconds
  pixelsPerMs: number;
  maxPosition: number;
  onPositionChange: (position: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function Playhead({
  position,
  pixelsPerMs,
  maxPosition,
  onPositionChange,
  onDragStart,
  onDragEnd
}: PlayheadProps) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const xPosition = position * pixelsPerMs;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      onDragStart?.();
    },
    [onDragStart]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const timeline = playheadRef.current?.parentElement;
      if (!timeline) return;

      const rect = timeline.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newPosition = Math.max(0, Math.min(maxPosition, x / pixelsPerMs));
      onPositionChange(newPosition);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onDragEnd?.();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, pixelsPerMs, maxPosition, onPositionChange, onDragEnd]);

  return (
    <div
      ref={playheadRef}
      className={`absolute top-0 bottom-0 z-20 cursor-ew-resize group ${
        isDragging ? 'cursor-grabbing' : ''
      }`}
      style={{ left: `${xPosition}px`, transform: 'translateX(-50%)' }}
      onMouseDown={handleMouseDown}
    >
      {/* Playhead line */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-white left-1/2 -translate-x-1/2" />

      {/* Playhead handle (triangle at top) */}
      <div
        className={`absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0
        border-l-[6px] border-l-transparent
        border-r-[6px] border-r-transparent
        border-t-[8px] border-t-white
        transition-transform ${isDragging ? 'scale-125' : 'group-hover:scale-110'}`}
      />

      {/* Time tooltip */}
      <div
        className={`absolute top-3 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-white text-black rounded text-[10px] font-medium whitespace-nowrap transition-opacity ${
          isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {formatTime(position)}
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
}
