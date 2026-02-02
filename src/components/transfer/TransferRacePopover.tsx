import { useRef, useEffect, useMemo } from 'react';
import { useTransferStore } from '../../store/transferStore';
import { useUserStore } from '../../store/userStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount';
import gateImg from '/gate.png';

interface TransferRacePopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
}

interface RacerData {
  id: string;
  name: string;
  isYou: boolean;
  progress: number;
  status: 'idle' | 'racing' | 'finished' | 'error';
  totalSize: number;
  transferredSize: number;
  fileCount: number;
  completedCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '00.0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(1);
  return value.padStart(4, '0') + ' ' + sizes[i];
}

// Preload sprite sheet for instant display
if (typeof window !== 'undefined') {
  const img = new Image();
  img.src = '/samurai-sprite.png';
}

// Sprite-based samurai animation component
function SamuraiSprite({
  animation,
  isYou,
  className = ''
}: {
  animation: 'run' | 'idle';
  isYou: boolean;
  className?: string;
}) {
  const animClass = animation === 'run' ? 'samurai-sprite-run' : 'samurai-sprite-idle';
  const tintClass = isYou ? 'samurai-tint-red' : 'samurai-tint-blue';
  return <div className={`samurai-sprite ${animClass} ${tintClass} ${className}`} />;
}

function RacerRow({ racer, position }: { racer: RacerData; position: number }) {
  const isYou = racer.isYou;
  const progressPercent = Math.round(racer.progress * 100);

  // Samurai position: linear but capped at 85% to stay on screen near gate (even when finished)
  const samuraiPos = Math.min(racer.progress * 100, 85);

  // Fill position: trails just slightly behind samurai, but continues to 100% at the end
  // Using progress^1.1 gives subtle trailing that passes the samurai toward the end
  const fillPos = racer.status === 'finished' ? 100 : Math.pow(racer.progress, 1.1) * 100;

  // Determine which animation to use (run during race, idle otherwise)
  const samuraiAnimation = racer.status === 'racing' ? 'run' : 'idle';

  return (
    <div className="relative">
      {/* Racer info header */}
      <div className="flex items-center justify-between mb-1.5 px-1">
        <div className="flex items-center gap-2">
          <span className="text-[--color-primary]/60 text-xs font-mono">#{position}</span>
          <span
            className={`text-sm font-semibold ${isYou ? 'text-[--color-primary]' : 'text-gray-200'}`}
          >
            {racer.name}
            {isYou && (
              <span className="ml-1.5 text-[10px] bg-[--color-primary]/20 text-[--color-primary] px-1.5 py-0.5 rounded-full">
                YOU
              </span>
            )}
          </span>
        </div>
        <div className="text-xs text-gray-400 font-mono tabular-nums">
          {racer.completedCount}/{racer.fileCount} files
        </div>
      </div>

      {/* Race track */}
      <div className="relative h-10 bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
        {/* Progress track fill - gradient trailing behind the samurai */}
        <div
          className={`absolute z-0 left-0 top-0 bottom-0 transition-all duration-500 ease-out overflow-hidden ${
            racer.status === 'finished'
              ? 'race-fill-finished'
              : racer.status === 'racing'
                ? isYou
                  ? 'race-fill-racing-you'
                  : 'race-fill-racing-other'
                : 'bg-gray-800/30'
          }`}
          style={{ width: `${fillPos}%` }}
        />

        {/* Finish gate */}
        <div className="absolute z-10 right-1 top-0 bottom-0 flex items-center justify-center">
          <img src={gateImg} alt="Finish gate" className="h-full object-contain" />
        </div>

        {/* Samurai runner - sprite animation */}
        <div
          className="absolute z-20 bottom-0 transition-all duration-500 ease-out"
          style={{ left: `${samuraiPos}%` }}
        >
          <SamuraiSprite
            animation={samuraiAnimation}
            isYou={isYou}
            className="drop-shadow-lg"
          />
        </div>

        {/* Progress percentage badge - anchored left */}
        <div
          className={`absolute z-30 left-2 top-1/2 -translate-y-1/2 text-xs font-mono font-bold ${
            racer.status === 'finished'
              ? 'text-emerald-400'
              : racer.status === 'racing'
                ? 'text-[--color-primary]'
                : 'text-gray-500'
          }`}
        >
          {String(progressPercent).padStart(2, '0')}%
        </div>
      </div>

      {/* Transfer details */}
      <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-gray-500">
        <span>
          {racer.status === 'finished' && <span className="text-emerald-500">✓ Complete</span>}
          {racer.status === 'racing' && (
            <span className="text-[--color-primary] samurai-dots">Sending</span>
          )}
          {racer.status === 'idle' && <span>Waiting</span>}
        </span>
        <span className="font-mono tabular-nums">
          {formatBytes(racer.transferredSize)} / {formatBytes(racer.totalSize)}
        </span>
      </div>
    </div>
  );
}

