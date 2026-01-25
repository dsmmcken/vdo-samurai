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
  activeScreenSharePeerId: string | null; // Only one screen share streams at a time
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
  setFocusedPeerId: (peerId: string | null) => void;
  setActiveScreenSharePeerId: (peerId: string | null) => void;
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
  activeScreenSharePeerId: null,
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
    console.log('[sessionStore] setLocalStream called:', !!localStream, localStream?.getVideoTracks());
    set({ localStream });
  },
  setLocalRecordingStream: (localRecordingStream) => {
    console.log('[sessionStore] setLocalRecordingStream called:', !!localRecordingStream, localRecordingStream?.getVideoTracks());
    set({ localRecordingStream });
  },
  setLocalScreenStream: (localScreenStream) => set({ localScreenStream }),
  setFocusedPeerId: (focusedPeerId) => set({ focusedPeerId }),
  setActiveScreenSharePeerId: (activeScreenSharePeerId) => set({ activeScreenSharePeerId }),
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  setIsConnected: (isConnected) => set({ isConnected }),
  setError: (error) => set({ error }),
  reset: () => set(initialState)
}));
