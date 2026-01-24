import { type ReactNode } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { VideoElement } from './VideoElement';

interface MainDisplayProps {
  children?: ReactNode;
}

export function MainDisplay({ children }: MainDisplayProps) {
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
      className="video-cell relative bg-black"
      role="region"
      aria-label={`Main video display showing ${displayName}${isScreenShare ? ' screen share' : ''}`}
    >
      {displayStream ? (
        <>
          <VideoElement
            stream={displayStream}
            muted={!focusedPeer}
            className="w-full h-full"
          />
          {/* Controls anchored to video */}
          <div
            style={{
              position: 'absolute',
              positionAnchor: '--video-anchor',
              bottom: 'anchor(bottom)',
              left: 'anchor(center)',
              transform: 'translate(-50%, -0.5rem)',
            } as React.CSSProperties}
          >
            {children}
          </div>
        </>
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
    </div>
  );
}
