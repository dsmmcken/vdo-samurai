import { useEffect, useState, useRef, useCallback } from 'react';

interface CountdownOverlayProps {
  countdown: number | null;
}

export function CountdownOverlay({ countdown }: CountdownOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCountdownRef = useRef<number | null>(null);

  const handleCountdownChange = useCallback(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (countdown !== null) {
      setVisible(true);
      setDisplayCount(countdown);
    } else if (prevCountdownRef.current !== null) {
      // Brief delay before hiding after countdown ends
      timerRef.current = setTimeout(() => setVisible(false), 300);
    }

    prevCountdownRef.current = countdown;
  }, [countdown]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Responding to countdown prop change is valid
    handleCountdownChange();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [handleCountdownChange]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="text-center">
        <div
          key={displayCount}
          className="text-[12rem] font-bold text-white animate-bounce"
          style={{
            textShadow: '0 0 60px rgba(99, 102, 241, 0.8), 0 0 120px rgba(99, 102, 241, 0.4)'
          }}
        >
          {displayCount}
        </div>
        <p className="text-2xl text-gray-300 mt-4">Recording starting...</p>
      </div>
    </div>
  );
}
