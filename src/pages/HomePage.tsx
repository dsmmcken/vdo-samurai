import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import { useUserStore } from '../store/userStore';
import { CherryBlossomButton } from '../components/ui/CherryBlossomButton';
import { PendingTransferBanner } from '../components/PendingTransferBanner';
import { usePendingTransfers } from '../hooks/usePendingTransfers';
import { formatRoomCode } from '../utils/roomCode';
import { isBrowser } from '../utils/platform';
import { getRoomCodeFromUrl, clearRoomFromUrl } from '../utils/urlParams';

const DEBUG_ROOM_CODE = formatRoomCode('debug_room', 'debug_password');

const LAST_SESSION_KEY = 'vdo-samurai-last-session';
const BG_IMAGE_URL = './samurai-bg.jpg';

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
  const [bgLoaded, setBgLoaded] = useState(false);
  const [urlRoomCode, setUrlRoomCode] = useState<string | null>(null);
  const navigate = useNavigate();
  const { createSession, joinSession } = useWebRTC();
  const { requestStream } = useMediaStream();
  const { profile } = useUserStore();

  // Pending transfers (browser only)
  const {
    pendingTransfers,
    hasPendingTransfers,
    downloadPendingTransfer,
    removePendingTransfer
  } = usePendingTransfers();

  const browserMode = isBrowser();

  // Check URL for room code on mount
  useEffect(() => {
    const roomFromUrl = getRoomCodeFromUrl();
    if (roomFromUrl) {
      setUrlRoomCode(roomFromUrl);
      setRoomCode(roomFromUrl);
      // Clear from URL to keep it clean
      clearRoomFromUrl();
    }
  }, []);

  useEffect(() => {
    const stored = getLastSession();
    setLastSession(stored);
    // Only populate from last session if no URL room code
    if (stored?.roomCode && !urlRoomCode) {
      setRoomCode(stored.roomCode);
    }
  }, [urlRoomCode]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setBgLoaded(true);
    img.src = BG_IMAGE_URL;
  }, []);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !profile?.displayName) return;

    setIsJoining(true);
    try {
      const code = roomCode.trim();
      // In browser mode, always join as participant (never as host)
      const isRejoiningAsHost =
        !browserMode && lastSession?.roomCode === code && lastSession?.wasHost;

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
      navigate(`/session/${encodeURIComponent(code)}`);
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
      navigate(`/session/${encodeURIComponent(newSessionId)}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateDebugRoom = async () => {
    if (!profile?.displayName) return;

    setIsCreating(true);
    try {
      await requestStream();
      await createSession(profile.displayName, DEBUG_ROOM_CODE);
      saveLastSession(DEBUG_ROOM_CODE, true);
      navigate(`/session/${encodeURIComponent(DEBUG_ROOM_CODE)}`);
    } catch (err) {
      console.error('Failed to create debug session:', err);
    } finally {
      setIsCreating(false);
    }
  };

  // Handle reconnect from pending transfer banner
  const handleReconnect = (sessionCode: string) => {
    setRoomCode(sessionCode);
    // The user will need to click "Join Room" to actually connect
    // This ensures they can see what they're connecting to
  };

  return (
    <div
      className={`min-h-screen w-full bg-cover bg-center bg-no-repeat bg-fixed flex items-center justify-center bg-fade-in ${bgLoaded ? 'loaded' : ''}`}
      style={{ backgroundImage: `url(${BG_IMAGE_URL})` }}
    >
      <div className="flex flex-col items-center p-8 border border-white/30 rounded-xl bg-white/20 backdrop-blur-xl shadow-lg w-full max-w-sm">
        <h1 className="text-3xl font-bold text-black mb-2">VDO Samurai</h1>

        {browserMode && (
          <p className="text-xs text-gray-600 mb-4 text-center">
            Browser Participant Mode
          </p>
        )}

        {/* Pending transfer banner (browser only) */}
        {browserMode && hasPendingTransfers && (
          <PendingTransferBanner
            transfers={pendingTransfers}
            onReconnect={handleReconnect}
            onDownload={downloadPendingTransfer}
            onDismiss={removePendingTransfer}
          />
        )}

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
          <CherryBlossomButton
            type="submit"
            disabled={isJoining || !roomCode.trim()}
            containerClassName="mt-4"
            className="w-full px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {isJoining
              ? 'Joining...'
              : lastSession?.roomCode === roomCode.trim() && !browserMode
                ? 'Rejoin Room'
                : 'Join Room'}
          </CherryBlossomButton>
        </form>

        {/* Only show "Create Room" in Electron mode */}
        {!browserMode && (
          <>
            <div className="flex items-center w-full my-6">
              <div className="flex-1 border-t border-gray-300"></div>
              <span className="px-4 text-gray-500 text-sm">or</span>
              <div className="flex-1 border-t border-gray-300"></div>
            </div>

            <CherryBlossomButton
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full px-4 py-2 bg-white/50 text-black border border-gray-300 rounded-lg font-medium hover:bg-white/70 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {isCreating ? 'Creating...' : 'Create Room'}
            </CherryBlossomButton>

            {import.meta.env.DEV && (
              <button
                onClick={handleCreateDebugRoom}
                disabled={isCreating}
                className="w-full mt-2 px-4 py-2 bg-yellow-500/50 text-black border border-yellow-600 rounded-lg font-medium hover:bg-yellow-500/70 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors text-sm"
              >
                Create Debug Room
              </button>
            )}
          </>
        )}

        {/* Browser mode info */}
        {browserMode && (
          <p className="mt-6 text-xs text-gray-500 text-center">
            To host a session, download the{' '}
            <a
              href="https://github.com/dsmmcken/vdo-samurai/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              desktop app
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
