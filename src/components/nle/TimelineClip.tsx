import { useRef, useState, useCallback, useEffect } from 'react';
import type { NLEClip } from '../../store/nleStore';
import { getClipDuration } from '../../store/nleStore';
import { getColorValue } from '../../utils/colorHash';

interface TimelineClipProps {
  clip: NLEClip;
  pixelsPerMs: number;
  isSelected: boolean;
  isTransferring: boolean;
  onSelect: () => void;
  onTrimStart: (delta: number) => void;
  onTrimEnd: (delta: number) => void;
  onDragStart: () => void;
  onDragEnd: (newOrder: number) => void;
}

export function TimelineClip({
  clip,
  pixelsPerMs,
  isSelected,
  isTransferring,
  onSelect,
  onTrimStart,
  onTrimEnd,
  onDragStart,
  onDragEnd
}: TimelineClipProps) {
  const clipRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTrimming, setIsTrimming] = useState<'start' | 'end' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);

  const duration = getClipDuration(clip);
  const width = duration * pixelsPerMs;
  const color = getColorValue(clip.peerName);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();

      const target = e.target as HTMLElement;
      const rect = clipRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Check if clicking on trim handles
      const x = e.clientX - rect.left;
      if (x < 8) {
        setIsTrimming('start');
        setDragStartX(e.clientX);
      } else if (x > rect.width - 8) {
        setIsTrimming('end');
        setDragStartX(e.clientX);
      } else if (!target.classList.contains('trim-handle')) {
        setIsDragging(true);
        setDragStartX(e.clientX);
        onDragStart();
      }
    },
    [onSelect, onDragStart]
  );

  useEffect(() => {
    if (!isTrimming && !isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX;
      const deltaMs = deltaX / pixelsPerMs;

      if (isTrimming === 'start') {
        onTrimStart(deltaMs);
        setDragStartX(e.clientX);
      } else if (isTrimming === 'end') {
        onTrimEnd(deltaMs);
        setDragStartX(e.clientX);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        // Calculate new order based on position
        onDragEnd(clip.order);
      }
      setIsTrimming(null);
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isTrimming,
    isDragging,
    dragStartX,
    pixelsPerMs,
    onTrimStart,
    onTrimEnd,
    onDragEnd,
    clip.order
  ]);

  return (
    <div
      ref={clipRef}
      data-testid="timeline-clip"
      data-peer-name={clip.peerName}
      data-duration={duration}
      className={`relative h-12 rounded cursor-pointer select-none group transition-all ${
        isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-black' : ''
      } ${isDragging ? 'opacity-70 cursor-grabbing' : ''}`}
      style={{
        width: `${Math.max(width, 20)}px`,
        backgroundColor: color
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Animated stripes for transferring clips */}
      {isTransferring && (
        <div
          className="absolute inset-0 rounded clip-transferring"
          style={{ backgroundColor: color }}
        />
      )}

      {/* Left trim handle */}
      <div
        className={`trim-handle absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors rounded-l ${
          isSelected ? 'bg-white/20' : ''
        }`}
      />

      {/* Right trim handle */}
      <div
        className={`trim-handle absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors rounded-r ${
          isSelected ? 'bg-white/20' : ''
        }`}
      />

      {/* Clip content */}
      <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
        <span className="text-xs font-medium text-white truncate drop-shadow-sm">
          {clip.peerName}
        </span>
      </div>

      {/* Duration indicator on hover */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-black/80 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {formatDuration(duration)}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const remainingMs = Math.floor((ms % 1000) / 10);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${remainingMs.toString().padStart(2, '0')}`;
}
