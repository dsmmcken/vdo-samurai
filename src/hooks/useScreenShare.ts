import { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { screenCaptureService } from '../services/media/ScreenCaptureService';
import { peerManager } from '../services/p2p';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setLocalScreenStream, setActiveScreenSharePeerId } = useSessionStore();
  const streamRef = useRef<MediaStream | null>(null);

  const startSharingWithSource = useCallback(
    async (sourceId?: string) => {
      try {
        setError(null);
        setShowPicker(false);
        const stream = await screenCaptureService.startScreenShare(sourceId);
        streamRef.current = stream;
        setLocalScreenStream(stream);
        setIsSharing(true);

        // Add screen stream to peer manager (will only stream if we become active)
        peerManager.addLocalStream(stream, { type: 'screen' });

        // Handle stream end (user clicks "Stop sharing" in browser)
        screenCaptureService.onEnd(() => {
          if (streamRef.current) {
            peerManager.removeLocalStream(streamRef.current, true);
          }
          setLocalScreenStream(null);
          setIsSharing(false);
          streamRef.current = null;
        });

        return stream;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to share screen';
        // User cancelled is not an error
        if (err instanceof Error && err.name === 'NotAllowedError') {
          setError(null);
        } else {
          setError(message);
        }
        throw err;
      }
    },
    [setLocalScreenStream]
  );

  const startSharing = useCallback(async () => {
    // In Electron, show the picker first
    if (screenCaptureService.needsSourcePicker()) {
      setShowPicker(true);
      return undefined;
    }
    // In browser, start directly
    return startSharingWithSource();
  }, [startSharingWithSource]);

  const cancelPicker = useCallback(() => {
    setShowPicker(false);
  }, []);

  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      peerManager.removeLocalStream(streamRef.current, true);
    }
    screenCaptureService.stopScreenShare();
    setLocalScreenStream(null);
    setIsSharing(false);
    streamRef.current = null;
  }, [setLocalScreenStream]);

  // Subscribe to active screen share changes
  useEffect(() => {
    peerManager.setOnActiveScreenShareChange((peerId) => {
      setActiveScreenSharePeerId(peerId);
    });

    return () => {
      peerManager.setOnActiveScreenShareChange(() => {});
    };
  }, [setActiveScreenSharePeerId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        screenCaptureService.stopScreenShare();
      }
    };
  }, []);

  return {
    isSharing,
    showPicker,
    startSharing,
    startSharingWithSource,
    stopSharing,
    cancelPicker,
    error
  };
}
