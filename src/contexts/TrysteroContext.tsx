import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode
} from 'react';
import { joinRoom, selfId, type Room } from 'trystero/mqtt';
import { P2P_CONFIG, RTC_CONFIG } from '../services/p2p/config';

interface TrysteroContextValue {
  room: Room | null;
  selfId: string;
  sessionId: string | null;
  isConnected: boolean;
  joinSession: (sessionId: string) => Room;
  leaveSession: () => void;
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

  const joinSession = useCallback((newSessionId: string): Room => {
    // Leave existing room if any
    if (roomRef.current) {
      console.log('[TrysteroProvider] Leaving existing room before joining new one');
      roomRef.current.leave();
    }

    console.log('[TrysteroProvider] Joining room:', newSessionId, 'selfId:', selfId);
    const newRoom = joinRoom({ appId: P2P_CONFIG.appId, rtcConfig: RTC_CONFIG }, newSessionId);

    roomRef.current = newRoom;
    setRoom(newRoom);
    setSessionId(newSessionId);

    return newRoom;
  }, []);

  const leaveSession = useCallback(() => {
    console.log('[TrysteroProvider] Leaving session');
    roomRef.current?.leave();
    roomRef.current = null;
    setRoom(null);
    setSessionId(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[TrysteroProvider] Cleanup on unmount');
      roomRef.current?.leave();
    };
  }, []);

  return (
    <TrysteroContext.Provider
      value={{
        room,
        selfId,
        sessionId,
        isConnected: !!room,
        joinSession,
        leaveSession
      }}
    >
      {children}
    </TrysteroContext.Provider>
  );
}
