import { useRef, useEffect, useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useSessionStore } from '../../store/sessionStore';
import { useRecordingStore } from '../../store/recordingStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useTransferStore } from '../../store/transferStore';
import { useWebRTC } from '../../hooks/useWebRTC';
import { useMediaStream } from '../../hooks/useMediaStream';
import { UserPopover } from '../user/UserPopover';
import { ShareLink } from '../connection/ShareLink';
import { ConnectionStatus } from '../connection/ConnectionStatus';
import { formatRoomCode } from '../../utils/roomCode';

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const platform = window.electronAPI?.platform;
const isMac = platform === 'darwin';
// Windows and Linux use frameless windows with custom controls
const useCustomControls = platform === 'win32' || platform === 'linux';

export function TitleBar() {
  const { profile } = useUserStore();
  const { sessionId, sessionPassword, isConnected } = useSessionStore();

  // Combine roomId and password for shareable link
  const shareableCode = sessionId && sessionPassword ? formatRoomCode(sessionId, sessionPassword) : null;
  const { isRecording, startTime } = useRecordingStore();
  const { activePopover, togglePopover } = usePopoverStore();
  const { isTransferring } = useTransferStore();
  const { leaveSession } = useWebRTC();
  const { stopStream } = useMediaStream();
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState('00:00');
  const [isMaximized, setIsMaximized] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const location = useLocation();
  const isUserPopoverOpen = activePopover === 'user';

  // Check maximized state for frameless windows (Windows/Linux)
  useEffect(() => {
    if (!useCustomControls) return;

    const checkMaximized = async () => {
      const maximized = await window.electronAPI.window.isMaximized();
      setIsMaximized(maximized);
    };

    checkMaximized();

    // Check periodically since there's no event listener for maximize/unmaximize
    const interval = setInterval(checkMaximized, 500);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = () => window.electronAPI.window.minimize();
  const handleMaximize = async () => {
    await window.electronAPI.window.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => window.electronAPI.window.close();

  const updateElapsed = useCallback(() => {
    if (startTime) {
      setElapsed(formatTime(Date.now() - startTime));
    }
  }, [startTime]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isRecording || !startTime) {
      setElapsed('00:00');
      return;
    }

    updateElapsed();
    intervalRef.current = setInterval(updateElapsed, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, startTime, updateElapsed]);

  const isHomePage = location.pathname === '/';
  const isSessionPage = location.pathname.startsWith('/session/');
  const initials = profile?.displayName ? getInitials(profile.displayName) : '';
  const showSessionControls = isConnected && shareableCode;

  const handleLeave = () => {
    if (isTransferring()) {
      const confirm = window.confirm(
        'File transfers are in progress. Are you sure you want to leave?'
      );
      if (!confirm) return;
    }
    stopStream();
    leaveSession();
    navigate('/');
  };

  const getBgClass = () => {
    if (isHomePage) return 'bg-white border-b border-gray-200';
    if (isSessionPage) return 'bg-black';
    return 'bg-[--color-dark-lighter] border-b border-gray-700/50';
  };

  return (
    <div
      className={`h-9 ${getBgClass()} flex items-center justify-between ${useCustomControls ? 'pr-0' : 'pr-3'} relative ${isMac ? 'pl-20' : 'pl-3'}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left side - App name/home link */}
      <Link
        to="/"
        className={`text-sm font-bold ${isHomePage ? 'text-black hover:text-gray-700' : 'text-[--color-primary] hover:text-[--color-primary]/80'} transition-colors`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        aria-label="VDO Samurai - Go to home page"
      >
        VDO Samurai
      </Link>

      {/* Right side - Session controls and user menu */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {showSessionControls && (
          <>
            <ShareLink sessionId={shareableCode} />
            <ConnectionStatus />
            <button
              onClick={handleLeave}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/80 hover:bg-red-500 text-white text-xs font-medium transition-colors cursor-pointer"
              aria-label="Leave session"
              title="Leave session"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z"
                />
              </svg>
              Leave
            </button>
            {isRecording && (
              <div className="flex items-center gap-1.5 bg-red-500 text-white px-2 py-0.5 rounded text-xs font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span>REC</span>
                <span className="font-mono">{elapsed}</span>
              </div>
            )}
          </>
        )}

        {profile && (
          <button
            ref={buttonRef}
            onClick={() => togglePopover('user')}
            className={`w-6 h-6 rounded-full ${isHomePage ? 'bg-gray-200 hover:bg-gray-300' : 'bg-gray-800 hover:bg-gray-700'} flex items-center justify-center transition-colors cursor-pointer`}
            aria-label="User menu"
            aria-expanded={isUserPopoverOpen}
          >
            {initials ? (
              <span className={`text-xs font-medium ${isHomePage ? 'text-black' : 'text-gray-300'}`}>{initials}</span>
            ) : (
              <svg
                className={`w-3 h-3 ${isHomePage ? 'text-black' : 'text-gray-300'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            )}
          </button>
        )}

        {/* Window controls for Windows/Linux */}
        {useCustomControls && (
          <div className="flex items-center ml-2">
            <button
              onClick={handleMinimize}
              className={`w-7 h-7 flex items-center justify-center hover:bg-gray-500/30 transition-colors cursor-pointer ${isHomePage ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-white'}`}
              aria-label="Minimize"
            >
              <svg className="w-3 h-0.5" fill="currentColor" viewBox="0 0 12 2">
                <rect width="12" height="2" />
              </svg>
            </button>
            <button
              onClick={handleMaximize}
              className={`w-7 h-7 flex items-center justify-center hover:bg-gray-500/30 transition-colors cursor-pointer ${isHomePage ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-white'}`}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
                  <rect x="2.5" y="0.5" width="9" height="9" rx="1" />
                  <rect x="0.5" y="2.5" width="9" height="9" rx="1" fill={isHomePage ? 'white' : '#0f0f23'} />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 12 12">
                  <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1" />
                </svg>
              )}
            </button>
            <button
              onClick={handleClose}
              className={`w-7 h-7 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors cursor-pointer ${isHomePage ? 'text-gray-600' : 'text-gray-400'}`}
              aria-label="Close"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 12 12">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <UserPopover anchorRef={buttonRef} />
    </div>
  );
}
