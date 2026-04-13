import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode
} from 'react';
import { joinRoom, selfId, getRelaySockets, type Room } from 'trystero/nostr';

const APP_ID = 'vdo-samurai-v1';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ]
};

// Explicit list of known-reliable Nostr relays for signaling.
// Using explicit relays instead of trystero's defaults ensures all peers
// connect to the same relays, improving connection reliability.
const NOSTR_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://purplepag.es'
];

// Use higher redundancy to increase chances of successful signaling
const RELAY_REDUNDANCY = 5;

import { usePeerStore } from '../store/peerStore';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useNLEStore } from '../store/nleStore';
import { useCompositeStore } from '../store/compositeStore';
import { useTransferStore, type TransferBroadcast } from '../store/transferStore';
import { isElectron } from '../utils/platform';

// Debug: Log relay socket status
const logRelayStatus = () => {
  const sockets = getRelaySockets();
  const entries = Object.entries(sockets).map(([key, socket]: [string, unknown]) => ({
    key,
    readyState: (socket as WebSocket)?.readyState,
    readyStateText:
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][(socket as WebSocket)?.readyState ?? -1] ||
      'UNKNOWN'
  }));
  const openCount = entries.filter((e) => e.readyState === 1).length;
  console.log(
    `[TrysteroProvider] Nostr relay sockets: ${openCount}/${entries.length} OPEN`,
    entries
  );
  if (openCount === 0 && entries.length > 0) {
    console.warn(
      '[TrysteroProvider] WARNING: No relay sockets are OPEN — peer discovery will fail!'
    );
  }
  return { entries, openCount, totalCount: entries.length };
};

