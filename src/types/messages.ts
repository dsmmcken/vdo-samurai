export interface FocusChangeMessage {
  type: 'focus-change';
  peerId: string | null;
  timestamp: number;
}

export interface PeerInfoMessage {
  type: 'peer-info';
  name: string;
  isHost: boolean;
}

export interface ScreenShareStatusMessage {
  type: 'screen-share-status';
  isSharing: boolean;
  peerId: string;
}

export type P2PMessage = FocusChangeMessage | PeerInfoMessage | ScreenShareStatusMessage;
