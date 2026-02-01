import { useRef, useEffect, useMemo } from 'react';
import { useTransferStore } from '../../store/transferStore';
import { useUserStore } from '../../store/userStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount';

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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Samurai character SVG - running pose
function SamuraiRunning({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor">
      {/* Head with topknot */}
      <circle cx="16" cy="6" r="4" />
      <path d="M16 2 L17 0 L15 0 Z" /> {/* Topknot */}
      {/* Body leaning forward */}
      <path d="M12 10 L14 18 L18 18 L20 10 Z" />
      {/* Running legs */}
      <path d="M14 18 L10 26 L12 27 L16 20" /> {/* Back leg extended */}
      <path d="M18 18 L22 24 L20 26 L16 20" /> {/* Front leg forward */}
      {/* Arms with katana */}
      <path d="M12 12 L6 14 L7 16 L12 14" /> {/* Back arm */}
      <path d="M20 12 L26 10 L28 8" strokeWidth="1" /> {/* Katana extended */}
      <circle cx="26" cy="10" r="1" /> {/* Katana guard */}
    </svg>
  );
}

// Samurai at rest/victory
function SamuraiVictory({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor">
      {/* Head */}
      <circle cx="16" cy="6" r="4" />
      <path d="M16 2 L17 0 L15 0 Z" />
      {/* Body standing tall */}
      <path d="M13 10 L14 22 L18 22 L19 10 Z" />
      {/* Legs standing */}
      <path d="M14 22 L12 30 L14 30 L15 22" />
      <path d="M18 22 L20 30 L18 30 L17 22" />
      {/* Arms raised in victory with katana */}
      <path d="M13 12 L8 8 L6 4" strokeWidth="1" /> {/* Katana raised high */}
      <circle cx="6" cy="4" r="1" />
      <path d="M19 12 L24 10 L25 12 L20 14" /> {/* Other arm */}
    </svg>
  );
}

// Samurai idle/waiting
function SamuraiIdle({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor">
      {/* Head */}
      <circle cx="16" cy="6" r="4" />
      <path d="M16 2 L17 0 L15 0 Z" />
      {/* Body */}
      <path d="M13 10 L14 22 L18 22 L19 10 Z" />
      {/* Legs */}
      <path d="M14 22 L12 30 L14 30 L15 22" />
      <path d="M18 22 L20 30 L18 30 L17 22" />
      {/* Arms at rest, katana sheathed */}
      <path d="M13 12 L10 16 L11 18 L14 14" />
      <path d="M19 12 L22 16 L21 18 L18 14" />
      {/* Sheathed katana at side */}
      <path d="M20 14 L24 26" strokeWidth="1.5" />
    </svg>
  );
}

function RacerRow({ racer, position }: { racer: RacerData; position: number }) {
  const isYou = racer.isYou;
  const progressPercent = Math.round(racer.progress * 100);

  // Determine which samurai to show
  const SamuraiIcon =
    racer.status === 'finished'
      ? SamuraiVictory
      : racer.status === 'racing'
        ? SamuraiRunning
        : SamuraiIdle;

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
        <div className="text-xs text-gray-400">
          {racer.completedCount}/{racer.fileCount} files
        </div>
      </div>

      {/* Race track */}
      <div className="relative h-10 bg-gray-900/50 rounded-lg overflow-hidden border border-gray-700/50">
        {/* Track pattern - traditional wave pattern (seigaiha inspired) */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" preserveAspectRatio="none">
            <pattern id={`wave-${racer.id}`} width="20" height="10" patternUnits="userSpaceOnUse">
              <path
                d="M0 10 Q5 0 10 10 Q15 20 20 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                className="text-[--color-primary]"
              />
            </pattern>
            <rect width="100%" height="100%" fill={`url(#wave-${racer.id})`} />
          </svg>
        </div>

        {/* Start gate */}
        <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-gray-600" />
        <div className="absolute left-1 top-1 text-[8px] text-gray-500 font-bold">START</div>

        {/* Finish gate with torii-inspired design */}
        <div className="absolute right-3 top-0 bottom-0 flex flex-col items-center justify-center">
          <div className="w-4 h-1 bg-red-600 rounded-sm" />
          <div className="flex gap-2 h-6">
            <div className="w-0.5 bg-red-600" />
            <div className="w-0.5 bg-red-600" />
          </div>
        </div>

        {/* Progress track fill */}
        <div
          className={`absolute left-0 top-0 bottom-0 transition-all duration-500 ease-out ${
            racer.status === 'finished'
              ? 'bg-gradient-to-r from-emerald-900/40 to-emerald-700/40'
              : racer.status === 'racing'
                ? 'bg-gradient-to-r from-[--color-primary]/30 to-[--color-primary]/50'
                : 'bg-gray-800/30'
          }`}
          style={{ width: `${Math.min(progressPercent, 92)}%` }}
        />

        {/* Samurai runner */}
        <div
          className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
          style={{ left: `calc(${Math.min(progressPercent, 88)}% + 4px)` }}
        >
          <SamuraiIcon
            className={`w-7 h-7 drop-shadow-lg ${
              racer.status === 'finished'
                ? 'text-emerald-400 samurai-victory'
                : racer.status === 'racing'
                  ? 'text-[--color-primary] samurai-run'
                  : 'text-gray-500'
            } ${isYou ? 'scale-110' : ''}`}
          />
        </div>

        {/* Progress percentage badge */}
        <div
          className={`absolute right-8 top-1/2 -translate-y-1/2 text-xs font-mono font-bold ${
            racer.status === 'finished'
              ? 'text-emerald-400'
              : racer.status === 'racing'
                ? 'text-[--color-primary]'
                : 'text-gray-500'
          }`}
        >
          {progressPercent}%
        </div>
      </div>

      {/* Transfer details */}
      <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-gray-500">
        <span>
          {formatBytes(racer.transferredSize)} / {formatBytes(racer.totalSize)}
        </span>
        {racer.status === 'finished' && <span className="text-emerald-500">✓ Complete</span>}
        {racer.status === 'racing' && (
          <span className="text-[--color-primary] samurai-dots">Sending</span>
        )}
        {racer.status === 'idle' && <span>Waiting</span>}
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

  // Build racer data from transfers
  const racers = useMemo(() => {
    const racerMap = new Map<string, RacerData>();

    // Group transfers by sender
    transfers.forEach((transfer) => {
      const isOutgoing = transfer.direction === 'send';
      const racerId = isOutgoing ? 'you' : transfer.peerId;
      const racerName = isOutgoing ? profile?.displayName || 'You' : transfer.peerName;

      if (!racerMap.has(racerId)) {
        racerMap.set(racerId, {
          id: racerId,
          name: racerName,
          isYou: isOutgoing,
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
              <h3 className="text-sm font-bold text-gray-100 tracking-wide">SAMURAI RACE</h3>
              <p className="text-[10px] text-[--color-primary]/60 uppercase tracking-widest">
                File Transfer Battle
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
