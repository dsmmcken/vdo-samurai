import { type Room } from 'trystero/mqtt';
import type { Peer } from '../../types';

interface PeerInfoData {
  type: string;
  name: string;
  isHost: boolean;
}

interface ScreenShareStatusData {
  type: string;
  isSharing: boolean;
  peerId: string;
}

interface ActiveScreenShareData {
  type: string;
  peerId: string | null;
}

type PeerUpdateCallback = (peers: Peer[]) => void;
type StreamCallback = (stream: MediaStream, peerId: string, isScreen: boolean) => void;
type ActiveScreenShareCallback = (peerId: string | null) => void;

export class PeerManager {
  private peers: Map<string, Peer> = new Map();
  private room: Room | null = null;
  private onPeersUpdate: PeerUpdateCallback | null = null;
  private onStream: StreamCallback | null = null;
  private onActiveScreenShareChange: ActiveScreenShareCallback | null = null;
  private localName: string = 'Anonymous';
  private isHost: boolean = false;
  private localPeerId: string = 'local';
  private activeScreenSharePeerId: string | null = null;
  private localScreenStream: MediaStream | null = null;
  private peersWithScreenShareAvailable: Set<string> = new Set();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendActiveScreenShare: ((data: any, peerId?: string) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendScreenShareStatus: ((data: any, peerId?: string) => void) | null = null;

  initialize(room: Room, name: string, isHost: boolean): void {
    this.room = room;
    this.localName = name;
    this.isHost = isHost;

    console.log('[PeerManager] Initializing with room, setting up peer handlers...');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendPeerInfo, onPeerInfo] = room.makeAction<any>('peer-info');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendScreenShareStatus, onScreenShareStatus] = room.makeAction<any>('ss-status');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendActiveScreenShare, onActiveScreenShare] = room.makeAction<any>('ss-active');

    this.sendScreenShareStatus = sendScreenShareStatus;
    this.sendActiveScreenShare = sendActiveScreenShare;

    console.log('[PeerManager] Registering onPeerJoin handler');
    room.onPeerJoin((peerId) => {
      console.log('[PeerManager] Peer joined:', peerId);

      this.peers.set(peerId, {
        id: peerId,
        stream: null,
        screenStream: null,
        name: `User-${peerId.slice(0, 4)}`,
        isHost: false
      });

      // Send our info to the new peer
      const info: PeerInfoData = { type: 'peer-info', name: this.localName, isHost: this.isHost };
      sendPeerInfo(info, peerId);

      // Tell new peer about current active screen share
      if (this.activeScreenSharePeerId) {
        const activeMsg: ActiveScreenShareData = {
          type: 'active-screen-share',
          peerId: this.activeScreenSharePeerId
        };
        sendActiveScreenShare(activeMsg, peerId);
      }

      // Tell new peer if we have screen share available
      if (this.localScreenStream) {
        const statusMsg: ScreenShareStatusData = {
          type: 'screen-share-status',
          isSharing: true,
          peerId: this.localPeerId
        };
        sendScreenShareStatus(statusMsg, peerId);
      }

      this.notifyPeersUpdate();
    });

    room.onPeerLeave((peerId) => {
      console.log('[PeerManager] Peer left:', peerId);
      this.peers.delete(peerId);
      this.peersWithScreenShareAvailable.delete(peerId);

      // If the leaving peer was the active screen sharer, clear it
      if (this.activeScreenSharePeerId === peerId) {
        this.activeScreenSharePeerId = null;
        this.onActiveScreenShareChange?.(null);
      }

      this.notifyPeersUpdate();
    });

    onPeerInfo((data: unknown, peerId: string) => {
      const peer = this.peers.get(peerId);
      if (peer && typeof data === 'object' && data !== null) {
        const info = data as PeerInfoData;
        peer.name = info.name;
        peer.isHost = info.isHost;
        this.notifyPeersUpdate();
      }
    });

    onScreenShareStatus((data: unknown, peerId: string) => {
      if (typeof data === 'object' && data !== null) {
        const status = data as ScreenShareStatusData;
        if (status.isSharing) {
          this.peersWithScreenShareAvailable.add(peerId);
        } else {
          this.peersWithScreenShareAvailable.delete(peerId);
          // If this peer was active and stopped sharing, clear active
          if (this.activeScreenSharePeerId === peerId) {
            this.activeScreenSharePeerId = null;
            this.onActiveScreenShareChange?.(null);
          }
        }
        this.notifyPeersUpdate();
      }
    });

    onActiveScreenShare((data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const msg = data as ActiveScreenShareData;
        this.activeScreenSharePeerId = msg.peerId;
        this.onActiveScreenShareChange?.(msg.peerId);

        // If we became the active screen sharer, start streaming
        if (msg.peerId === this.localPeerId && this.localScreenStream) {
          this.room?.addStream(this.localScreenStream, undefined, { type: 'screen' });
        }
        // If we were active but no longer are, stop streaming (but keep local capture)
        else if (msg.peerId !== this.localPeerId && this.localScreenStream) {
          this.room?.removeStream(this.localScreenStream);
        }
      }
    });

    room.onPeerStream((stream, peerId, metadata) => {
      console.log('Received stream from peer:', peerId, metadata);
      const peer = this.peers.get(peerId);
      if (peer) {
        const meta = metadata as { type?: string } | undefined;
        const isScreen = meta?.type === 'screen';
        if (isScreen) {
          peer.screenStream = stream;
        } else {
          peer.stream = stream;
        }
        this.notifyPeersUpdate();
        this.onStream?.(stream, peerId, isScreen);
      }
    });
  }

  setLocalPeerId(peerId: string): void {
    this.localPeerId = peerId;
  }

  addLocalStream(stream: MediaStream, metadata?: { type: string }): void {
    // For camera streams, always add
    if (!metadata || metadata.type !== 'screen') {
      this.room?.addStream(stream, undefined, metadata);
      return;
    }

    // For screen share, store locally but only stream if we're active
    this.localScreenStream = stream;

    // Notify peers that we have screen share available
    if (this.sendScreenShareStatus) {
      const statusMsg: ScreenShareStatusData = {
        type: 'screen-share-status',
        isSharing: true,
        peerId: this.localPeerId
      };
      this.sendScreenShareStatus(statusMsg);
    }

    // If no one is actively sharing, we become active automatically
    if (!this.activeScreenSharePeerId) {
      this.setActiveScreenShare(this.localPeerId);
    }
  }

  removeLocalStream(stream: MediaStream, isScreen: boolean = false): void {
    if (isScreen) {
      this.localScreenStream = null;

      // Notify peers we stopped screen share
      if (this.sendScreenShareStatus) {
        const statusMsg: ScreenShareStatusData = {
          type: 'screen-share-status',
          isSharing: false,
          peerId: this.localPeerId
        };
        this.sendScreenShareStatus(statusMsg);
      }

      // If we were active, clear active screen share
      if (this.activeScreenSharePeerId === this.localPeerId) {
        this.setActiveScreenShare(null);
      }
    }

    this.room?.removeStream(stream);
  }

  setActiveScreenShare(peerId: string | null): void {
    const previousActive = this.activeScreenSharePeerId;
    this.activeScreenSharePeerId = peerId;

    // Broadcast to all peers
    if (this.sendActiveScreenShare) {
      const msg: ActiveScreenShareData = {
        type: 'active-screen-share',
        peerId
      };
      this.sendActiveScreenShare(msg);
    }

    // Handle local stream state
    if (this.localScreenStream) {
      if (peerId === this.localPeerId && previousActive !== this.localPeerId) {
        // We became active, start streaming
        this.room?.addStream(this.localScreenStream, undefined, { type: 'screen' });
      } else if (peerId !== this.localPeerId && previousActive === this.localPeerId) {
        // We were active but no longer are, stop streaming
        this.room?.removeStream(this.localScreenStream);
      }
    }

    this.onActiveScreenShareChange?.(peerId);
  }

  getActiveScreenSharePeerId(): string | null {
    return this.activeScreenSharePeerId;
  }

  getPeersWithScreenShareAvailable(): string[] {
    return Array.from(this.peersWithScreenShareAvailable);
  }

  hasLocalScreenShare(): boolean {
    return this.localScreenStream !== null;
  }

  setOnPeersUpdate(callback: PeerUpdateCallback): void {
    this.onPeersUpdate = callback;
  }

  setOnStream(callback: StreamCallback): void {
    this.onStream = callback;
  }

  setOnActiveScreenShareChange(callback: ActiveScreenShareCallback): void {
    this.onActiveScreenShareChange = callback;
  }

  private notifyPeersUpdate(): void {
    this.onPeersUpdate?.(this.getPeers());
  }

  getPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  getPeer(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  clear(): void {
    this.peers.clear();
    this.peersWithScreenShareAvailable.clear();
    this.room = null;
    this.onPeersUpdate = null;
    this.onStream = null;
    this.onActiveScreenShareChange = null;
    this.activeScreenSharePeerId = null;
    this.localScreenStream = null;
    this.sendActiveScreenShare = null;
    this.sendScreenShareStatus = null;
  }
}

export const peerManager = new PeerManager();
