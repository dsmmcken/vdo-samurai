import { useEffect } from 'react';
import { useSpeedDial } from '../../hooks/useSpeedDial';
import { SpeedDialClipItem } from './SpeedDialClipItem';
import { VolumeControl } from './VolumeControl';

interface SpeedDialPanelProps {
  /** Called when speed dial playback starts during recording */
  onPlaybackStartedDuringRecording?: (clipId: string) => void;
  /** Called when speed dial playback ends during recording */
  onPlaybackEndedDuringRecording?: (clipId: string) => void;
}

export function SpeedDialPanel({
  onPlaybackStartedDuringRecording,
  onPlaybackEndedDuringRecording
}: SpeedDialPanelProps) {
  const {
    clips,
    volume,
    isPlaying,
    activeClipId,
    isPanelOpen,
    playClip,
    playClipByIndex,
    stopPlayback,
    importClip,
    removeClip,
    setVolume,
    setPanelOpen
  } = useSpeedDial({
    onPlaybackStartedDuringRecording,
    onPlaybackEndedDuringRecording
  });

  // Keyboard shortcuts
  useEffect(() => {
    if (!isPanelOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to stop playback or close panel
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isPlaying) {
          stopPlayback();
        } else {
          setPanelOpen(false);
        }
        return;
      }

      // Number keys 1-9 to play clips
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const index = parseInt(e.key) - 1;
        if (index < clips.length) {
          e.preventDefault();
          playClipByIndex(index);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, isPlaying, clips.length, playClipByIndex, stopPlayback, setPanelOpen]);

  if (!isPanelOpen) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-72 bg-gray-900/95 backdrop-blur-sm border-l border-white/10 flex flex-col z-20"
      role="dialog"
      aria-label="Speed Dial"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <h2 className="text-sm font-medium text-white">Speed Dial</h2>
        <button
          onClick={() => setPanelOpen(false)}
          className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
          aria-label="Close panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Clip List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {clips.length === 0 ? (
          <div className="text-center py-8">
            <svg
              className="w-12 h-12 mx-auto text-gray-600 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
            <p className="text-gray-400 text-sm">No clips yet</p>
            <p className="text-gray-500 text-xs mt-1">
              Import video clips to play during your session
            </p>
          </div>
        ) : (
          clips.map((clip, index) => (
            <SpeedDialClipItem
              key={clip.id}
              clip={clip}
              index={index}
              isActive={activeClipId === clip.id}
              isPlaying={isPlaying}
              onPlay={() => playClip(clip)}
              onStop={stopPlayback}
              onRemove={() => removeClip(clip.id)}
            />
          ))
        )}
      </div>

      {/* Footer controls */}
      <div className="p-3 border-t border-white/10 space-y-3">
        {/* Volume control */}
        <VolumeControl volume={volume} onChange={setVolume} />

        {/* Import button */}
        <button
          onClick={importClip}
          className="w-full py-2 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Import Clip
        </button>

        {/* Keyboard hint */}
        <p className="text-xs text-gray-500 text-center">Press 1-9 to play clips, Esc to stop</p>
      </div>
    </div>
  );
}
