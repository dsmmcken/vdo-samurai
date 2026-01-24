export interface Peer {
  id: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isHost: boolean;
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
