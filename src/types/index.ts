export interface Peer {
  id: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isHost: boolean;
  videoEnabled: boolean;  // Whether peer's video is currently on
  audioEnabled: boolean;  // Whether peer's audio is currently on
}

export interface SessionInfo {
  sessionId: string;
  isHost: boolean;
  hostName: string;
  createdAt: number;
}

export interface ConnectionRecord {
  sessionId: string;
  name: string;
  timestamp: number;
  isHost: boolean;
}

export interface MediaConstraints {
  video: MediaTrackConstraints;
  audio: MediaTrackConstraints | boolean;
}

export const THUMBNAIL_CONSTRAINTS: MediaConstraints = {
  video: {
    width: { ideal: 320 },
    height: { ideal: 180 },
    frameRate: { ideal: 15 }
  },
  audio: true
};

// Camera/head tile constraints - limited to 320px to save bandwidth
// Screen share uses higher resolution separately
export const MAIN_CONSTRAINTS: MediaConstraints = {
  video: {
    width: { ideal: 320 },
    height: { ideal: 180 },
    frameRate: { ideal: 15 }
  },
  audio: true
};

// High-quality constraints for local recording (not streamed to peers)
export const HIGH_QUALITY_CONSTRAINTS: MediaConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
  },
  audio: true
};
