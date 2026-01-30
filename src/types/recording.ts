/**
 * Types for clip-based recording with global clock synchronization
 */

export interface RecordingClip {
  id: string;
  recordingId: string; // Storage ID for the blob
  peerId: string;
  sourceType: 'camera' | 'screen' | 'audio-only'; // audio-only for gaps when video is toggled off
  globalStartTime: number; // ms relative to session clock start
  globalEndTime: number | null; // null while recording
  blob?: Blob;
  status: 'recording' | 'stopped' | 'finalized';
}

export interface ClockSyncData {
  globalClockStart: number; // Host's Date.now() when recording started
  clockOffset: number; // This peer's offset from host (calculated on join)
  syncedAt: number; // When sync was performed
}

export interface ClockSyncRequest {
  type: 'clock-sync-request';
  clientSendTime: number;
}

export interface ClockSyncResponse {
  type: 'clock-sync-response';
  clientSendTime: number;
  serverReceiveTime: number;
  serverSendTime: number;
}

export interface VideoStateMessage {
  type: 'video-state';
  videoEnabled: boolean;
  globalTimestamp: number;
}

export interface PeerClipInfo {
  clipId: string;
  peerId: string;
  sourceType: 'camera' | 'screen' | 'audio-only';
  globalStartTime: number;
  globalEndTime: number | null;
}
