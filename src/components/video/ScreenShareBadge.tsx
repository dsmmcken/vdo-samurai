interface ScreenShareBadgeProps {
  isSharing: boolean;
}

export function ScreenShareBadge({ isSharing }: ScreenShareBadgeProps) {
  if (!isSharing) return null;

  return (
    <div className="absolute top-2 left-2 flex items-center gap-1 bg-green-500/90 text-white text-xs px-2 py-1 rounded-full">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
      </svg>
      <span>Screen</span>
    </div>
  );
}
