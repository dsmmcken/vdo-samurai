import { useRef, useCallback, useEffect, useState } from 'react';
import { useNLEStore } from '../../store/nleStore';
import { useTransferStore } from '../../store/transferStore';
import { TimelineClip } from './TimelineClip';
import { Playhead } from './Playhead';

interface TimelineProps {
  onPlayheadDragStart?: () => void;
  onPlayheadDragEnd?: () => void;
}

export function Timeline({ onPlayheadDragStart, onPlayheadDragEnd }: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const {
    clips,
    playheadPosition,
    selectedClipId,
    totalDuration,
    zoom,
    setPlayheadPosition,
    setSelectedClipId,
    trimClip,
    setZoom,
    setZoomToFit,
    calculateTotalDuration,
  } = useNLEStore();

  const [hasInitializedZoom, setHasInitializedZoom] = useState(false);

  const { transfers, receivedRecordings } = useTransferStore();

  // Fit timeline to container width on first load
  // This effect intentionally sets state once on initialization
  useEffect(() => {
    if (hasInitializedZoom || totalDuration <= 0 || !timelineRef.current) return;

    const containerWidth = timelineRef.current.clientWidth - 20; // Account for padding
    if (containerWidth > 0) {
      setZoomToFit(containerWidth);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasInitializedZoom(true);
    }
  }, [totalDuration, hasInitializedZoom, setZoomToFit]);

  // pixels per millisecond
  const pixelsPerMs = zoom / 1000;

  // Check if a peer's transfer is still in progress
  const isPeerTransferring = useCallback(
    (peerId: string | null): boolean => {
      if (peerId === null) return false; // Local user, no transfer needed

      // Check if there's an active/pending transfer for this peer
      const peerTransfer = transfers.find(
        (t) => t.peerId === peerId && (t.status === 'pending' || t.status === 'active')
      );
      if (peerTransfer) return true;

      // Check if we've received this peer's recording
      const hasReceived = receivedRecordings.some((r) => r.peerId === peerId);
      return !hasReceived;
    },
    [transfers, receivedRecordings]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newPosition = Math.max(0, Math.min(totalDuration, x / pixelsPerMs));
      setPlayheadPosition(newPosition);
      setSelectedClipId(null);
    },
    [pixelsPerMs, totalDuration, setPlayheadPosition, setSelectedClipId]
  );

  const handleTrimStart = useCallback(
    (clipId: string, deltaTrimStart: number) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const maxTrimStart = clip.endTime - clip.startTime - clip.trimEnd - 100; // Min 100ms remaining
      const newTrimStart = Math.max(0, Math.min(maxTrimStart, clip.trimStart + deltaTrimStart));
      trimClip(clipId, newTrimStart, clip.trimEnd);
      calculateTotalDuration();
    },
    [clips, trimClip, calculateTotalDuration]
  );

  const handleTrimEnd = useCallback(
    (clipId: string, deltaTrimEnd: number) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;

      const maxTrimEnd = clip.endTime - clip.startTime - clip.trimStart - 100; // Min 100ms remaining
      const newTrimEnd = Math.max(0, Math.min(maxTrimEnd, clip.trimEnd - deltaTrimEnd));
      trimClip(clipId, clip.trimStart, newTrimEnd);
      calculateTotalDuration();
    },
    [clips, trimClip, calculateTotalDuration]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -10 : 10;
        setZoom(zoom + delta);
      }
    },
    [zoom, setZoom]
  );

  const sortedClips = [...clips].sort((a, b) => a.order - b.order);

  // Generate time ruler marks
  const timeRulerMarks: number[] = [];
  const markInterval = zoom >= 50 ? 1000 : zoom >= 20 ? 5000 : 10000; // ms between marks
  // Guard against invalid durations and limit max marks to prevent memory issues
  const safeDuration = Math.min(Math.max(0, totalDuration || 0), 3600000); // Max 1 hour
  const maxMarks = 100;
  for (let t = 0; t <= safeDuration && timeRulerMarks.length < maxMarks; t += markInterval) {
    timeRulerMarks.push(t);
  }

  return (
    <div className="flex flex-col bg-gray-900 rounded-lg overflow-hidden">
      {/* Zoom controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className="text-xs text-gray-400">Timeline</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(Math.ceil(zoom / 10) * 10 - 10)}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span
            className="text-xs text-gray-500 w-12 text-center cursor-pointer hover:text-gray-300"
            onDoubleClick={() => {
              if (timelineRef.current) {
                setZoomToFit(timelineRef.current.clientWidth - 20);
              }
            }}
            title="Double-click to fit"
          >
            {Math.round(zoom)}%
          </span>
          <button
            onClick={() => setZoom(Math.floor(zoom / 10) * 10 + 10)}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Time ruler */}
      <div className="relative h-6 border-b border-gray-700 bg-gray-800/50 overflow-x-auto no-scrollbar">
        <div
          style={{ width: `${Math.max(totalDuration * pixelsPerMs, 200)}px` }}
          className="relative h-full"
        >
          {timeRulerMarks.map((t) => (
            <div
              key={t}
              className="absolute top-0 h-full flex flex-col items-center"
              style={{ left: `${t * pixelsPerMs}px` }}
            >
              <div className="w-px h-2 bg-gray-600" />
              <span className="text-[9px] text-gray-500 mt-0.5">{formatTime(t)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline track */}
      <div
        ref={timelineRef}
        className="relative h-20 overflow-x-auto overflow-y-hidden cursor-pointer no-scrollbar"
        onClick={handleTimelineClick}
        onWheel={handleWheel}
      >
        <div
          className="relative h-full min-w-full"
          style={{ width: `${Math.max(totalDuration * pixelsPerMs + 100, 200)}px` }}
        >
          {/* Clip track */}
          <div className="absolute top-4 left-0 right-0 flex items-center gap-1 px-2">
            {sortedClips.map((clip) => (
              <TimelineClip
                key={clip.id}
                clip={clip}
                pixelsPerMs={pixelsPerMs}
                isSelected={selectedClipId === clip.id}
                isTransferring={isPeerTransferring(clip.peerId)}
                onSelect={() => setSelectedClipId(clip.id)}
                onTrimStart={(delta) => handleTrimStart(clip.id, delta)}
                onTrimEnd={(delta) => handleTrimEnd(clip.id, delta)}
                onDragStart={() => {}}
                onDragEnd={() => {}}
              />
            ))}
          </div>

          {/* Playhead */}
          <Playhead
            position={playheadPosition}
            pixelsPerMs={pixelsPerMs}
            maxPosition={totalDuration}
            onPositionChange={setPlayheadPosition}
            onDragStart={onPlayheadDragStart}
            onDragEnd={onPlayheadDragEnd}
          />
        </div>
      </div>

      {/* Duration info */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
        <span>Duration: {formatTime(totalDuration)}</span>
        <span>Playhead: {formatTime(playheadPosition)}</span>
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
