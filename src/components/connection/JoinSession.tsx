import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useSessionStore } from '../../store/sessionStore';
import { useUserStore } from '../../store/userStore';

interface JoinSessionProps {
  sessionId?: string;
}

export function JoinSession({ sessionId: initialSessionId }: JoinSessionProps) {
  const [sessionId, setSessionId] = useState(initialSessionId || '');
  const [isJoining, setIsJoining] = useState(false);
  const navigate = useNavigate();
  const { joinSession } = useWebRTC();
  const { requestStream } = useMediaStream();
  const { setUserName, error } = useSessionStore();
  const { profile } = useUserStore();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.displayName || !sessionId.trim()) return;

    setIsJoining(true);
    try {
      // Request media access first
      await requestStream();

      // Join the session
      const displayName = profile.displayName;
      setUserName(displayName);
      await joinSession(sessionId.trim(), displayName);

      // Navigate to session
      navigate(`/session/${sessionId.trim()}`);
    } catch (err) {
      console.error('Failed to join session:', err);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="bg-[--color-dark-lighter] rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Join Room</h2>

      <form onSubmit={handleJoin} className="space-y-4">
        {!initialSessionId && (
          <div>
            <label htmlFor="session-id" className="block text-sm font-medium text-gray-300 mb-1">
              Room ID
            </label>
            <input
              id="session-id"
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="Paste room ID or link"
              className="w-full px-4 py-2 bg-[--color-dark] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[--color-primary]"
              required
            />
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={isJoining || !sessionId.trim()}
          className="w-full px-4 py-3 bg-[--color-secondary] hover:bg-[--color-secondary]/80 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 font-medium rounded-lg transition-colors"
        >
          {isJoining ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Joining...
            </span>
          ) : (
            'Join Room'
          )}
        </button>
      </form>
    </div>
  );
}
