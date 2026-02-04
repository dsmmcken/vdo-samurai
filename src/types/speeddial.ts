/**
 * Type definitions for Speed Dial feature
 */

export interface SpeedDialClip {
  id: string;
  name: string;
  path: string; // Original file path (not copied)
  thumbnailUrl: string | null;
  duration: number; // seconds
}

export interface SpeedDialPlaybackState {
  isPlaying: boolean;
  activeClipId: string | null;
  currentTime: number;
  volume: number;
}

// P2P message types for speed dial status
export interface SpeedDialStatusMessage {
  type: 'sd-status';
  isPlaying: boolean;
  clipId: string | null;
  clipName: string | null;
}
