import { useEffect, useState, useCallback, useRef } from 'react';

interface OnAirIndicatorProps {
  isRecording: boolean;
  startTime: number | null;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function OnAirIndicator({ isRecording, startTime }: OnAirIndicatorProps) {
  const [elapsed, setElapsed] = useState('00:00');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateElapsed = useCallback(() => {
    if (startTime) {
      setElapsed(formatTime(Date.now() - startTime));
    }
  }, [startTime]);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isRecording || !startTime) {
      // Reset elapsed when not recording
      if (elapsed !== '00:00') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset state when recording stops
        setElapsed('00:00');
      }
      return;
    }

    // Initial update and set interval
    updateElapsed();
    intervalRef.current = setInterval(updateElapsed, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, startTime, updateElapsed, elapsed]);

  if (!isRecording) return null;

  return (
    <div className="fixed top-4 right-4 flex items-center gap-3 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-40">
      <span className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
      </span>
      <span className="font-bold tracking-wide">ON AIR</span>
      <span className="font-mono text-sm bg-red-600 px-2 py-0.5 rounded">{elapsed}</span>
    </div>
  );
}
