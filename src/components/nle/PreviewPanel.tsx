import { useRef, useEffect, useState, useCallback } from 'react';
import { useNLEStore, getClipAtPlayhead, getTimeInClip } from '../../store/nleStore';
import { useRecordingStore } from '../../store/recordingStore';
import { useTransferStore, type RecordingType } from '../../store/transferStore';

export function PreviewPanel() {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  // Cache URLs by peer and type: key format is `${peerId ?? 'local'}-${type}`
  const urlsRef = useRef<Map<string, string>>(new Map());

  const { clips, playheadPosition, isPlaying, setPlayheadPosition, setIsPlaying, totalDuration } =
    useNLEStore();
  const { localBlob, localScreenBlob } = useRecordingStore();
  const { receivedRecordings } = useTransferStore();

  const [currentMainUrl, setCurrentMainUrl] = useState<string | null>(null);
  const [currentCameraUrl, setCurrentCameraUrl] = useState<string | null>(null);
  const [showCameraOverlay, setShowCameraOverlay] = useState(false);
  const [isWaitingForTransfer, setIsWaitingForTransfer] = useState(false);
  const [error] = useState<string | null>(null);

  // Create and manage blob URLs - only create if not already exists
  // Now supports both screen and camera types
  const getVideoUrl = useCallback(
    (peerId: string | null, type: RecordingType): string | null => {
      const cacheKey = `${peerId ?? 'local'}-${type}`;

      // Check if we already have a URL for this peer/type combo
      if (urlsRef.current.has(cacheKey)) {
        return urlsRef.current.get(cacheKey) || null;
      }

      // Get the blob for this peer and type
      let blob: Blob | null = null;
      if (peerId === null) {
        // Local user
        blob = type === 'screen' ? localScreenBlob : localBlob;
      } else {
        // Remote peer - find by peerId and type
        const recording = receivedRecordings.find((r) => r.peerId === peerId && r.type === type);
        blob = recording?.blob || null;
      }

      if (!blob) return null;

      // Create and cache the URL
      const url = URL.createObjectURL(blob);
      urlsRef.current.set(cacheKey, url);
      return url;
    },
    [localBlob, localScreenBlob, receivedRecordings]
  );

  // Get both screen and camera URLs for a peer
  const getSourcesForPeer = useCallback(
    (peerId: string | null) => {
      const screenUrl = getVideoUrl(peerId, 'screen');
      const cameraUrl = getVideoUrl(peerId, 'camera');
      return { screenUrl, cameraUrl };
    },
    [getVideoUrl]
  );

  // Cleanup URLs only on unmount
  useEffect(() => {
    const urlsToCleanup = urlsRef.current;
    return () => {
      urlsToCleanup.forEach((url) => URL.revokeObjectURL(url));
      urlsToCleanup.clear();
    };
  }, []);

  // Find current clip and seek to correct position
  const updatePreview = useCallback(() => {
    const currentClip = getClipAtPlayhead(clips, playheadPosition);

    if (!currentClip) {
      setCurrentMainUrl(null);
      setCurrentCameraUrl(null);
      setShowCameraOverlay(false);
      setIsWaitingForTransfer(false);
      return;
    }

    const { screenUrl, cameraUrl } = getSourcesForPeer(currentClip.peerId);

    // If no video available at all, show waiting state
    if (!screenUrl && !cameraUrl) {
      setCurrentMainUrl(null);
      setCurrentCameraUrl(null);
      setShowCameraOverlay(false);
      setIsWaitingForTransfer(true);
      return;
    }

    setIsWaitingForTransfer(false);

    // Get the time within the original video
    const timeInClip = getTimeInClip(currentClip, playheadPosition, clips);
    const seekTime = timeInClip / 1000; // Convert to seconds

    // Determine main video and overlay:
    // - If screen share exists, use it as main and show camera as overlay
    // - Otherwise, use camera as main with no overlay
    const newMainUrl = screenUrl || cameraUrl;
    const newCameraUrl = screenUrl ? cameraUrl : null;
    const shouldShowOverlay = !!screenUrl && !!cameraUrl;

    if (currentMainUrl !== newMainUrl) {
      setCurrentMainUrl(newMainUrl);
    }

    if (currentCameraUrl !== newCameraUrl) {
      setCurrentCameraUrl(newCameraUrl);
    }

    setShowCameraOverlay(shouldShowOverlay);

    // Seek main video to correct position
    if (mainVideoRef.current && mainVideoRef.current.src === newMainUrl) {
      const video = mainVideoRef.current;
      if (Math.abs(video.currentTime - seekTime) > 0.1) {
        video.currentTime = seekTime;
      }
    }

    // Seek camera overlay video to correct position (same time offset)
    if (cameraVideoRef.current && cameraVideoRef.current.src === newCameraUrl) {
      const video = cameraVideoRef.current;
      if (Math.abs(video.currentTime - seekTime) > 0.1) {
        video.currentTime = seekTime;
      }
    }
  }, [clips, playheadPosition, getSourcesForPeer, currentMainUrl, currentCameraUrl]);

  // Update preview when playhead position changes
  // This effect intentionally calls setState via updatePreview to sync video preview with playhead
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updatePreview();
  }, [updatePreview]);

  // Handle seeking when main video source changes or loads
  useEffect(() => {
    const video = mainVideoRef.current;
    if (!video || !currentMainUrl) return;

    const handleLoadedMetadata = () => {
      const currentClip = getClipAtPlayhead(clips, playheadPosition);
      if (currentClip && video) {
        const timeInClip = getTimeInClip(currentClip, playheadPosition, clips);
        video.currentTime = timeInClip / 1000;
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    // If already loaded, seek immediately
    if (video.readyState >= 1) {
      handleLoadedMetadata();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [currentMainUrl, clips, playheadPosition]);

  // Handle seeking when camera overlay video source changes or loads
  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!video || !currentCameraUrl) return;

    const handleLoadedMetadata = () => {
      const currentClip = getClipAtPlayhead(clips, playheadPosition);
      if (currentClip && video) {
        const timeInClip = getTimeInClip(currentClip, playheadPosition, clips);
        video.currentTime = timeInClip / 1000;
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    // If already loaded, seek immediately
    if (video.readyState >= 1) {
      handleLoadedMetadata();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [currentCameraUrl, clips, playheadPosition]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      mainVideoRef.current?.pause();
      cameraVideoRef.current?.pause();
      return;
    }

    // Try to play main video if ready
    const mainVideo = mainVideoRef.current;
    if (mainVideo && currentMainUrl && mainVideo.readyState >= 2) {
      mainVideo.play().catch((err) => {
        // Ignore AbortError which happens when play is interrupted
        if (err.name !== 'AbortError') {
          console.error('Failed to play main video:', err);
        }
      });
    }

    // Try to play camera overlay video if ready
    const cameraVideo = cameraVideoRef.current;
    if (cameraVideo && currentCameraUrl && cameraVideo.readyState >= 2) {
      cameraVideo.play().catch((err) => {
        // Ignore AbortError which happens when play is interrupted
        if (err.name !== 'AbortError') {
          console.error('Failed to play camera overlay video:', err);
        }
      });
    }

    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      const newPosition = playheadPosition + deltaTime;

      if (newPosition >= totalDuration) {
        setPlayheadPosition(totalDuration);
        setIsPlaying(false);
        return;
      }

      setPlayheadPosition(newPosition);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    isPlaying,
    playheadPosition,
    totalDuration,
    setPlayheadPosition,
    setIsPlaying,
    currentMainUrl,
    currentCameraUrl
  ]);

  return (
    <div className="h-full flex flex-col bg-black rounded-lg overflow-hidden">
      {/* Video preview - uses container query grid for proper sizing */}
      <div className="flex-1 min-h-0 video-container">
        <div className="video-cell relative bg-gray-900">
          {isWaitingForTransfer ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <svg
                  className="animate-spin h-8 w-8 mx-auto mb-2 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <p className="text-gray-400 text-sm">Waiting for transfer...</p>
              </div>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <svg
                  className="w-8 h-8 mx-auto mb-2 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            </div>
          ) : currentMainUrl ? (
            <>
              {/* Main video - screen share if available, otherwise camera */}
              <video
                ref={mainVideoRef}
                src={currentMainUrl}
                className="w-full h-full object-contain"
                muted={!isPlaying}
                playsInline
                preload="auto"
                onCanPlay={() => {
                  // If we should be playing and video is ready, start playback
                  if (isPlaying && mainVideoRef.current) {
                    mainVideoRef.current.play().catch(() => {});
                  }
                }}
              />

              {/* Camera overlay - square with squircle mask, only shown when screen share is the main video */}
              {showCameraOverlay && currentCameraUrl && (
                <div
                  className="absolute bottom-4 right-4 w-24 aspect-square overflow-hidden shadow-lg z-10"
                  style={
                    {
                      'corner-shape': 'superellipse(2)',
                      borderRadius: '20%'
                    } as React.CSSProperties
                  }
                >
                  <video
                    ref={cameraVideoRef}
                    src={currentCameraUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="auto"
                    onCanPlay={() => {
                      // If we should be playing and video is ready, start playback
                      if (isPlaying && cameraVideoRef.current) {
                        cameraVideoRef.current.play().catch(() => {});
                      }
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-500 text-sm">No clip at current position</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
