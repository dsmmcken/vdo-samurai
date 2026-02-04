import { useEffect, useRef } from 'react';

interface TileContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  participantId: string;
  participantName: string;
  isParticipantHost: boolean;
  isParticipantElectron: boolean;
  canMakeHost: boolean;
  disabledReason?: string;
  onClose: () => void;
  onMakeHost: () => void;
}

export function TileContextMenu({
  isOpen,
  position,
  participantName,
  isParticipantHost,
  isParticipantElectron,
  canMakeHost,
  disabledReason,
  onClose,
  onMakeHost
}: TileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMakeHostClick = () => {
    if (canMakeHost) {
      onMakeHost();
      onClose();
    }
  };

  // Determine the tooltip/disabled reason
  let tooltipText = '';
  if (isParticipantHost) {
    tooltipText = 'Already the host';
  } else if (!isParticipantElectron) {
    tooltipText = 'Browser users cannot become host';
  } else if (disabledReason) {
    tooltipText = disabledReason;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] py-1 bg-black/90 backdrop-blur-xl border border-gray-700 rounded-lg shadow-lg"
      style={{
        left: position.x,
        top: position.y
      }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700 truncate">
        {participantName}
      </div>

      <button
        onClick={handleMakeHostClick}
        disabled={!canMakeHost}
        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
          canMakeHost
            ? 'text-white hover:bg-white/10 cursor-pointer'
            : 'text-gray-500 cursor-not-allowed'
        }`}
        title={tooltipText}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        <span>Make Host</span>
        {!canMakeHost && tooltipText && (
          <span className="ml-auto text-xs text-gray-600">({tooltipText})</span>
        )}
      </button>
    </div>
  );
}