export function TransferRacePopover({ anchorRef, onDismiss }: TransferRacePopoverProps) {
  const { transfers } = useTransferStore();
  const { profile } = useUserStore();
  const { activePopover, closePopover } = usePopoverStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  const isOpen = activePopover === 'transfer';
  const { shouldRender, isExiting } = useDelayedUnmount(isOpen);

  // Close on outside click
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

  // Build racer data from transfers - group by actual sender (using senderId)
  const racers = useMemo(() => {
    const racerMap = new Map<string, RacerData>();

    // Group transfers by sender (use senderId for accurate grouping)
    transfers.forEach((transfer) => {
      const isYou = transfer.role === 'sender';
      const racerId = transfer.senderId;
      const racerName = isYou ? profile?.displayName || 'You' : transfer.senderName;

      if (!racerMap.has(racerId)) {
        racerMap.set(racerId, {
          id: racerId,
          name: racerName,
          isYou: isYou,
          progress: 0,
          status: 'idle',
          totalSize: 0,
          transferredSize: 0,
          fileCount: 0,
          completedCount: 0
        });
      }

      const racer = racerMap.get(racerId)!;
      racer.fileCount++;
      racer.totalSize += transfer.size;
      racer.transferredSize += transfer.size * transfer.progress;

      if (transfer.status === 'complete') {
        racer.completedCount++;
      }
      if (transfer.status === 'active' || transfer.status === 'pending') {
        racer.status = 'racing';
      }
      if (transfer.status === 'error') {
        racer.status = 'error';
      }
    });

    // Calculate final progress and status for each racer
    racerMap.forEach((racer) => {
      racer.progress = racer.totalSize > 0 ? racer.transferredSize / racer.totalSize : 0;
      if (racer.completedCount === racer.fileCount && racer.fileCount > 0) {
        racer.status = 'finished';
        racer.progress = 1;
      }
    });

    // Sort: you first, then by progress descending
    return Array.from(racerMap.values()).sort((a, b) => {
      if (a.isYou) return -1;
      if (b.isYou) return 1;
      return b.progress - a.progress;
    });
  }, [transfers, profile]);

  if (!shouldRender) return null;

  const totalFiles = transfers.length;
  const completedFiles = transfers.filter((t) => t.status === 'complete').length;
  const allComplete = completedFiles === totalFiles && totalFiles > 0;

  return (
    <div
      ref={popoverRef}
      className={`
        absolute right-2 top-full mt-1 w-80
        border rounded-xl shadow-2xl z-50
        ${isExiting ? 'popover-exit' : 'popover-enter'}
        bg-gray-950/95 border-gray-700/50 backdrop-blur-xl
      `}
    >
      {/* Header with Japanese-inspired styling */}
      <div className="relative px-4 py-3 border-b border-gray-700/50 overflow-hidden">
        {/* Decorative background pattern */}
        <div className="absolute inset-0 opacity-5">
          <svg className="w-full h-full" preserveAspectRatio="none">
            <pattern id="header-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="0.5" />
              <circle cx="20" cy="20" r="8" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
            <rect
              width="100%"
              height="100%"
              fill="url(#header-pattern)"
              className="text-[--color-primary]"
            />
          </svg>
        </div>

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Decorative emblem */}
            <div className="w-6 h-6 rounded-full bg-[--color-primary]/10 border border-[--color-primary]/30 flex items-center justify-center">
              <svg
                className="w-3.5 h-3.5 text-[--color-primary]"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.5L18 8v8l-6 3.5L6 16V8l6-3.5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-100 tracking-wide">File transfer</h3>
              <p className="text-[10px] text-gray-400">
                Keep browser open until your transfer completes.
              </p>
            </div>
          </div>
          <div
            className={`text-xs font-mono px-2 py-1 rounded-full ${
              allComplete
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-[--color-primary]/20 text-[--color-primary]'
            }`}
          >
            {completedFiles}/{totalFiles}
          </div>
        </div>
      </div>

      {/* Race tracks */}
      <div className="p-3 space-y-4 max-h-80 overflow-y-auto no-scrollbar">
        {racers.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">No active transfers</div>
        ) : (
          racers.map((racer, index) => (
            <RacerRow key={racer.id} racer={racer} position={index + 1} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-700/50 flex items-center justify-between">
        <span className="text-[10px] text-gray-600">
          {allComplete ? '🎌 All transfers complete!' : '⚔️ Battle in progress...'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => useTransferStore.getState().simulateRace(5000)}
            className="text-[10px] text-orange-400/70 hover:text-orange-400 transition-colors cursor-pointer"
          >
            Simulate
          </button>
          {allComplete && (
            <button
              onClick={() => {
                onDismiss();
                closePopover();
              }}
              className="text-[10px] text-[--color-primary]/70 hover:text-[--color-primary] transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          )}
          <button
            onClick={closePopover}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
