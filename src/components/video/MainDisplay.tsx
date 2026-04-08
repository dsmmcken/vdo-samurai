import { type ReactNode } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { VideoElement } from './VideoElement';

interface MainDisplayProps {
  children?: ReactNode;
}

export function MainDisplay({ children }: MainDisplayProps) {
  const { focusedPeerId, localStream, localScreenStream, localSpeedDialStream } = useSessionStore();
  const { peers } = usePeerStore();

  const focusedPeer = peers.find((p) => p.id === focusedPeerId);

  // Determine which stream to show
  // Display priority: speedDialStream > screenStream > stream
  let displayStream: MediaStream | null = null;
  let displayName = 'You';
  let isSpeedDial = false;
  let isScreenShare = false;

  if (focusedPeer) {
    // Priority: speedDialStream > screenStream > stream
    displayStream = focusedPeer.speedDialStream || focusedPeer.screenStream || focusedPeer.stream;
    displayName = focusedPeer.name;
    isSpeedDial = focusedPeer.speedDialStream !== null;
    isScreenShare = !isSpeedDial && focusedPeer.screenStream !== null;
  } else {
    // Local display priority: speedDialStream > screenStream > stream
    displayStream = localSpeedDialStream || localScreenStream || localStream;
    isSpeedDial = localSpeedDialStream !== null;
    isScreenShare = !isSpeedDial && localScreenStream !== null;
  }

  return (
    <div
      className="video-cell relative bg-black"
      role="region"
      aria-label={`Main video display showing ${displayName}${isSpeedDial ? ' speed dial' : isScreenShare ? ' screen share' : ''}`}
    >
      {displayStream ? (
        <>
          <VideoElement stream={displayStream} muted={!focusedPeer} className="w-full h-full" />
          {/* Controls anchored to video */}
          <div
            style={
              {
                position: 'absolute',
                positionAnchor: '--video-anchor',
                bottom: 'anchor(bottom)',
                left: 'anchor(center)',
                transform: 'translate(-50%, -0.5rem)'
              } as React.CSSProperties
            }
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
