import { create } from 'zustand';

interface SessionState {
  sessionId: string | null;
  sessionPassword: string | null; // Password for Trystero encryption (kept separate from sessionId)
  isHost: boolean;
  userName: string;
  localStream: MediaStream | null;
  localRecordingStream: MediaStream | null; // High-quality stream for local recording
  localScreenStream: MediaStream | null;
  focusedPeerId: string | null;
  focusTimestamp: number; // Timestamp of last focus change for conflict resolution
  activeScreenSharePeerId: string | null; // Only one screen share streams at a time
  tileOrder: string[]; // Ordered participant IDs ('self' for local user)
  tileOrderTimestamp: number; // Timestamp of last tile order change for conflict resolution
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;

  setSessionId: (id: string | null) => void;
  setSessionPassword: (password: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setUserName: (name: string) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setLocalRecordingStream: (stream: MediaStream | null) => void;
  setLocalScreenStream: (stream: MediaStream | null) => void;
  setFocusedPeerId: (peerId: string | null, timestamp?: number) => void;
  setActiveScreenSharePeerId: (peerId: string | null) => void;
  setTileOrder: (order: string[], timestamp?: number) => void;
  setIsConnecting: (connecting: boolean) => void;
  setIsConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  sessionPassword: null,
  isHost: false,
  userName: '',
  localStream: null,
  localRecordingStream: null,
  localScreenStream: null,
  focusedPeerId: null,
  focusTimestamp: 0,
  activeScreenSharePeerId: null,
  tileOrder: [] as string[],
  tileOrderTimestamp: 0,
  isConnecting: false,
  isConnected: false,
  error: null
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  setSessionId: (sessionId) => set({ sessionId }),
  setSessionPassword: (sessionPassword) => set({ sessionPassword }),
  setIsHost: (isHost) => set({ isHost }),
  setUserName: (userName) => set({ userName }),
  setLocalStream: (localStream) => {
    console.log(
      '[sessionStore] setLocalStream called:',
      !!localStream,
      localStream?.getVideoTracks()
    );
    set({ localStream });
  },
  setLocalRecordingStream: (localRecordingStream) => {
    console.log(
      '[sessionStore] setLocalRecordingStream called:',
      !!localRecordingStream,
      localRecordingStream?.getVideoTracks()
    );
    set({ localRecordingStream });
  },
  setLocalScreenStream: (localScreenStream) => set({ localScreenStream }),
  setFocusedPeerId: (focusedPeerId, timestamp) =>
    set({ focusedPeerId, focusTimestamp: timestamp ?? Date.now() }),
  setActiveScreenSharePeerId: (activeScreenSharePeerId) => set({ activeScreenSharePeerId }),
  setTileOrder: (tileOrder, timestamp) =>
    set({ tileOrder, tileOrderTimestamp: timestamp ?? Date.now() }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setError: (error) => set({ error }),
  reset: () => set(initialState)
}));
