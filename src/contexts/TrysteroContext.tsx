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

import { usePeerStore } from '../store/peerStore';
import { useSessionStore } from '../store/sessionStore';
import { useRecordingStore } from '../store/recordingStore';
import { useNLEStore } from '../store/nleStore';
import { useCompositeStore } from '../store/compositeStore';
import { useTransferStore } from '../store/transferStore';

// Debug: Log relay socket status
const logRelayStatus = () => {
  const sockets = getRelaySockets();
  console.log(
    '[TrysteroProvider] Nostr relay sockets:',
    Object.entries(sockets).map(([key, socket]) => ({
      key,
      readyState: socket?.readyState,
      readyStateText:
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket?.readyState ?? -1] || 'UNKNOWN'
    }))
  );
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
  const { setActiveScreenSharePeerId, setFocusedPeerId, setTileOrder } = useSessionStore();

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
    activeScreenSharePeerId: string | null;
    peersWithScreenShareAvailable: Set<string>;
    name: string;
    isHost: boolean;
    focusedPeerId: string | null;
    focusTimestamp: number;
    tileOrder: string[];
    tileOrderTimestamp: number;
  }>({
    localCameraStream: null,
    localScreenStream: null,
    activeScreenSharePeerId: null,
    peersWithScreenShareAvailable: new Set(),
    name: 'Anonymous',
    isHost: false,
    focusedPeerId: null,
    focusTimestamp: 0,
    tileOrder: [],
    tileOrderTimestamp: 0
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
  }>({
    sendPeerInfo: null,
    sendScreenShareStatus: null,
    sendActiveScreenShare: null,
    sendFocusChange: null,
    sendVideoState: null,
    sendSessionInfo: null,
    sendSessionInfoRequest: null,
    sendTileOrder: null
  });

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

      sendersRef.current = {
        sendPeerInfo,
        sendScreenShareStatus,
        sendActiveScreenShare,
        sendFocusChange,
        sendVideoState,
        sendSessionInfo,
        sendSessionInfoRequest,
        sendTileOrder
      };

      // Handle peer join
      newRoom.onPeerJoin((peerId) => {
        console.log('[TrysteroProvider] Peer joined:', peerId);

        addPeer({
          id: peerId,
          stream: null,
          screenStream: null,
          name: `User-${peerId.slice(0, 4)}`,
          isHost: false,
          videoEnabled: true, // Assume video is on until we hear otherwise
          audioEnabled: true, // Assume audio is on until we hear otherwise
          isScreenSharing: false
        });

        // Send our info to the new peer
        const info: PeerInfoData = {
          type: 'peer-info',
          name: stateRef.current.name,
          isHost: stateRef.current.isHost
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
      });

      // Handle peer leave
      newRoom.onPeerLeave((peerId) => {
        console.log('[TrysteroProvider] Peer left:', peerId);
        removePeer(peerId);
        stateRef.current.peersWithScreenShareAvailable.delete(peerId);

        // If the leaving peer was the active screen sharer, clear it
        if (stateRef.current.activeScreenSharePeerId === peerId) {
          stateRef.current.activeScreenSharePeerId = null;
          setActiveScreenSharePeerId(null);
        }
      });

      // Handle peer info messages
      onPeerInfo((data: unknown, peerId: string) => {
        if (typeof data === 'object' && data !== null) {
          const info = data as PeerInfoData;
          console.log('[TrysteroProvider] Received peer info from', peerId, ':', info);
          updatePeer(peerId, { name: info.name, isHost: info.isHost });
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

      // Handle incoming streams
      newRoom.onPeerStream((stream, peerId, metadata) => {
        console.log('[TrysteroProvider] Received stream from peer:', peerId, metadata);
        const meta = metadata as { type?: string } | undefined;
        const isScreen = meta?.type === 'screen';

        if (isScreen) {
          updatePeer(peerId, { screenStream: stream });
        } else {
          updatePeer(peerId, { stream });
        }
      });

      // Check for existing peers
      const existingPeers = newRoom.getPeers();
      console.log('[TrysteroProvider] Existing peers in room:', existingPeers);

      // Periodic debug logging (temporary - will be removed)
      if (debugIntervalRef.current) {
        clearInterval(debugIntervalRef.current);
      }
      debugIntervalRef.current = setInterval(() => {
        const peers = newRoom.getPeers();
        console.log('[TrysteroProvider] DEBUG - Peers check:', {
          peerCount: Object.keys(peers).length,
          peers: Object.keys(peers),
          selfId
        });
        logRelayStatus();
      }, 10000);
    },
    [addPeer, updatePeer, removePeer, setActiveScreenSharePeerId, setFocusedPeerId]
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

      const newRoom = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG, password }, newSessionId);

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

      // Log MQTT status after a short delay to allow connections
      setTimeout(() => {
        logRelayStatus();
      }, 2000);

      roomRef.current = newRoom;
      setRoom(newRoom);
      setSessionId(newSessionId);

      // Setup peer handlers immediately
      setupPeerHandlers(newRoom);

      return newRoom;
    },
    [clearPeers, setupPeerHandlers]
  );

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
    setRoom(null);
    setSessionId(null);
    clearPeers();
    stateRef.current = {
      localCameraStream: null,
      localScreenStream: null,
      activeScreenSharePeerId: null,
      peersWithScreenShareAvailable: new Set(),
      name: 'Anonymous',
      isHost: false,
      focusedPeerId: null,
      focusTimestamp: 0,
      tileOrder: [],
      tileOrderTimestamp: 0
    };
    sendersRef.current = {
      sendPeerInfo: null,
      sendScreenShareStatus: null,
      sendActiveScreenShare: null,
      sendFocusChange: null,
      sendVideoState: null,
      sendSessionInfo: null,
      sendSessionInfoRequest: null,
      sendTileOrder: null
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
        broadcastTileOrder
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
