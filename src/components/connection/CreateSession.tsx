import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useSessionStore } from '../../store/sessionStore';
import { useUserStore } from '../../store/userStore';

export function CreateSession() {
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();
  const { createSession } = useWebRTC();
  const { requestStream } = useMediaStream();
  const { setUserName, error } = useSessionStore();
  const { profile } = useUserStore();

  const handleCreate = async () => {
    if (!profile?.displayName) return;

    setIsCreating(true);
    try {
      // Request media access first
      await requestStream();

      // Create the session
      const displayName = profile.displayName;
      setUserName(displayName);
      const sessionId = await createSession(displayName);

      // Navigate to session (URL-encode to handle ?p= in the code)
      navigate(`/session/${sessionId}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="bg-[--color-dark-lighter] rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Create New Room</h2>
      <p className="text-gray-400 text-sm mb-4">
        Start a new session and invite others to join
      </p>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <button
        onClick={handleCreate}
        disabled={isCreating}
        className="w-full px-4 py-3 bg-[--color-primary] hover:bg-[--color-primary]/80 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {isCreating ? (
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
            Creating...
          </span>
        ) : (
          'Create Room'
        )}
      </button>
    </div>
  );
}
