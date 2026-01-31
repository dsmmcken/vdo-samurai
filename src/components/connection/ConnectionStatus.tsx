import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useRecordingStore } from '../../store/recordingStore';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount';

interface ConnectionStatusProps {
  onReconnect?: () => void;
}

export function ConnectionStatus({ onReconnect }: ConnectionStatusProps) {
  const { isConnected, isConnecting, sessionId } = useSessionStore();
  const { peers } = usePeerStore();
  const { activePopover, togglePopover, closePopover } = usePopoverStore();
  const { isRecording, internalSessionId } = useRecordingStore();
  const location = useLocation();
  const isSessionPage = location.pathname.startsWith('/session/');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const showDetails = activePopover === 'connection';
  const { shouldRender, isExiting } = useDelayedUnmount(showDetails);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    }

    if (showDetails) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDetails, closePopover]);

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
        ref={buttonRef}
        onClick={() => togglePopover('connection')}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer ${isSessionPage ? 'bg-gray-800 hover:bg-gray-700' : 'bg-[--color-dark-lighter] hover:bg-gray-700'}`}
        aria-label={`Connection status: ${getStatusText()}`}
        aria-expanded={showDetails}
      >
        <span
          className={`w-2 h-2 rounded-full ${getStatusColor()} ${isConnecting ? 'animate-pulse' : ''}`}
        />
        <span className="text-xs text-gray-300">{getStatusText()}</span>
        {peers.length > 0 && (
          <span className="text-xs text-gray-500">
            ({peers.length} peer{peers.length !== 1 ? 's' : ''})
          </span>
        )}
      </button>

      {shouldRender && (
        <div
          ref={popoverRef}
          className={`absolute top-full right-0 mt-2 w-72 rounded-xl shadow-xl border border-gray-700 p-4 z-50 backdrop-blur-xl ${
            isExiting ? 'popover-exit' : 'popover-enter'
          } ${isSessionPage ? 'bg-black/80' : 'bg-[--color-dark-lighter]/80'}`}
        >
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

            {/* Recording session ID */}
            {isRecording && internalSessionId && (
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Recording Session</h4>
                <code className="text-xs text-gray-300 bg-[--color-dark] px-2 py-1 rounded block truncate">
                  {internalSessionId}
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
                  closePopover();
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
