import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { useUserStore } from '../store/userStore';

const LAST_SESSION_KEY = 'vdo-samurai-last-session';

interface LastSession {
  roomCode: string;
  wasHost: boolean;
}

function getLastSession(): LastSession | null {
  try {
    const stored = localStorage.getItem(LAST_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveLastSession(roomCode: string, wasHost: boolean) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ roomCode, wasHost }));
}

export function HomePage() {
  const [roomCode, setRoomCode] = useState('');
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  const { createSession, joinSession } = useWebRTC();
  const { requestStream } = useMediaStream();
  const { profile } = useUserStore();

  useEffect(() => {
    const stored = getLastSession();
    setLastSession(stored);
    if (stored?.roomCode) {
      setRoomCode(stored.roomCode);
    }
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !profile?.displayName) return;

    setIsJoining(true);
    try {
      const code = roomCode.trim();
      const isRejoiningAsHost = lastSession?.roomCode === code && lastSession?.wasHost;

      // Request media access first
      await requestStream();

      if (isRejoiningAsHost) {
        // Rejoin as host - use createSession with the same room code
        await createSession(profile.displayName, code);
      } else {
        // Join as participant
        await joinSession(code, profile.displayName);
      }

      saveLastSession(code, isRejoiningAsHost);
      navigate(`/session/${code}`);
    } catch (err) {
      console.error('Failed to join session:', err);
    } finally {
      setIsJoining(false);
    }
  };

  const handleCreate = async () => {
    if (!profile?.displayName) return;

    setIsCreating(true);
    try {
      // Request media access first
      await requestStream();

      // Create session - will generate a new ID
      const newSessionId = await createSession(profile.displayName);

      saveLastSession(newSessionId, true);
      navigate(`/session/${newSessionId}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full bg-cover bg-center bg-no-repeat bg-fixed flex items-center justify-center"
      style={{ backgroundImage: 'url(/samurai-bg.jpg)' }}
    >
      <div className="flex flex-col items-center p-8 border border-white/30 rounded-xl bg-white/20 backdrop-blur-xl shadow-lg w-full max-w-sm">
        <h1 className="text-3xl font-bold text-black mb-8">
          VDO Samurai
        </h1>

        <form onSubmit={handleJoin} className="w-full">
          <label htmlFor="room-code" className="block text-sm font-medium text-gray-700 mb-2">
            Room Code
          </label>
          <input
            id="room-code"
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="Enter room code"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white/50 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={isJoining || !roomCode.trim()}
            className="w-full mt-4 px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {isJoining
              ? 'Joining...'
              : lastSession?.roomCode === roomCode.trim()
                ? 'Rejoin Room'
                : 'Join Room'}
          </button>
        </form>

        <div className="flex items-center w-full my-6">
          <div className="flex-1 border-t border-gray-300"></div>
          <span className="px-4 text-gray-500 text-sm">or</span>
          <div className="flex-1 border-t border-gray-300"></div>
        </div>

        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="w-full px-4 py-2 bg-white/50 text-black border border-gray-300 rounded-lg font-medium hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          {isCreating ? 'Creating...' : 'Create Room'}
        </button>
      </div>
    </div>
  );
}
