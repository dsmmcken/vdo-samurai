import { useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTransferStore } from '../../store/transferStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useSessionStore } from '../../store/sessionStore';
import { TransferRacePopover } from './TransferRacePopover';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '00.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(1);
  return value.padStart(4, '0') + ' ' + sizes[i];
}

export function TransferIndicator() {
  const { transfers, indicatorDismissed, hasHadTransfers, setIndicatorDismissed } =
    useTransferStore();
  const { activePopover, togglePopover } = usePopoverStore();
  const { isHost, sessionId } = useSessionStore();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevTransferCountRef = useRef(0);
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const isSessionPage = location.pathname.startsWith('/session/');

  // Auto-open popover when transfers start (transition from 0 to > 0)
  // Only auto-open on session page to avoid blocking other UI elements
  useEffect(() => {
    if (isSessionPage && prevTransferCountRef.current === 0 && transfers.length > 0) {
      usePopoverStore.getState().openPopover('transfer');
    }
    prevTransferCountRef.current = transfers.length;
  }, [transfers.length, isSessionPage]);

  // Show if we've ever had transfers and not dismissed
  // Also show for host when in a session (so they can see the race like participants)
  const isHostInSession = isHost && sessionId !== null;
  const shouldShow =
    ((transfers.length > 0 || hasHadTransfers) && !indicatorDismissed) || isHostInSession;
  if (!shouldShow) return null;

  // Calculate progress for all transfers (both sending and receiving)
  const activeTransfers = transfers.filter((t) => t.status === 'active' || t.status === 'pending');
  const completedTransfers = transfers.filter((t) => t.status === 'complete');
  const totalProgress =
    transfers.length > 0 ? transfers.reduce((acc, t) => acc + t.progress, 0) / transfers.length : 0;

  // Get total transfer size
  const totalSize = transfers.reduce((acc, t) => acc + t.size, 0);
  const transferredSize = transfers.reduce((acc, t) => acc + t.size * t.progress, 0);

  const isActive = activeTransfers.length > 0;
  const allComplete = transfers.length > 0 && completedTransfers.length === transfers.length;
  const isPopoverOpen = activePopover === 'transfer';

  const getTextColor = () => {
    if (isHomePage) return 'text-gray-800';
    return 'text-white';
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => togglePopover('transfer')}
        className={`
          relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
          transition-all cursor-pointer group
          ${isHomePage ? 'bg-gray-100 hover:bg-gray-200' : 'bg-white/10 hover:bg-white/20'}
          ${isPopoverOpen ? 'ring-2 ring-[--color-primary]/50' : ''}
        `}
        aria-label="File transfers"
        aria-expanded={isPopoverOpen}
      >
        {/* Progress info */}
        <div className={`flex items-center gap-1.5 ${getTextColor()}`}>
          {isActive ? (
            <>
              <span className="font-mono tabular-nums">{String(Math.round(totalProgress * 100)).padStart(2, '0')}%</span>
              <span className="text-[10px] opacity-60 font-mono tabular-nums">
                {formatBytes(transferredSize)}/{formatBytes(totalSize)}
              </span>
            </>
          ) : allComplete ? (
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Done</span>
            </span>
          ) : (
            <span>{transfers.length} files</span>
          )}
        </div>

        {/* Mini progress bar */}
        {isActive && (
          <div
            className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-b-md overflow-hidden ${isHomePage ? 'bg-gray-300' : 'bg-white/20'}`}
          >
            <div
              className="h-full bg-[--color-primary] transition-all duration-300 ease-out"
              style={{ width: `${totalProgress * 100}%` }}
            />
          </div>
        )}
      </button>

      <TransferRacePopover anchorRef={buttonRef} onDismiss={() => setIndicatorDismissed(true)} />
    </>
  );
}
