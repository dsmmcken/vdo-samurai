import { useRef, useEffect, useState, useCallback } from 'react';
import { useNLEStore, getClipAtPlayhead, getTimeInClip } from '../../store/nleStore';
import { useRecordingStore } from '../../store/recordingStore';
import { useTransferStore } from '../../store/transferStore';

interface PreviewPanelProps {
  onPlay?: () => void;
  onPause?: () => void;
}

export function PreviewPanel({ onPlay, onPause }: PreviewPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number | null>(null);
  const urlsRef = useRef<Map<string | null, string>>(new Map());

  const { clips, playheadPosition, isPlaying, setPlayheadPosition, setIsPlaying, totalDuration } =
    useNLEStore();
  const { localBlob } = useRecordingStore();
  const { receivedRecordings } = useTransferStore();

  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);
  const [isWaitingForTransfer, setIsWaitingForTransfer] = useState(false);
  const [error] = useState<string | null>(null);

  // Create and manage blob URLs - only create if not already exists
  const getVideoUrl = useCallback((peerId: string | null): string | null => {
    // Check if we already have a URL for this peer
    if (urlsRef.current.has(peerId)) {
      return urlsRef.current.get(peerId) || null;
    }

    // Get the blob for this peer
    let blob: Blob | null = null;
    if (peerId === null) {
      blob = localBlob;
    } else {
      const recording = receivedRecordings.find((r) => r.peerId === peerId);
      blob = recording?.blob || null;
    }

    if (!blob) return null;

    // Create and cache the URL
    const url = URL.createObjectURL(blob);
    urlsRef.current.set(peerId, url);
    return url;
  }, [localBlob, receivedRecordings]);

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
      setCurrentVideoUrl(null);
      setIsWaitingForTransfer(false);
      return;
    }

    const videoUrl = getVideoUrl(currentClip.peerId);

    if (!videoUrl) {
      // Video not available yet (transfer in progress)
      setCurrentVideoUrl(null);
      setIsWaitingForTransfer(true);
      return;
    }

    setIsWaitingForTransfer(false);

    // Get the time within the original video
    const timeInClip = getTimeInClip(currentClip, playheadPosition, clips);
    const seekTime = timeInClip / 1000; // Convert to seconds

    if (currentVideoUrl !== videoUrl) {
      setCurrentVideoUrl(videoUrl);
    }

    // Seek video to correct position
    if (videoRef.current && videoRef.current.src === videoUrl) {
      const video = videoRef.current;
      if (Math.abs(video.currentTime - seekTime) > 0.1) {
        video.currentTime = seekTime;
      }
    }
  }, [clips, playheadPosition, getVideoUrl, currentVideoUrl]);

  // Update preview when playhead position changes
  // This effect intentionally calls setState via updatePreview to sync video preview with playhead
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updatePreview();
  }, [updatePreview]);

  // Handle seeking when video source changes or loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentVideoUrl) return;

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
  }, [currentVideoUrl, clips, playheadPosition]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      videoRef.current?.pause();
      return;
    }

    // Try to play video if ready
    const video = videoRef.current;
    if (video && currentVideoUrl && video.readyState >= 2) {
      video.play().catch((err) => {
        // Ignore AbortError which happens when play is interrupted
        if (err.name !== 'AbortError') {
          console.error('Failed to play video:', err);
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
        onPause?.();
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
  }, [isPlaying, playheadPosition, totalDuration, setPlayheadPosition, setIsPlaying, currentVideoUrl, onPause]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      onPause?.();
    } else {
      // If at end, restart from beginning
      if (playheadPosition >= totalDuration - 100) {
        setPlayheadPosition(0);
      }
      setIsPlaying(true);
      onPlay?.();
    }
  }, [isPlaying, playheadPosition, totalDuration, setIsPlaying, setPlayheadPosition, onPlay, onPause]);

  const skipBackward = useCallback(() => {
    setPlayheadPosition(Math.max(0, playheadPosition - 5000));
  }, [playheadPosition, setPlayheadPosition]);

  const skipForward = useCallback(() => {
    setPlayheadPosition(Math.min(totalDuration, playheadPosition + 5000));
  }, [playheadPosition, totalDuration, setPlayheadPosition]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipForward();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayback, skipBackward, skipForward]);

  return (
    <div className="flex flex-col bg-black rounded-lg overflow-hidden">
      {/* Video preview */}
      <div className="relative aspect-video bg-gray-900">
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
        ) : currentVideoUrl ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            className="w-full h-full object-contain"
            muted={!isPlaying}
            playsInline
            preload="auto"
            onCanPlay={() => {
              // If we should be playing and video is ready, start playback
              if (isPlaying && videoRef.current) {
                videoRef.current.play().catch(() => {});
              }
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-gray-500 text-sm">No clip at current position</p>
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4 py-3 bg-gray-900/50">
        <button
          onClick={skipBackward}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          title="Skip backward 5s"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
            />
          </svg>
        </button>

        <button
          onClick={togglePlayback}
          className="p-3 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={skipForward}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          title="Skip forward 5s"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
