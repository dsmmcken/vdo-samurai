import { useEffect, useCallback, useRef } from 'react';
import { useTrystero } from '../contexts/TrysteroContext';
import { usePeerStore } from '../store/peerStore';
import { useSessionStore } from '../store/sessionStore';

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

interface PeerManagerState {
  localScreenStream: MediaStream | null;
  activeScreenSharePeerId: string | null;
  peersWithScreenShareAvailable: Set<string>;
}

export function usePeerManager() {
  const { room, selfId } = useTrystero();
  const { addPeer, updatePeer, removePeer, clearPeers } = usePeerStore();
  const { userName, isHost, setActiveScreenSharePeerId, setFocusedPeerId } = useSessionStore();
  const name = userName || 'Anonymous';

  // Track state that doesn't need to trigger re-renders
  const stateRef = useRef<PeerManagerState>({
    localScreenStream: null,
    activeScreenSharePeerId: null,
    peersWithScreenShareAvailable: new Set()
  });

  // Action senders - populated once room is available
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

  const initializedRef = useRef(false);

  // Set active screen share - declared first so other callbacks can reference it
  const setActiveScreenShare = useCallback(
    (peerId: string | null) => {
      if (!room) return;

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
          // We became active, start streaming
          room.addStream(stateRef.current.localScreenStream, undefined, { type: 'screen' });
        } else if (peerId !== selfId && previousActive === selfId) {
          // We were active but no longer are, stop streaming
          room.removeStream(stateRef.current.localScreenStream);
        }
      }

      setActiveScreenSharePeerId(peerId);
    },
    [room, selfId, setActiveScreenSharePeerId]
  );

  // Add local stream (camera or screen)
  const addLocalStream = useCallback(
    (stream: MediaStream, metadata?: { type: string }) => {
      if (!room) {
        console.warn('[usePeerManager] Cannot add stream - no room');
        return;
      }

      // For camera streams, always add
      if (!metadata || metadata.type !== 'screen') {
        console.log('[usePeerManager] Adding camera stream');
        room.addStream(stream, undefined, metadata);
        return;
      }

      // For screen share, store locally but only stream if we're active
      console.log('[usePeerManager] Setting local screen stream');
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
    },
    [room, selfId, setActiveScreenShare]
  );

  // Remove local stream
  const removeLocalStream = useCallback(
    (stream: MediaStream, isScreen: boolean = false) => {
      if (!room) {
        console.warn('[usePeerManager] Cannot remove stream - no room');
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

      room.removeStream(stream);
    },
    [room, selfId, setActiveScreenShare]
  );

  // Broadcast focus change
  const broadcastFocusChange = useCallback(
    (peerId: string | null) => {
      setFocusedPeerId(peerId);
      if (sendersRef.current.sendFocusChange) {
        const data: FocusChangeData = { peerId, timestamp: Date.now() };
        sendersRef.current.sendFocusChange(data);
      }
    },
    [setFocusedPeerId]
  );

  // Initialize peer handlers when room is available
  useEffect(() => {
    if (!room || initializedRef.current) return;

    initializedRef.current = true;
    console.log('[usePeerManager] Initializing with room, selfId:', selfId);

    // Create actions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendPeerInfo, onPeerInfo] = room.makeAction<any>('peer-info');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendScreenShareStatus, onScreenShareStatus] = room.makeAction<any>('ss-status');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendActiveScreenShare, onActiveScreenShare] = room.makeAction<any>('ss-active');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendFocusChange, onFocusChange] = room.makeAction<any>('focus-change');

    sendersRef.current = {
      sendPeerInfo,
      sendScreenShareStatus,
      sendActiveScreenShare,
      sendFocusChange
    };

    // Check for existing peers already in the room
    const existingPeers = room.getPeers();
    console.log('[usePeerManager] Existing peers in room:', existingPeers);

    // Handle peer join
    room.onPeerJoin((peerId) => {
      console.log('[usePeerManager] Peer joined:', peerId);

      addPeer({
        id: peerId,
        stream: null,
        screenStream: null,
        name: `User-${peerId.slice(0, 4)}`,
        isHost: false
      });

      // Send our info to the new peer
      const info: PeerInfoData = { type: 'peer-info', name, isHost };
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
    room.onPeerLeave((peerId) => {
      console.log('[usePeerManager] Peer left:', peerId);
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
        console.log('[usePeerManager] Received peer info from', peerId, ':', info);
        updatePeer(peerId, { name: info.name, isHost: info.isHost });
      }
    });

    // Handle screen share status messages
    onScreenShareStatus((data: unknown, peerId: string) => {
      if (typeof data === 'object' && data !== null) {
        const status = data as ScreenShareStatusData;
        console.log('[usePeerManager] Screen share status from', peerId, ':', status);
        if (status.isSharing) {
          stateRef.current.peersWithScreenShareAvailable.add(peerId);
        } else {
          stateRef.current.peersWithScreenShareAvailable.delete(peerId);
          // If this peer was active and stopped sharing, clear active
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
        console.log('[usePeerManager] Active screen share changed:', msg.peerId);
        stateRef.current.activeScreenSharePeerId = msg.peerId;
        setActiveScreenSharePeerId(msg.peerId);

        // If we became the active screen sharer, start streaming
        if (msg.peerId === selfId && stateRef.current.localScreenStream) {
          room.addStream(stateRef.current.localScreenStream, undefined, { type: 'screen' });
        }
        // If we were active but no longer are, stop streaming (but keep local capture)
        else if (msg.peerId !== selfId && stateRef.current.localScreenStream) {
          room.removeStream(stateRef.current.localScreenStream);
        }
      }
    });

    // Handle focus change messages
    onFocusChange((data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const focusData = data as FocusChangeData;
        console.log('[usePeerManager] Focus changed to:', focusData.peerId);
        setFocusedPeerId(focusData.peerId);
      }
    });

    // Handle incoming streams
    room.onPeerStream((stream, peerId, metadata) => {
      console.log('[usePeerManager] Received stream from peer:', peerId, metadata);
      const meta = metadata as { type?: string } | undefined;
      const isScreen = meta?.type === 'screen';

      if (isScreen) {
        updatePeer(peerId, { screenStream: stream });
      } else {
        updatePeer(peerId, { stream });
      }
    });

    // Cleanup
    return () => {
      console.log('[usePeerManager] Cleanup');
      initializedRef.current = false;
      clearPeers();
      stateRef.current = {
        localScreenStream: null,
        activeScreenSharePeerId: null,
        peersWithScreenShareAvailable: new Set()
      };
      sendersRef.current = {
        sendPeerInfo: null,
        sendScreenShareStatus: null,
        sendActiveScreenShare: null,
        sendFocusChange: null
      };
    };
  }, [
    room,
    selfId,
    name,
    isHost,
    addPeer,
    updatePeer,
    removePeer,
    clearPeers,
    setActiveScreenSharePeerId,
    setFocusedPeerId
  ]);

  return {
    selfId,
    addLocalStream,
    removeLocalStream,
    setActiveScreenShare,
    broadcastFocusChange,
    getActiveScreenSharePeerId: () => stateRef.current.activeScreenSharePeerId,
    hasLocalScreenShare: () => stateRef.current.localScreenStream !== null,
    getPeersWithScreenShareAvailable: () => Array.from(stateRef.current.peersWithScreenShareAvailable)
  };
}
