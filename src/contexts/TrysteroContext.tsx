import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode
} from 'react';
import { joinRoom, selfId, getRelaySockets, type Room } from 'trystero/torrent';
import { P2P_CONFIG, RTC_CONFIG } from '../services/p2p/config';
import { usePeerStore } from '../store/peerStore';
import { useSessionStore } from '../store/sessionStore';
import { transferService } from '../services/transfer/TransferService';

// Debug: Log tracker socket status
const logTrackerStatus = () => {
  const sockets = getRelaySockets();
  console.log('[TrysteroProvider] Torrent tracker sockets:', Object.entries(sockets).map(([key, socket]) => ({
    key,
    readyState: socket?.readyState,
    readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][socket?.readyState ?? -1] || 'UNKNOWN'
  })));
};

// Debug: Compute info hash for verification
const computeInfoHash = async (appId: string, roomId: string) => {
  const topicPath = `Trystero@${appId}@${roomId}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(topicPath);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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

interface TrysteroContextValue {
  room: Room | null;
  selfId: string;
  sessionId: string | null;
  isConnected: boolean;
  joinSession: (sessionId: string) => Room;
  leaveSession: () => void;
  addLocalStream: (stream: MediaStream, metadata?: { type: string }) => void;
  removeLocalStream: (stream: MediaStream, isScreen?: boolean) => void;
  setActiveScreenShare: (peerId: string | null) => void;
  broadcastFocusChange: (peerId: string | null) => void;
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

  // Store refs
  const { addPeer, updatePeer, removePeer, clearPeers } = usePeerStore();
  const { setActiveScreenSharePeerId, setFocusedPeerId } = useSessionStore();

  // State that doesn't need to trigger re-renders
  const stateRef = useRef<{
    localScreenStream: MediaStream | null;
    activeScreenSharePeerId: string | null;
    peersWithScreenShareAvailable: Set<string>;
    name: string;
    isHost: boolean;
  }>({
    localScreenStream: null,
    activeScreenSharePeerId: null,
    peersWithScreenShareAvailable: new Set(),
    name: 'Anonymous',
    isHost: false
  });

  // Action senders
  const sendersRef = useRef<{
    sendPeerInfo: ((data: PeerInfoData, peerId?: string) => void) | null;
    sendScreenShareStatus: ((data: ScreenShareStatusData, peerId?: string) => void) | null;
    sendActiveScreenShare: ((data: ActiveScreenShareData, peerId?: string) => void) | null;
    sendFocusChange: ((data: FocusChangeData, peerId?: string) => void) | null;
  }>({
    sendPeerInfo: null,
    sendScreenShareStatus: null,
    sendActiveScreenShare: null,
    sendFocusChange: null
  });

  // Setup peer handlers when room changes
  const setupPeerHandlers = useCallback((newRoom: Room) => {
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

    sendersRef.current = {
      sendPeerInfo,
      sendScreenShareStatus,
      sendActiveScreenShare,
      sendFocusChange
    };

    // Handle peer join
    newRoom.onPeerJoin((peerId) => {
      console.log('[TrysteroProvider] Peer joined:', peerId);

      addPeer({
        id: peerId,
        stream: null,
        screenStream: null,
        name: `User-${peerId.slice(0, 4)}`,
        isHost: false
      });

      // Notify transfer service about new peer
      transferService.addPeer(peerId);

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
    });

    // Handle peer leave
    newRoom.onPeerLeave((peerId) => {
      console.log('[TrysteroProvider] Peer left:', peerId);
      removePeer(peerId);
      transferService.removePeer(peerId);
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
          roomRef.current.addStream(stateRef.current.localScreenStream, undefined, { type: 'screen' });
        }
        // If we were active but no longer are, stop streaming (but keep local capture)
        else if (msg.peerId !== selfId && stateRef.current.localScreenStream && roomRef.current) {
          roomRef.current.removeStream(stateRef.current.localScreenStream);
        }
      }
    });

    // Handle focus change messages
    onFocusChange((data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const focusData = data as FocusChangeData;
        console.log('[TrysteroProvider] Focus changed to:', focusData.peerId);
        setFocusedPeerId(focusData.peerId);
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
      logTrackerStatus();
    }, 10000);
  }, [addPeer, updatePeer, removePeer, setActiveScreenSharePeerId, setFocusedPeerId]);

  const joinSession = useCallback((newSessionId: string): Room => {
    // Leave existing room if any
    if (roomRef.current) {
      console.log('[TrysteroProvider] Leaving existing room before joining new one');
      roomRef.current.leave();
      peerHandlersInitializedRef.current = false;
      clearPeers();
    }

    console.log('[TrysteroProvider] Joining room:', newSessionId, 'selfId:', selfId);
    console.log('[TrysteroProvider] Config:', { appId: P2P_CONFIG.appId, roomId: newSessionId });

    // Compute and log the expected topic hash for debugging
    computeInfoHash(P2P_CONFIG.appId, newSessionId).then(({ topicPath, hashHex }) => {
      console.log('[TrysteroProvider] Expected torrent info hash:', {
        plaintext: topicPath,
        sha1Hash: hashHex,
        selfId: selfId
      });
    });

    const newRoom = joinRoom({ appId: P2P_CONFIG.appId, relayUrls: P2P_CONFIG.relayUrls, rtcConfig: RTC_CONFIG }, newSessionId);

    // Log MQTT status after a short delay to allow connections
    setTimeout(() => {
      logTrackerStatus();
    }, 2000);

    roomRef.current = newRoom;
    setRoom(newRoom);
    setSessionId(newSessionId);

    // Setup peer handlers immediately
    setupPeerHandlers(newRoom);

    return newRoom;
  }, [clearPeers, setupPeerHandlers]);

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
      localScreenStream: null,
      activeScreenSharePeerId: null,
      peersWithScreenShareAvailable: new Set(),
      name: 'Anonymous',
      isHost: false
    };
    sendersRef.current = {
      sendPeerInfo: null,
      sendScreenShareStatus: null,
      sendActiveScreenShare: null,
      sendFocusChange: null
    };
  }, [clearPeers]);

  // Set active screen share (defined first as it's used by addLocalStream and removeLocalStream)
  const setActiveScreenShare = useCallback((peerId: string | null) => {
    if (!roomRef.current) return;

    const previousActive = stateRef.current.activeScreenSharePeerId;
    stateRef.current.activeScreenSharePeerId = peerId;

    // Broadcast to all peers
    if (sendersRef.current.sendActiveScreenShare) {
      const msg: ActiveScreenShareData = {
        type: 'active-screen-share',
        peerId
      };
      sendersRef.current.sendActiveScreenShare(msg);
    }

    // Handle local stream state
    if (stateRef.current.localScreenStream) {
      if (peerId === selfId && previousActive !== selfId) {
        roomRef.current.addStream(stateRef.current.localScreenStream, undefined, { type: 'screen' });
      } else if (peerId !== selfId && previousActive === selfId) {
        roomRef.current.removeStream(stateRef.current.localScreenStream);
      }
    }

    setActiveScreenSharePeerId(peerId);
  }, [setActiveScreenSharePeerId]);

  // Add local stream
  const addLocalStream = useCallback((stream: MediaStream, metadata?: { type: string }) => {
    if (!roomRef.current) {
      console.warn('[TrysteroProvider] Cannot add stream - no room');
      return;
    }

    // For camera streams, always add
    if (!metadata || metadata.type !== 'screen') {
      console.log('[TrysteroProvider] Adding camera stream');
      roomRef.current.addStream(stream, undefined, metadata);
      return;
    }

    // For screen share, store locally but only stream if we're active
    console.log('[TrysteroProvider] Setting local screen stream');
    stateRef.current.localScreenStream = stream;

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
      setActiveScreenShare(selfId);
    }
  }, [setActiveScreenShare]);

  // Remove local stream
  const removeLocalStream = useCallback((stream: MediaStream, isScreen: boolean = false) => {
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
        setActiveScreenShare(null);
      }
    }

    roomRef.current.removeStream(stream);
  }, [setActiveScreenShare]);

  // Broadcast focus change
  const broadcastFocusChange = useCallback((peerId: string | null) => {
    setFocusedPeerId(peerId);
    if (sendersRef.current.sendFocusChange) {
      const data: FocusChangeData = { peerId, timestamp: Date.now() };
      sendersRef.current.sendFocusChange(data);
    }
  }, [setFocusedPeerId]);

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
        broadcastFocusChange
      }}
    >
      <TrysteroProviderInner updateUserInfo={updateUserInfo}>
        {children}
      </TrysteroProviderInner>
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
