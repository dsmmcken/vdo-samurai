import { useState, useEffect } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';

interface ConnectionStatusProps {
  onReconnect?: () => void;
}

export function ConnectionStatus({ onReconnect }: ConnectionStatusProps) {
  const { isConnected, isConnecting, sessionId } = useSessionStore();
  const { peers } = usePeerStore();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Don't show if not in a session
  if (!sessionId && !isConnecting) {
    return null;
  }

  const getStatusColor = () => {
    if (!isOnline) return 'bg-red-500';
    if (isConnecting) return 'bg-yellow-500';
    if (isConnected) return 'bg-green-500';
    return 'bg-gray-500';
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isConnecting) return 'Connecting...';
    if (isConnected) return 'Connected';
    return 'Disconnected';
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[--color-dark-lighter] hover:bg-gray-700 transition-colors"
        aria-label={`Connection status: ${getStatusText()}`}
        aria-expanded={showDetails}
      >
        <span
          className={`w-2 h-2 rounded-full ${getStatusColor()} ${isConnecting ? 'animate-pulse' : ''}`}
        />
        <span className="text-sm text-gray-300">{getStatusText()}</span>
        {peers.length > 0 && (
          <span className="text-xs text-gray-500">
            ({peers.length} peer{peers.length !== 1 ? 's' : ''})
          </span>
        )}
      </button>

      {showDetails && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-[--color-dark-lighter] rounded-xl shadow-xl border border-gray-700 p-4 z-50">
          <div className="space-y-4">
            {/* Network status */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">Network</h4>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <span className="text-white">{isOnline ? 'Online' : 'Offline'}</span>
              </div>
            </div>

            {/* Session info */}
            {sessionId && (
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Session</h4>
                <code className="text-xs text-gray-300 bg-[--color-dark] px-2 py-1 rounded block truncate">
                  {sessionId}
                </code>
              </div>
            )}

            {/* Connected peers */}
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">
                Connected Peers ({peers.length})
              </h4>
              {peers.length === 0 ? (
                <p className="text-sm text-gray-500">No peers connected</p>
              ) : (
                <ul className="space-y-1">
                  {peers.map((peer) => (
                    <li key={peer.id} className="flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-white">{peer.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Reconnect button */}
            {!isConnected && !isConnecting && onReconnect && (
              <button
                onClick={() => {
                  onReconnect();
                  setShowDetails(false);
                }}
                className="w-full py-2 px-4 bg-[--color-primary] hover:bg-[--color-primary-dark] text-white rounded-lg text-sm font-medium transition-colors"
              >
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
