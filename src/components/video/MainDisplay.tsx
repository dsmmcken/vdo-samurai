import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { VideoElement } from './VideoElement';

export function MainDisplay() {
  const { focusedPeerId, localStream, localScreenStream } = useSessionStore();
  const { peers } = usePeerStore();

  console.log('[MainDisplay] localStream:', !!localStream, 'localScreenStream:', !!localScreenStream, 'focusedPeerId:', focusedPeerId);

  const focusedPeer = peers.find((p) => p.id === focusedPeerId);

  // Determine which stream to show
  let displayStream: MediaStream | null = null;
  let displayName = 'You';
  let isScreenShare = false;

  if (focusedPeer) {
    displayStream = focusedPeer.screenStream || focusedPeer.stream;
    displayName = focusedPeer.name;
    isScreenShare = focusedPeer.screenStream !== null;
  } else {
    displayStream = localScreenStream || localStream;
    isScreenShare = localScreenStream !== null;
  }

  console.log('[MainDisplay] displayStream:', !!displayStream, 'displayName:', displayName);

  return (
    <div
      className="relative aspect-video bg-[--color-dark-lighter] rounded-xl overflow-hidden"
      role="region"
      aria-label={`Main video display showing ${displayName}${isScreenShare ? ' screen share' : ''}`}
    >
      {displayStream ? (
        <VideoElement
          stream={displayStream}
          muted={!focusedPeer}
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-500">
          <div className="text-center px-4">
            <div className="w-16 h-16 sm:w-24 sm:h-24 mx-auto mb-4 rounded-full bg-gray-700 flex items-center justify-center text-2xl sm:text-4xl font-bold text-gray-500">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <p className="text-base sm:text-lg">{displayName}</p>
            <p className="text-xs sm:text-sm text-gray-600">No video</p>
          </div>
        </div>
      )}

      {/* Display info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm sm:text-lg font-medium truncate">{displayName}</span>
            {isScreenShare && (
              <span className="bg-green-500/90 text-white text-xs px-2 py-0.5 sm:py-1 rounded-full flex-shrink-0">
                Screen Share
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
