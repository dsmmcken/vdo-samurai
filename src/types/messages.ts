export interface FocusChangeMessage {
  type: 'focus-change';
  peerId: string | null;
  timestamp: number;
}

export interface PeerInfoMessage {
  type: 'peer-info';
  name: string;
  isHost: boolean;
  isElectron: boolean; // Whether peer is running in Electron (can become host)
}

export interface ScreenShareStatusMessage {
  type: 'screen-share-status';
  isSharing: boolean;
  peerId: string;
}

// Clock synchronization messages (NTP-style)
export interface ClockSyncRequestMessage {
  type: 'clock-sync-request';
  clientSendTime: number;
}

export interface ClockSyncResponseMessage {
  type: 'clock-sync-response';
  clientSendTime: number;
  serverReceiveTime: number;
  serverSendTime: number;
}

// Video state message for when peer toggles video on/off
export interface VideoStateMessage {
  type: 'video-state';
  videoEnabled: boolean;
  globalTimestamp: number;
}

// Peer clip info broadcast when clips are started/stopped
export interface PeerClipMessage {
  type: 'peer-clip';
  clipId: string;
  peerId: string;
  sourceType: 'camera' | 'screen' | 'audio-only';
  globalStartTime: number;
  globalEndTime: number | null;
  action: 'started' | 'stopped';
}

// Internal session ID for tracking recording sessions across peers
export interface SessionInfoMessage {
  type: 'session-info';
  internalSessionId: string;
}

// Request for session info from existing peers (used on reconnection)
export interface SessionInfoRequestMessage {
  type: 'session-info-request';
}

// Tile order message for syncing drag-and-drop reordering
export interface TileOrderMessage {
  type: 'tile-order';
  order: string[]; // Participant IDs in order ('self' for local user from sender's perspective)
  timestamp: number; // For conflict resolution (newer wins)
}

// Transfer status broadcast for observing file transfers between other peers
export interface TransferStatusMessage {
  type: 'transfer-status';
  transferId: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  filename: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
  error?: string;
  timestamp: number;
}

export interface HostTransferMessage {
  type: 'host-transfer';
  newHostPeerId: string; // The peer ID who should become the new host
  timestamp: number; // For conflict resolution (newer wins)
}

export type P2PMessage =
  | FocusChangeMessage
  | PeerInfoMessage
  | ScreenShareStatusMessage
  | ClockSyncRequestMessage
  | ClockSyncResponseMessage
  | VideoStateMessage
  | PeerClipMessage
  | SessionInfoMessage
  | SessionInfoRequestMessage
  | TileOrderMessage
  | TransferStatusMessage
  | HostTransferMessage;
