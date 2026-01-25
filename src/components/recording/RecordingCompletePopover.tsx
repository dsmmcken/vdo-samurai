import { useRef, useEffect, useState } from 'react';
import { usePopoverStore } from '../../store/popoverStore';

interface RecordingCompletePopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onBeginTransfer: () => void;
  onDiscard: () => void;
}

export function RecordingCompletePopover({
  anchorRef,
  onBeginTransfer,
  onDiscard,
}: RecordingCompletePopoverProps) {
  const { activePopover, closePopover } = usePopoverStore();
  const [isExiting, setIsExiting] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isOpen = activePopover === 'recordingComplete';

  // Handle mount/unmount with exit animation
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsExiting(false);
    } else if (shouldRender) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, closePopover, anchorRef]);

  const handleBeginTransfer = () => {
    closePopover();
    onBeginTransfer();
  };

  const handleDiscard = () => {
    closePopover();
    onDiscard();
  };

  if (!shouldRender) return null;

  return (
    <div
      ref={popoverRef}
      className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 border rounded-xl shadow-lg z-50 backdrop-blur-xl bg-black/90 border-gray-700 ${
        isExiting ? 'popover-exit' : 'popover-enter'
      }`}
      style={{ transformOrigin: 'bottom center' }}
    >
      <div className="p-4 space-y-3">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-white">Recording Complete</h3>
          <p className="text-xs text-gray-400 mt-1">What would you like to do?</p>
        </div>

        <div className="space-y-2">
          <button
            onClick={handleBeginTransfer}
            className="w-full py-2.5 px-4 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Begin Transfer & Edit
          </button>

          <button
            onClick={handleDiscard}
            className="w-full py-2 px-4 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800/50 text-sm transition-colors"
          >
            Discard Recording
          </button>
        </div>
      </div>
    </div>
  );
}