// Debug: Compute info hash for verification
const computeInfoHash = async (appId: string, roomId: string) => {
  const topicPath = `Trystero@${appId}@${roomId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(topicPath);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return { topicPath, hashHex };
};

interface PeerInfoData {
  type: string;
  name: string;
  isHost: boolean;
  isElectron: boolean;
}

interface HostTransferData {
  newHostPeerId: string;
  timestamp: number;
}

interface SpeedDialStatusData {
  type: string;
  isPlaying: boolean;
  peerId: string;
}

interface MeshHealthData {
  type: string;
  peers: string[]; // Connected peer IDs the sender has
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

interface FocusChangeData {
  peerId: string | null;
  timestamp: number;
}

interface VideoStateData {
  type: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
}

interface SessionInfoData {
  type: string;
  internalSessionId: string;
}

interface SessionInfoRequestData {
  type: string;
}

interface TileOrderData {
  order: string[];
  timestamp: number;
}

interface TransferStatusData {
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

interface TrysteroContextValue {
  room: Room | null;
  selfId: string;
  sessionId: string | null;
  isConnected: boolean;
  joinSession: (sessionId: string, password: string) => Room;
  leaveSession: () => void;
  addLocalStream: (stream: MediaStream, metadata?: { type: string }) => void;
  removeLocalStream: (stream: MediaStream, isScreen?: boolean) => void;
  setActiveScreenShare: (peerId: string | null) => void;
  broadcastFocusChange: (peerId: string | null) => void;
  broadcastVideoState: (videoEnabled: boolean, audioEnabled: boolean) => void;
  broadcastSessionInfo: (internalSessionId: string) => void;
  broadcastTileOrder: (order: string[]) => void;
  broadcastTransferStatus: (status: TransferBroadcast) => void;
  broadcastHostTransfer: (newHostPeerId: string) => void;
  // Speed dial functions
  addSpeedDialStream: (stream: MediaStream) => void;
  removeSpeedDialStream: (stream: MediaStream) => void;
  broadcastSpeedDialStatus: (isPlaying: boolean) => void;
}

const TrysteroContext = createContext<TrysteroContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useTrystero() {
  const ctx = useContext(TrysteroContext);
  if (!ctx) throw new Error('useTrystero must be used within TrysteroProvider');
  return ctx;
}

export function TrysteroProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const peerHandlersInitializedRef = useRef(false);
  const debugIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Expose selfId on window for E2E testing
  useEffect(() => {
    (window as unknown as { __trysteroSelfId: string }).__trysteroSelfId = selfId;
    console.log('[TrysteroProvider] selfId exposed on window:', selfId);
  }, []);

  // Store refs - use direct store access for stable references
  const { addPeer, updatePeer, removePeer, clearPeers } = usePeerStore();
  const {
    setActiveScreenSharePeerId,
    setFocusedPeerId,
    setTileOrder,
    addJoinError,
    clearJoinErrors
  } = useSessionStore();

  // Store functions in refs to prevent useCallback dependency changes
  // This is critical to prevent repeated stream additions that interfere with WebRTC negotiation
  const storeFunctionsRef = useRef({
    setActiveScreenSharePeerId,
    setFocusedPeerId,
    setTileOrder
  });
  // Keep refs updated via useEffect (not during render)
  useEffect(() => {
    storeFunctionsRef.current = { setActiveScreenSharePeerId, setFocusedPeerId, setTileOrder };
  }, [setActiveScreenSharePeerId, setFocusedPeerId, setTileOrder]);

  // State that doesn't need to trigger re-renders
  const stateRef = useRef<{
    localCameraStream: MediaStream | null; // Camera stream for re-adding to new peers
    localScreenStream: MediaStream | null;
    localSpeedDialStream: MediaStream | null; // Speed dial stream for re-adding to new peers
    activeScreenSharePeerId: string | null;
    peersWithScreenShareAvailable: Set<string>;
    peersWithSpeedDialActive: Set<string>; // Peers currently playing speed dial
    name: string;
    isHost: boolean;
    hostTimestamp: number;
    isElectron: boolean;
    focusedPeerId: string | null;
    focusTimestamp: number;
    tileOrder: string[];
    tileOrderTimestamp: number;
    // Mesh health / auto-rejoin state
    password: string | null;
    currentSessionId: string | null;
    meshGapDetectedAt: Map<string, number>; // peerId -> first-detection timestamp
    meshHealthInterval: ReturnType<typeof setInterval> | null;
    lastRejoinTime: number;
    rejoinCount: number;
    isRejoining: boolean;
  }>({
    localCameraStream: null,
    localScreenStream: null,
    localSpeedDialStream: null,
    activeScreenSharePeerId: null,
    peersWithScreenShareAvailable: new Set(),
    peersWithSpeedDialActive: new Set(),
    name: 'Anonymous',
    isHost: false,
    hostTimestamp: 0,
    isElectron: isElectron(),
    focusedPeerId: null,
    focusTimestamp: 0,
    tileOrder: [],
    tileOrderTimestamp: 0,
    password: null,
    currentSessionId: null,
    meshGapDetectedAt: new Map(),
    meshHealthInterval: null,
    lastRejoinTime: 0,
    rejoinCount: 0,
    isRejoining: false
  });

  // Action senders
  const sendersRef = useRef<{
    sendPeerInfo: ((data: PeerInfoData, peerId?: string) => void) | null;
    sendScreenShareStatus: ((data: ScreenShareStatusData, peerId?: string) => void) | null;
    sendActiveScreenShare: ((data: ActiveScreenShareData, peerId?: string) => void) | null;
    sendFocusChange: ((data: FocusChangeData, peerId?: string) => void) | null;
    sendVideoState: ((data: VideoStateData, peerId?: string) => void) | null;
    sendSessionInfo: ((data: SessionInfoData, peerId?: string) => void) | null;
    sendSessionInfoRequest: ((data: SessionInfoRequestData, peerId?: string) => void) | null;
    sendTileOrder: ((data: TileOrderData, peerId?: string) => void) | null;
    sendTransferStatus: ((data: TransferStatusData, peerId?: string) => void) | null;
    sendHostTransfer: ((data: HostTransferData, peerId?: string) => void) | null;
    sendSpeedDialStatus: ((data: SpeedDialStatusData, peerId?: string) => void) | null;
    sendMeshHealth: ((data: MeshHealthData, peerId?: string) => void) | null;
  }>({
    sendPeerInfo: null,
    sendScreenShareStatus: null,
    sendActiveScreenShare: null,
    sendFocusChange: null,
    sendVideoState: null,
    sendSessionInfo: null,
    sendSessionInfoRequest: null,
    sendTileOrder: null,
    sendTransferStatus: null,
    sendHostTransfer: null,
    sendSpeedDialStatus: null,
    sendMeshHealth: null
  });

  // Ref for mesh recovery function — set after joinSession is defined
  const attemptMeshRecoveryRef = useRef<() => void>(() => {});

  // Setup peer handlers when room changes
  const setupPeerHandlers = useCallback(
    (newRoom: Room) => {
      if (peerHandlersInitializedRef.current) {
        console.log('[TrysteroProvider] Peer handlers already initialized, skipping');
        return;
      }
      peerHandlersInitializedRef.current = true;
      console.log('[TrysteroProvider] Setting up peer handlers, selfId:', selfId);

      // Create actions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendPeerInfo, onPeerInfo] = newRoom.makeAction<any>('peer-info');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendScreenShareStatus, onScreenShareStatus] = newRoom.makeAction<any>('ss-status');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendActiveScreenShare, onActiveScreenShare] = newRoom.makeAction<any>('ss-active');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendFocusChange, onFocusChange] = newRoom.makeAction<any>('focus-change');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendVideoState, onVideoState] = newRoom.makeAction<any>('video-state');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendSessionInfo, onSessionInfo] = newRoom.makeAction<any>('session-info');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendSessionInfoRequest, onSessionInfoRequest] = newRoom.makeAction<any>('sess-req');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendTileOrder, onTileOrder] = newRoom.makeAction<any>('tile-order');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendTransferStatus, onTransferStatus] = newRoom.makeAction<any>('xfer-status');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendHostTransfer, onHostTransfer] = newRoom.makeAction<any>('host-xfer');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendSpeedDialStatus, onSpeedDialStatus] = newRoom.makeAction<any>('sd-status');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [sendMeshHealth, onMeshHealth] = newRoom.makeAction<any>('mesh-hlth');

      // Helper: broadcast our connected peer list to all peers
      const broadcastMeshHealth = () => {
        if (!roomRef.current) return;
        const peerIds = Object.keys(roomRef.current.getPeers());
        if (peerIds.length === 0) return;
        const data: MeshHealthData = { type: 'mesh-hlth', peers: peerIds };
        sendMeshHealth(data);
      };

      sendersRef.current = {
        sendPeerInfo,
        sendScreenShareStatus,
        sendActiveScreenShare,
        sendFocusChange,
        sendVideoState,
        sendSessionInfo,
        sendSessionInfoRequest,
        sendTileOrder,
        sendTransferStatus,
        sendHostTransfer,
        sendSpeedDialStatus,
        sendMeshHealth
      };

      // Handle peer join
      newRoom.onPeerJoin((peerId) => {
        console.log('[TrysteroProvider] Peer joined:', peerId);

        // A peer successfully connected — clear any password mismatch errors
        clearJoinErrors();

        addPeer({
          id: peerId,
          stream: null,
          screenStream: null,
          speedDialStream: null,
          name: `User-${peerId.slice(0, 4)}`,
          isHost: false,
          isElectron: false, // Will be updated when we receive peer-info
          videoEnabled: true, // Assume video is on until we hear otherwise
          audioEnabled: true, // Assume audio is on until we hear otherwise
          isScreenSharing: false,
          isPlayingSpeedDial: false
        });

        // Send our info to the new peer
        const info: PeerInfoData = {
          type: 'peer-info',
          name: stateRef.current.name,
          isHost: stateRef.current.isHost,
          isElectron: stateRef.current.isElectron
        };
        sendPeerInfo(info, peerId);

        // Tell new peer about current active screen share
        if (stateRef.current.activeScreenSharePeerId) {
          const activeMsg: ActiveScreenShareData = {
            type: 'active-screen-share',
            peerId: stateRef.current.activeScreenSharePeerId
          };
          sendActiveScreenShare(activeMsg, peerId);
        }

        // Tell new peer if we have screen share available
        if (stateRef.current.localScreenStream) {
          const statusMsg: ScreenShareStatusData = {
            type: 'screen-share-status',
            isSharing: true,
            peerId: selfId
          };
          sendScreenShareStatus(statusMsg, peerId);
        }

        // Re-add camera stream for the new peer
        // Trystero may not automatically renegotiate for streams added before peers connect
        if (stateRef.current.localCameraStream && newRoom) {
          console.log('[TrysteroProvider] Re-adding camera stream for new peer:', peerId);
          newRoom.addStream(stateRef.current.localCameraStream, peerId, { type: 'camera' });
        }

        // Re-add screen stream for the new peer
        if (stateRef.current.localScreenStream && newRoom) {
          console.log('[TrysteroProvider] Re-adding screen stream for new peer:', peerId);
          newRoom.addStream(stateRef.current.localScreenStream, peerId, { type: 'screen' });
        }

        // Re-add speed dial stream for the new peer
        if (stateRef.current.localSpeedDialStream && newRoom) {
          console.log('[TrysteroProvider] Re-adding speed dial stream for new peer:', peerId);
          // Send speed dial status FIRST so peer knows to expect speeddial stream
          const sdStatusMsg: SpeedDialStatusData = {
            type: 'sd-status',
            isPlaying: true,
            peerId: selfId
          };
          sendSpeedDialStatus(sdStatusMsg, peerId);
          // Then add the stream
          newRoom.addStream(stateRef.current.localSpeedDialStream, peerId, { type: 'speeddial' });
        }

        // Send our internal session ID to the new peer (if we have one)
        const currentInternalSessionId = useRecordingStore.getState().internalSessionId;
        if (currentInternalSessionId) {
          const sessionInfoMsg: SessionInfoData = {
            type: 'session-info',
            internalSessionId: currentInternalSessionId
          };
          sendSessionInfo(sessionInfoMsg, peerId);
        }

        // Send current focus state to the new peer (so they sync to existing focus)
        // Only the host sends initial focus state to avoid race conditions where both
        // peers try to set focus simultaneously. The host is the authority since they
        // were in the room first.
        // Use Date.now() to ensure the timestamp is always newer than the receiver's initial
        // timestamp (which is 1), guaranteeing the sync is applied.
        if (stateRef.current.isHost && stateRef.current.focusTimestamp > 0) {
          const focusPeerId = stateRef.current.focusedPeerId ?? selfId;
          const syncTimestamp = Date.now();
          const focusMsg: FocusChangeData = {
            peerId: focusPeerId,
            timestamp: syncTimestamp
          };
          // Update our local timestamp to match what we're sending
          stateRef.current.focusTimestamp = syncTimestamp;
          console.log('[TrysteroProvider] Sending focus state to new peer:', peerId, focusMsg);
          sendFocusChange(focusMsg, peerId);
        } else if (!stateRef.current.isHost) {
          console.log('[TrysteroProvider] Not host, skipping focus sync to new peer:', peerId);
        } else {
          console.log('[TrysteroProvider] No focus state to send to new peer:', peerId);
        }

        // Send current tile order to the new peer (so they sync to existing order)
        // Only the host sends initial tile order to avoid race conditions where both
        // peers try to set order simultaneously. The host is the authority since they
        // were in the room first.
        // Use Date.now() to ensure the timestamp is always newer than the receiver's initial
        // timestamp (which is 1), guaranteeing the sync is applied.
        if (
          stateRef.current.isHost &&
          stateRef.current.tileOrderTimestamp > 0 &&
          stateRef.current.tileOrder.length > 0
        ) {
          // Translate 'self' to actual selfId for the message
          const broadcastOrder = stateRef.current.tileOrder.map((id) =>
            id === 'self' ? selfId : id
          );
          const tileOrderSyncTimestamp = Date.now();
          const tileOrderMsg: TileOrderData = {
            order: broadcastOrder,
            timestamp: tileOrderSyncTimestamp
          };
          // Update our local timestamp to match what we're sending
          stateRef.current.tileOrderTimestamp = tileOrderSyncTimestamp;
          console.log('[TrysteroProvider] Sending tile order to new peer:', peerId, tileOrderMsg);
          sendTileOrder(tileOrderMsg, peerId);
        }

        // Send active transfers to the new peer (so they can observe ongoing transfers)
        // Only send transfers where we're the sender (to avoid duplicate broadcasts)
        const activeTransfers = useTransferStore
          .getState()
          .transfers.filter(
            (t) => t.role === 'sender' && (t.status === 'pending' || t.status === 'active')
          );
        activeTransfers.forEach((transfer) => {
          const statusMsg: TransferStatusData = {
            transferId: transfer.id,
            senderId: transfer.senderId,
            senderName: transfer.senderName,
            receiverId: transfer.receiverId,
            receiverName: transfer.receiverName,
            filename: transfer.filename,
            size: transfer.size,
            progress: transfer.progress,
            status: transfer.status,
            error: transfer.error,
            timestamp: Date.now()
          };
          console.log('[TrysteroProvider] Sending active transfer to new peer:', peerId, statusMsg);
          sendTransferStatus(statusMsg, peerId);
        });

        // Broadcast mesh health after a delay to let Trystero's natural signaling complete
        // 8s covers warmup (~2.1s) + one full announce cycle (~5.3s)
        setTimeout(() => {
          broadcastMeshHealth();
        }, 8000);
      });

      // Handle peer leave
      newRoom.onPeerLeave((peerId) => {
        console.log('[TrysteroProvider] Peer left:', peerId);
        removePeer(peerId);
        stateRef.current.peersWithScreenShareAvailable.delete(peerId);
        stateRef.current.peersWithSpeedDialActive.delete(peerId);
        stateRef.current.meshGapDetectedAt.delete(peerId);

        // If the leaving peer was the active screen sharer, clear it
        if (stateRef.current.activeScreenSharePeerId === peerId) {
          stateRef.current.activeScreenSharePeerId = null;
          setActiveScreenSharePeerId(null);
        }

        // If the leaving peer was focused, reset focus to local user (null)
        // This prevents stale focusedPeerId from causing no tile to show the focus
        // indicator, and avoids syncing a nonexistent peer ID to newly joining peers.
        if (stateRef.current.focusedPeerId === peerId) {
          const timestamp = Date.now();
          stateRef.current.focusedPeerId = null;
          stateRef.current.focusTimestamp = timestamp;
          storeFunctionsRef.current.setFocusedPeerId(null, timestamp);
        }
      });

      // Handle peer info messages
      onPeerInfo((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const info = data as PeerInfoData;
          console.log('[TrysteroProvider] Received peer info from', peerId, ':', info);
          updatePeer(peerId, {
            name: info.name,
            isHost: info.isHost,
            isElectron: info.isElectron ?? false
          });
        }
      });

      // Handle screen share status messages
      onScreenShareStatus((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const status = data as ScreenShareStatusData;
          console.log('[TrysteroProvider] Screen share status from', peerId, ':', status);
          // Update peer's screen sharing flag for UI badge
          updatePeer(peerId, { isScreenSharing: status.isSharing });
          if (status.isSharing) {
            stateRef.current.peersWithScreenShareAvailable.add(peerId);
          } else {
            stateRef.current.peersWithScreenShareAvailable.delete(peerId);
            // Clear the peer's screenStream so MainDisplay falls back to camera
            updatePeer(peerId, { screenStream: null });
            console.log('[TrysteroProvider] Cleared screenStream for peer:', peerId);
            if (stateRef.current.activeScreenSharePeerId === peerId) {
              stateRef.current.activeScreenSharePeerId = null;
              setActiveScreenSharePeerId(null);
            }
          }
        }
      });

      // Handle active screen share messages
      onActiveScreenShare((data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const msg = data as ActiveScreenShareData;
          console.log('[TrysteroProvider] Active screen share changed:', msg.peerId);
          stateRef.current.activeScreenSharePeerId = msg.peerId;
          setActiveScreenSharePeerId(msg.peerId);

          // If we became the active screen sharer, start streaming
          if (msg.peerId === selfId && stateRef.current.localScreenStream && roomRef.current) {
            roomRef.current.addStream(stateRef.current.localScreenStream, undefined, {
              type: 'screen'
            });
          }
          // If we were active but no longer are, stop streaming (but keep local capture)
          else if (msg.peerId !== selfId && stateRef.current.localScreenStream && roomRef.current) {
            roomRef.current.removeStream(stateRef.current.localScreenStream);
          }
        }
      });

      // Handle focus change messages with timestamp-based conflict resolution
      onFocusChange((data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const focusData = data as FocusChangeData;
          const incomingTimestamp = focusData.timestamp || 0;

          // Only apply if this focus change is newer than our current one
          // This handles race conditions when multiple users join/change focus simultaneously
          if (incomingTimestamp > stateRef.current.focusTimestamp) {
            console.log(
              '[TrysteroProvider] Focus changed to:',
              focusData.peerId,
              'timestamp:',
              incomingTimestamp
            );
            // If the focus is on our selfId, convert to null (which means "local user" in our store)
            const localFocusedPeerId = focusData.peerId === selfId ? null : focusData.peerId;
            stateRef.current.focusedPeerId = focusData.peerId;
            stateRef.current.focusTimestamp = incomingTimestamp;
            setFocusedPeerId(localFocusedPeerId, incomingTimestamp);
          } else {
            console.log(
              '[TrysteroProvider] Ignoring stale focus change:',
              focusData.peerId,
              'incoming:',
              incomingTimestamp,
              'current:',
              stateRef.current.focusTimestamp
            );
          }
        }
      });

      // Handle video state messages (video/audio on/off)
      onVideoState((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const videoState = data as VideoStateData;
          console.log('[TrysteroProvider] Video state from', peerId, ':', videoState);
          updatePeer(peerId, {
            videoEnabled: videoState.videoEnabled,
            audioEnabled: videoState.audioEnabled
          });
        }
      });

      // Handle session info messages - used to sync internal session ID across peers
      onSessionInfo((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const sessionInfo = data as SessionInfoData;
          console.log('[TrysteroProvider] Received session info from', peerId, ':', sessionInfo);

          const currentInternalSessionId = useRecordingStore.getState().internalSessionId;

          if (currentInternalSessionId !== sessionInfo.internalSessionId) {
            // Check if export is in progress or in NLE editing mode - don't reset stores
            const compositeStatus = useCompositeStore.getState().status;
            const nleMode = useNLEStore.getState().mode;
            const isExporting = compositeStatus === 'loading' || compositeStatus === 'processing';
            const isEditing = nleMode === 'editing';

            if (isExporting || isEditing) {
              console.log(
                '[TrysteroProvider] Ignoring session ID change during editing/export:',
                'compositeStatus=',
                compositeStatus,
                'nleMode=',
                nleMode
              );
              return;
            }

            // Different session - reset all stores and adopt the new session ID
            console.log(
              '[TrysteroProvider] Adopting new internal session ID:',
              sessionInfo.internalSessionId
            );
            useRecordingStore.getState().reset();
            useNLEStore.getState().reset();
            useCompositeStore.getState().reset();
            useTransferStore.getState().reset();
            useRecordingStore.getState().setInternalSessionId(sessionInfo.internalSessionId);
          }
        }
      });

      // Handle session info request - respond with our current session ID
      onSessionInfoRequest((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          console.log('[TrysteroProvider] Received session info request from', peerId);
          const currentInternalSessionId = useRecordingStore.getState().internalSessionId;
          if (currentInternalSessionId) {
            const sessionInfoMsg: SessionInfoData = {
              type: 'session-info',
              internalSessionId: currentInternalSessionId
            };
            sendSessionInfo(sessionInfoMsg, peerId);
          }
        }
      });

      // Handle tile order messages with timestamp-based conflict resolution
      onTileOrder((data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const tileOrderData = data as TileOrderData;
          const incomingTimestamp = tileOrderData.timestamp || 0;

          // Only apply if this tile order change is newer than our current one
          if (incomingTimestamp > stateRef.current.tileOrderTimestamp) {
            // Translate peer IDs: replace our own selfId with 'self' for local representation
            const localOrder = tileOrderData.order.map((id) => (id === selfId ? 'self' : id));

            console.log(
              '[TrysteroProvider] Tile order changed:',
              tileOrderData.order,
              '-> local:',
              localOrder,
              'timestamp:',
              incomingTimestamp
            );
            stateRef.current.tileOrder = localOrder;
            stateRef.current.tileOrderTimestamp = incomingTimestamp;
            storeFunctionsRef.current.setTileOrder(localOrder, incomingTimestamp);
          } else {
            console.log(
              '[TrysteroProvider] Ignoring stale tile order:',
              tileOrderData.order,
              'incoming:',
              incomingTimestamp,
              'current:',
              stateRef.current.tileOrderTimestamp
            );
          }
        }
      });

      // Handle transfer status broadcasts - allows all peers to see all transfers
      onTransferStatus((data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const statusData = data as TransferStatusData;
          console.log('[TrysteroProvider] Received transfer status:', statusData);
          useTransferStore.getState().upsertTransferFromBroadcast(
            {
              transferId: statusData.transferId,
              senderId: statusData.senderId,
              senderName: statusData.senderName,
              receiverId: statusData.receiverId,
              receiverName: statusData.receiverName,
              filename: statusData.filename,
              size: statusData.size,
              progress: statusData.progress,
              status: statusData.status,
              error: statusData.error
            },
            selfId
          );
        }
      });

      // Handle speed dial status messages
      onSpeedDialStatus((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const status = data as SpeedDialStatusData;
          console.log('[TrysteroProvider] Speed dial status from', peerId, ':', status);
          updatePeer(peerId, { isPlayingSpeedDial: status.isPlaying });
          if (status.isPlaying) {
            stateRef.current.peersWithSpeedDialActive.add(peerId);
          } else {
            stateRef.current.peersWithSpeedDialActive.delete(peerId);
            // Clear the peer's speedDialStream so MainDisplay falls back
            updatePeer(peerId, { speedDialStream: null });
            console.log('[TrysteroProvider] Cleared speedDialStream for peer:', peerId);
          }
        }
      });

      // Handle host transfer messages with timestamp-based conflict resolution
      onHostTransfer((data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          const hostTransferData = data as HostTransferData;
          const incomingTimestamp = hostTransferData.timestamp || 0;

          // Only apply if this host transfer is newer than our current one
          if (incomingTimestamp > stateRef.current.hostTimestamp) {
            const newHostPeerId = hostTransferData.newHostPeerId;
            const amINewHost = newHostPeerId === selfId;

            console.log(
              '[TrysteroProvider] Host transfer to:',
              newHostPeerId,
              'I am new host:',
              amINewHost,
              'timestamp:',
              incomingTimestamp
            );

            // Update local state
            stateRef.current.isHost = amINewHost;
            stateRef.current.hostTimestamp = incomingTimestamp;
            useSessionStore.getState().setHostWithTimestamp(amINewHost, incomingTimestamp);

            // Update all peers' isHost status
            const peers = usePeerStore.getState().peers;
            peers.forEach((peer) => {
              updatePeer(peer.id, { isHost: peer.id === newHostPeerId });
            });
          } else {
            console.log(
              '[TrysteroProvider] Ignoring stale host transfer:',
              hostTransferData.newHostPeerId,
              'incoming:',
              incomingTimestamp,
              'current:',
              stateRef.current.hostTimestamp
            );
          }
        }
      });

      // Handle mesh health gossip — detect missing peer connections
      onMeshHealth((data: unknown, senderPeerId: string) => {
        if (typeof data !== 'object' || data === null) return;
        const healthData = data as MeshHealthData;

        // Skip if we're currently rejoining
        if (stateRef.current.isRejoining) return;

        // Get our actual connected peers from Trystero (ground truth)
        const ourPeerIds = roomRef.current ? Object.keys(roomRef.current.getPeers()) : [];
        const ourPeerSet = new Set(ourPeerIds);

        // Find peers the sender has that we don't
        const missingPeers: string[] = [];
        for (const peerId of healthData.peers) {
          if (peerId === selfId) continue;
          if (peerId === senderPeerId) continue;
          if (ourPeerSet.has(peerId)) continue;
          missingPeers.push(peerId);
        }

        if (missingPeers.length === 0) {
          // Mesh is healthy — clear gap tracking
          stateRef.current.meshGapDetectedAt.clear();
          return;
        }

        console.log(
          '[TrysteroProvider] Mesh gap detected! Missing peers:',
          missingPeers,
          'Our peers:',
          ourPeerIds,
          'Sender peers:',
          healthData.peers
        );

        const now = Date.now();

        // Track first-detection time for each missing peer
        for (const peerId of missingPeers) {
          if (!stateRef.current.meshGapDetectedAt.has(peerId)) {
            stateRef.current.meshGapDetectedAt.set(peerId, now);
          }
        }

        // Clean up gaps that have resolved
        for (const [peerId] of stateRef.current.meshGapDetectedAt) {
          if (ourPeerSet.has(peerId)) {
            stateRef.current.meshGapDetectedAt.delete(peerId);
          }
        }

        // Check if any gap has persisted beyond the 20s grace period
        const GRACE_PERIOD_MS = 20000;
        const hasPersistentGap = [...stateRef.current.meshGapDetectedAt.values()].some(
          (detectedAt) => now - detectedAt > GRACE_PERIOD_MS
        );

        if (hasPersistentGap) {
          console.log('[TrysteroProvider] Persistent mesh gap — attempting recovery');
          attemptMeshRecoveryRef.current();
        }
      });

      // Start periodic mesh health broadcasting (every 15s)
      if (stateRef.current.meshHealthInterval) {
        clearInterval(stateRef.current.meshHealthInterval);
      }
      stateRef.current.meshHealthInterval = setInterval(() => {
        broadcastMeshHealth();
      }, 15000);

      // Handle incoming streams
      newRoom.onPeerStream((stream, peerId, metadata) => {
        const meta = metadata as { type?: string } | undefined;
        const metaType = meta?.type;
        const metaStr = metadata === undefined ? 'undefined' : JSON.stringify(metadata);

        // Get stream info for debugging
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const streamInfo = {
          id: stream.id,
          active: stream.active,
          videoTracks: videoTracks.length,
          audioTracks: audioTracks.length,
          videoTrackEnabled: videoTracks[0]?.enabled,
          videoTrackMuted: videoTracks[0]?.muted,
          videoTrackReadyState: videoTracks[0]?.readyState
        };

        console.log('[TrysteroProvider] Received stream from peer:', peerId, 'metadata:', metaStr);
        console.log('[TrysteroProvider] Stream info:', JSON.stringify(streamInfo));

        // Ignore dead/inactive streams with no video tracks
        // These are sent by Trystero when a stream is removed
        if (!stream.active || videoTracks.length === 0) {
          console.log(
            '[TrysteroProvider] Ignoring dead/inactive stream (no video tracks or inactive)'
          );
          return;
        }

        // Check metadata first - if explicit type is provided, trust it
        const hasExplicitType = metaType !== undefined;
        const isSpeedDialFromMetadata = metaType === 'speeddial';
        const isScreenFromMetadata = metaType === 'screen';
        const isCameraFromMetadata = metaType === 'camera';

        // Fallback: if NO metadata type is provided, use status messages as a signal.
        // Trystero sometimes doesn't preserve metadata for dynamically added streams.
        const peerHasSpeedDialActive = stateRef.current.peersWithSpeedDialActive.has(peerId);
        const peerHasScreenShareAnnounced =
          stateRef.current.peersWithScreenShareAvailable.has(peerId);
        const currentPeer = usePeerStore.getState().peers.find((p) => p.id === peerId);
        const peerAlreadyHasCameraStream = currentPeer?.stream !== null;

        // Determine stream type - priority:
        // 1. Explicit 'speeddial' metadata -> speedDialStream
        // 2. Explicit 'screen' metadata -> screenStream
        // 3. Explicit 'camera' metadata -> stream (camera)
        // 4. NO metadata + peer has sd-status active -> speedDialStream (fallback)
        // 5. NO metadata + peer has screen share announced -> screenStream (fallback)
        // 6. Otherwise -> stream (camera)
        let streamType: 'camera' | 'screen' | 'speeddial' = 'camera';

        if (hasExplicitType) {
          // Trust explicit metadata
          if (isSpeedDialFromMetadata) {
            streamType = 'speeddial';
          } else if (isScreenFromMetadata) {
            streamType = 'screen';
          } else if (isCameraFromMetadata) {
            streamType = 'camera';
          }
        } else {
          // No metadata - use fallback logic based on status messages
          if (peerHasSpeedDialActive && peerAlreadyHasCameraStream) {
            streamType = 'speeddial';
          } else if (peerHasScreenShareAnnounced && peerAlreadyHasCameraStream) {
            streamType = 'screen';
          }
        }

        console.log(
          '[TrysteroProvider] Stream classification:',
          JSON.stringify({
            hasExplicitType,
            metaType,
            isSpeedDialFromMetadata,
            isScreenFromMetadata,
            isCameraFromMetadata,
            peerHasSpeedDialActive,
            peerHasScreenShareAnnounced,
            peerAlreadyHasCameraStream,
            streamType
          })
        );

        // Store stream in appropriate property
        switch (streamType) {
          case 'speeddial':
            updatePeer(peerId, { speedDialStream: stream });
            break;
          case 'screen':
            updatePeer(peerId, { screenStream: stream });
            break;
          default:
            updatePeer(peerId, { stream });
            break;
        }
      });

      // Check for existing peers
      const existingPeers = newRoom.getPeers();
      console.log('[TrysteroProvider] Existing peers in room:', existingPeers);

      // Periodic debug logging disabled - uncomment if needed for debugging connection issues
      // if (debugIntervalRef.current) {
      //   clearInterval(debugIntervalRef.current);
      // }
      // debugIntervalRef.current = setInterval(() => {
      //   const peers = newRoom.getPeers();
      //   console.log('[TrysteroProvider] DEBUG - Peers check:', {
      //     peerCount: Object.keys(peers).length,
      //     peers: Object.keys(peers),
      //     selfId
      //   });
      //   logRelayStatus();
      // }, 10000);
    },
    [addPeer, updatePeer, removePeer, setActiveScreenSharePeerId, setFocusedPeerId, clearJoinErrors]
  );

  const joinSession = useCallback(
    (newSessionId: string, password: string): Room => {
      // Leave existing room if any
      if (roomRef.current) {
        console.log('[TrysteroProvider] Leaving existing room before joining new one');
        roomRef.current.leave();
        peerHandlersInitializedRef.current = false;
        clearPeers();
      }

      // Store credentials for potential mesh recovery rejoin
      stateRef.current.password = password;
      stateRef.current.currentSessionId = newSessionId;
      stateRef.current.meshGapDetectedAt.clear();

      console.log('[TrysteroProvider] Joining room:', newSessionId, 'selfId:', selfId);
      console.log('[TrysteroProvider] Config:', { appId: APP_ID, roomId: newSessionId });

      // Compute and log the expected topic hash for debugging
      computeInfoHash(APP_ID, newSessionId).then(({ topicPath, hashHex }) => {
        console.log('[TrysteroProvider] Expected Nostr topic hash:', {
          plaintext: topicPath,
          sha1Hash: hashHex,
          selfId: selfId
        });
      });

      const joinErrorPeers = new Set<string>();
      const newRoom = joinRoom(
        {
          appId: APP_ID,
          rtcConfig: RTC_CONFIG,
          password,
          relayUrls: NOSTR_RELAY_URLS,
          relayRedundancy: RELAY_REDUNDANCY
        },
        newSessionId,
        {
          onJoinError: ({ error, peerId }) => {
            console.error(
              '[TrysteroProvider] Join error (wrong password?):',
              error,
              'peerId:',
              peerId
            );
            // Only add one error per peer to avoid spam (multiple relays trigger this)
            if (!joinErrorPeers.has(peerId)) {
              joinErrorPeers.add(peerId);
              addJoinError(
                'Could not connect to peer — the room code or password may be incorrect.'
              );
            }
          }
        }
      );

      // Initialize focus and tile order state with timestamps so we can sync to new peers.
      // Use timestamp = 1 as a "default but valid" value - it passes the > 0 check for sync,
      // but any real user action (which uses Date.now()) will have a higher timestamp and override it.
      const initialTimestamp = 1;

      // Only initialize if not already set (prevents overwriting on reconnect)
      // Use refs to avoid dependency changes in useCallback
      if (stateRef.current.focusTimestamp === 0) {
        stateRef.current.focusedPeerId = null;
        stateRef.current.focusTimestamp = initialTimestamp;
        storeFunctionsRef.current.setFocusedPeerId(null, initialTimestamp);
      }

      if (stateRef.current.tileOrderTimestamp === 0) {
        stateRef.current.tileOrder = ['self'];
        stateRef.current.tileOrderTimestamp = initialTimestamp;
        storeFunctionsRef.current.setTileOrder(['self'], initialTimestamp);
      }

      // Log relay status after a short delay to allow connections,
      // then monitor periodically for relay health
      setTimeout(() => {
        logRelayStatus();
      }, 2000);

      // Periodic relay health monitoring - log every 30s to help diagnose connectivity
      if (debugIntervalRef.current) {
        clearInterval(debugIntervalRef.current);
      }
      debugIntervalRef.current = setInterval(() => {
        const { openCount, totalCount } = logRelayStatus();
        if (openCount === 0 && totalCount > 0) {
          console.error(
            '[TrysteroProvider] All relay sockets are down! Peers will not be able to discover each other.'
          );
        }
      }, 30000);

      roomRef.current = newRoom;
      setRoom(newRoom);
      setSessionId(newSessionId);

      // Setup peer handlers immediately
      setupPeerHandlers(newRoom);

      return newRoom;
    },
    [clearPeers, setupPeerHandlers, addJoinError]
  );

  // Mesh recovery: leave and rejoin when persistent gaps are detected
  const attemptMeshRecovery = useCallback(() => {
    const now = Date.now();
    const MAX_REJOIN_ATTEMPTS = 3;
    const REJOIN_COOLDOWN_MS = 30000;

    if (stateRef.current.rejoinCount >= MAX_REJOIN_ATTEMPTS) {
      console.log('[TrysteroProvider] Max mesh recovery attempts reached, skipping');
      return;
    }

    if (now - stateRef.current.lastRejoinTime < REJOIN_COOLDOWN_MS) {
      console.log('[TrysteroProvider] Mesh recovery cooldown active, skipping');
      return;
    }

    if (stateRef.current.isRejoining) {
      console.log('[TrysteroProvider] Already rejoining, skipping');
      return;
    }

    const currentSessionId = stateRef.current.currentSessionId;
    const currentPassword = stateRef.current.password;
    if (!currentSessionId || !currentPassword) {
      console.log('[TrysteroProvider] Missing session info for rejoin');
      return;
    }

    // Deterministic jitter from selfId to stagger simultaneous rejoins across peers
    const jitterMs = parseInt(selfId.slice(0, 4), 36) % 5000;
    console.log(`[TrysteroProvider] Scheduling mesh recovery rejoin in ${jitterMs}ms`);

    stateRef.current.isRejoining = true;

    setTimeout(() => {
      // Re-check: gap may have resolved during jitter delay
      if (!roomRef.current) {
        stateRef.current.isRejoining = false;
        return;
      }
      const currentPeers = new Set(Object.keys(roomRef.current.getPeers()));
      const stillHasGap = [...stateRef.current.meshGapDetectedAt.keys()].some(
        (peerId) => !currentPeers.has(peerId)
      );

      if (!stillHasGap) {
        console.log('[TrysteroProvider] Mesh gap resolved before rejoin, cancelling');
        stateRef.current.isRejoining = false;
        stateRef.current.meshGapDetectedAt.clear();
        return;
      }

      console.log('[TrysteroProvider] Executing mesh recovery rejoin');
      stateRef.current.lastRejoinTime = Date.now();
      stateRef.current.rejoinCount++;
      stateRef.current.meshGapDetectedAt.clear();

      joinSession(currentSessionId, currentPassword);

      // Keep isRejoining true during stabilization to suppress gap detection
      setTimeout(() => {
        stateRef.current.isRejoining = false;
      }, 10000);
    }, jitterMs);
  }, [joinSession]);

  // Keep the recovery ref in sync so setupPeerHandlers can call it
  useEffect(() => {
    attemptMeshRecoveryRef.current = attemptMeshRecovery;
  }, [attemptMeshRecovery]);

  const leaveSession = useCallback(() => {
    console.log('[TrysteroProvider] Leaving session');
    roomRef.current?.leave();
    roomRef.current = null;
    peerHandlersInitializedRef.current = false;
    // Clear debug interval
    if (debugIntervalRef.current) {
      clearInterval(debugIntervalRef.current);
      debugIntervalRef.current = null;
    }
    // Clear mesh health interval
    if (stateRef.current.meshHealthInterval) {
      clearInterval(stateRef.current.meshHealthInterval);
    }
    setRoom(null);
    setSessionId(null);
    clearPeers();
    stateRef.current = {
      localCameraStream: null,
      localScreenStream: null,
      localSpeedDialStream: null,
      activeScreenSharePeerId: null,
      peersWithScreenShareAvailable: new Set(),
      peersWithSpeedDialActive: new Set(),
      name: 'Anonymous',
      isHost: false,
      hostTimestamp: 0,
      isElectron: isElectron(),
      focusedPeerId: null,
      focusTimestamp: 0,
      tileOrder: [],
      tileOrderTimestamp: 0,
      password: null,
      currentSessionId: null,
      meshGapDetectedAt: new Map(),
      meshHealthInterval: null,
      // Persist rejoin limits across leave/join to prevent infinite loops
      lastRejoinTime: stateRef.current.lastRejoinTime,
      rejoinCount: stateRef.current.rejoinCount,
      isRejoining: false
    };
    sendersRef.current = {
      sendPeerInfo: null,
      sendScreenShareStatus: null,
      sendActiveScreenShare: null,
      sendFocusChange: null,
      sendVideoState: null,
      sendSessionInfo: null,
      sendSessionInfoRequest: null,
      sendTileOrder: null,
      sendTransferStatus: null,
      sendHostTransfer: null,
      sendSpeedDialStatus: null,
      sendMeshHealth: null
    };
  }, [clearPeers]);

  // Set active screen share (defined first as it's used by addLocalStream and removeLocalStream)
  // Note: This only controls which screen share is displayed in MainDisplay, not which streams are transmitted.
  // All screen streams are always transmitted so peers can see them when focused.
  const setActiveScreenShare = useCallback(
    (peerId: string | null) => {
      if (!roomRef.current) return;

      stateRef.current.activeScreenSharePeerId = peerId;

      // Broadcast to all peers
      if (sendersRef.current.sendActiveScreenShare) {
        const msg: ActiveScreenShareData = {
          type: 'active-screen-share',
          peerId
        };
        sendersRef.current.sendActiveScreenShare(msg);
      }

      storeFunctionsRef.current.setActiveScreenSharePeerId(peerId);
    },
    [] // No dependencies - uses refs for stable identity
  );

  // Add local stream
  // Use ref for setActiveScreenShare to ensure stable function identity
  const setActiveScreenShareRef = useRef(setActiveScreenShare);
  useEffect(() => {
    setActiveScreenShareRef.current = setActiveScreenShare;
  }, [setActiveScreenShare]);

  const addLocalStream = useCallback(
    (stream: MediaStream, metadata?: { type: string }) => {
      if (!roomRef.current) {
        console.warn('[TrysteroProvider] Cannot add stream - no room');
        return;
      }

      // For camera streams, store reference and add to room
      if (!metadata || metadata.type !== 'screen') {
        console.log('[TrysteroProvider] Adding camera stream');
        stateRef.current.localCameraStream = stream;
        roomRef.current.addStream(stream, undefined, metadata);
        return;
      }

      // For screen share, store locally and always stream to peers
      // (peers need the stream to display when focused, regardless of who is "active")
      console.log('[TrysteroProvider] Adding screen share stream');
      stateRef.current.localScreenStream = stream;

      // Always send the screen stream to peers so they can display it when focusing on us
      roomRef.current.addStream(stream, undefined, { type: 'screen' });

      // Notify peers that we have screen share available
      if (sendersRef.current.sendScreenShareStatus) {
        const statusMsg: ScreenShareStatusData = {
          type: 'screen-share-status',
          isSharing: true,
          peerId: selfId
        };
        sendersRef.current.sendScreenShareStatus(statusMsg);
      }

      // If no one is actively sharing, we become active automatically
      if (!stateRef.current.activeScreenSharePeerId) {
        setActiveScreenShareRef.current(selfId);
      }
    },
    [] // No dependencies - uses refs for stable identity
  );

  // Remove local stream
  const removeLocalStream = useCallback(
    (stream: MediaStream, isScreen: boolean = false) => {
      if (!roomRef.current) {
        console.warn('[TrysteroProvider] Cannot remove stream - no room');
        return;
      }

      if (isScreen) {
        stateRef.current.localScreenStream = null;

        // Notify peers we stopped screen share
        if (sendersRef.current.sendScreenShareStatus) {
          const statusMsg: ScreenShareStatusData = {
            type: 'screen-share-status',
            isSharing: false,
            peerId: selfId
          };
          sendersRef.current.sendScreenShareStatus(statusMsg);
        }

        // If we were active, clear active screen share
        if (stateRef.current.activeScreenSharePeerId === selfId) {
          setActiveScreenShareRef.current(null);
        }
      } else {
        // Clear camera stream ref so it won't be re-added to newly joining peers
        stateRef.current.localCameraStream = null;
      }

      roomRef.current.removeStream(stream);
    },
    [] // No dependencies - uses refs for stable identity
  );

  // Broadcast focus change
  const broadcastFocusChange = useCallback(
    (peerId: string | null) => {
      const timestamp = Date.now();
      // When broadcasting, convert null (self) to actual selfId so other peers know who to focus on
      const broadcastPeerId = peerId === null ? selfId : peerId;

      // Update local state ref for syncing to new peers
      stateRef.current.focusedPeerId = broadcastPeerId;
      stateRef.current.focusTimestamp = timestamp;

      storeFunctionsRef.current.setFocusedPeerId(peerId, timestamp);
      if (sendersRef.current.sendFocusChange) {
        const data: FocusChangeData = { peerId: broadcastPeerId, timestamp };
        sendersRef.current.sendFocusChange(data);
      }
    },
    [] // No dependencies - uses refs for stable identity
  );

  // Broadcast video/audio state changes
  const broadcastVideoState = useCallback((videoEnabled: boolean, audioEnabled: boolean) => {
    if (sendersRef.current.sendVideoState) {
      const data: VideoStateData = {
        type: 'video-state',
        videoEnabled,
        audioEnabled
      };
      sendersRef.current.sendVideoState(data);
      console.log('[TrysteroProvider] Broadcasting video state:', data);
    }
  }, []);

  // Broadcast internal session ID to all peers
  const broadcastSessionInfo = useCallback((internalSessionId: string) => {
    if (sendersRef.current.sendSessionInfo) {
      const data: SessionInfoData = {
        type: 'session-info',
        internalSessionId
      };
      sendersRef.current.sendSessionInfo(data);
      console.log('[TrysteroProvider] Broadcasting session info:', data);
    }
  }, []);

  // Broadcast tile order to all peers
  const broadcastTileOrder = useCallback((order: string[]) => {
    const timestamp = Date.now();

    // Update local state ref for syncing to new peers
    stateRef.current.tileOrder = order;
    stateRef.current.tileOrderTimestamp = timestamp;

    storeFunctionsRef.current.setTileOrder(order, timestamp);
    if (sendersRef.current.sendTileOrder) {
      // Translate 'self' to actual selfId for broadcast so other peers understand who we are
      const broadcastOrder = order.map((id) => (id === 'self' ? selfId : id));
      const data: TileOrderData = { order: broadcastOrder, timestamp };
      sendersRef.current.sendTileOrder(data);
      console.log(
        '[TrysteroProvider] Broadcasting tile order:',
        order,
        '-> broadcast:',
        broadcastOrder
      );
    }
  }, []);

  // Broadcast transfer status to all peers
  const broadcastTransferStatus = useCallback((status: TransferBroadcast) => {
    if (sendersRef.current.sendTransferStatus) {
      const data: TransferStatusData = {
        ...status,
        timestamp: Date.now()
      };
      sendersRef.current.sendTransferStatus(data);
    }
  }, []);

  // Broadcast host transfer to all peers
  const broadcastHostTransfer = useCallback((newHostPeerId: string) => {
    const timestamp = Date.now();

    // Determine if we are the new host
    // newHostPeerId can be 'self' (meaning local user) or a peer ID
    const actualNewHostPeerId = newHostPeerId === 'self' ? selfId : newHostPeerId;
    const amINewHost = actualNewHostPeerId === selfId;

    console.log(
      '[TrysteroProvider] Broadcasting host transfer to:',
      actualNewHostPeerId,
      'I am new host:',
      amINewHost
    );

    // Update local state
    stateRef.current.isHost = amINewHost;
    stateRef.current.hostTimestamp = timestamp;
    useSessionStore.getState().setHostWithTimestamp(amINewHost, timestamp);

    // Update all peers' isHost status
    const peers = usePeerStore.getState().peers;
    peers.forEach((peer) => {
      usePeerStore.getState().updatePeer(peer.id, { isHost: peer.id === actualNewHostPeerId });
    });

    // Broadcast to all peers
    if (sendersRef.current.sendHostTransfer) {
      const data: HostTransferData = { newHostPeerId: actualNewHostPeerId, timestamp };
      sendersRef.current.sendHostTransfer(data);
    }
  }, []);

  // Broadcast speed dial status
  const broadcastSpeedDialStatus = useCallback((isPlaying: boolean) => {
    if (sendersRef.current.sendSpeedDialStatus) {
      const data: SpeedDialStatusData = {
        type: 'sd-status',
        isPlaying,
        peerId: selfId
      };
      sendersRef.current.sendSpeedDialStatus(data);
      console.log('[TrysteroProvider] Broadcasting speed dial status:', isPlaying);
    }
  }, []);

  // Add speed dial stream to P2P
  const addSpeedDialStream = useCallback((stream: MediaStream) => {
    if (!roomRef.current) {
      console.warn('[TrysteroProvider] Cannot add speed dial stream - no room');
      return;
    }
    console.log('[TrysteroProvider] Adding speed dial stream to P2P');
    stateRef.current.localSpeedDialStream = stream;
    roomRef.current.addStream(stream, undefined, { type: 'speeddial' });
  }, []);

  // Remove speed dial stream from P2P
  const removeSpeedDialStream = useCallback((stream: MediaStream) => {
    if (!roomRef.current) {
      console.warn('[TrysteroProvider] Cannot remove speed dial stream - no room');
      return;
    }
    console.log('[TrysteroProvider] Removing speed dial stream from P2P');
    stateRef.current.localSpeedDialStream = null;
    roomRef.current.removeStream(stream);
  }, []);

  // Update name/isHost when they change (for sending to new peers)
  const updateUserInfo = useCallback((name: string, isHost: boolean) => {
    stateRef.current.name = name;
    stateRef.current.isHost = isHost;
  }, []);

  // No cleanup on unmount - room persists until explicit leaveSession
  // This prevents React StrictMode from breaking the connection

  return (
    <TrysteroContext.Provider
      value={{
        room,
        selfId,
        sessionId,
        isConnected: !!room,
        joinSession,
        leaveSession,
        addLocalStream,
        removeLocalStream,
        setActiveScreenShare,
        broadcastFocusChange,
        broadcastVideoState,
        broadcastSessionInfo,
        broadcastTileOrder,
        broadcastTransferStatus,
        broadcastHostTransfer,
        addSpeedDialStream,
        removeSpeedDialStream,
        broadcastSpeedDialStatus
      }}
    >
      <TrysteroProviderInner updateUserInfo={updateUserInfo}>{children}</TrysteroProviderInner>
    </TrysteroContext.Provider>
  );
}

// Inner component to subscribe to session store changes
function TrysteroProviderInner({
  children,
  updateUserInfo
}: {
  children: ReactNode;
  updateUserInfo: (name: string, isHost: boolean) => void;
}) {
  const { userName, isHost } = useSessionStore();

  useEffect(() => {
    updateUserInfo(userName || 'Anonymous', isHost);
  }, [userName, isHost, updateUserInfo]);

  return <>{children}</>;
}
