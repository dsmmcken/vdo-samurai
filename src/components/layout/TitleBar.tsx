import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useSessionStore } from '../../store/sessionStore';
import { useRecordingStore } from '../../store/recordingStore';
import { UserPopover } from '../user/UserPopover';
import { ShareLink } from '../connection/ShareLink';
import { ConnectionStatus } from '../connection/ConnectionStatus';

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

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

export function TitleBar() {
  const { profile } = useUserStore();
  const { sessionId, isConnected } = useSessionStore();
  const { isRecording, startTime } = useRecordingStore();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [elapsed, setElapsed] = useState('00:00');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const location = useLocation();

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
  const showSessionControls = isConnected && sessionId;

  const getBgClass = () => {
    if (isHomePage) return 'bg-white border-b border-gray-200';
    if (isSessionPage) return 'bg-black';
    return 'bg-[--color-dark-lighter] border-b border-gray-700/50';
  };

  return (
    <div
      className={`h-9 ${getBgClass()} flex items-center justify-between pr-3 relative ${isMac ? 'pl-20' : 'pl-3'}`}
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
            <ShareLink sessionId={sessionId} />
            <ConnectionStatus />
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
            onClick={() => setIsPopoverOpen(!isPopoverOpen)}
            className={`w-7 h-7 rounded-full ${isHomePage ? 'bg-gray-200 hover:bg-gray-300' : 'bg-[--color-primary]/20 hover:bg-[--color-primary]/30'} flex items-center justify-center transition-colors`}
            aria-label="User menu"
            aria-expanded={isPopoverOpen}
          >
            {initials ? (
              <span className={`text-xs font-medium ${isHomePage ? 'text-black' : 'text-[--color-primary]'}`}>{initials}</span>
            ) : (
              <svg
                className={`w-4 h-4 ${isHomePage ? 'text-black' : 'text-[--color-primary]'}`}
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
      </div>

      <UserPopover
        isOpen={isPopoverOpen}
        onClose={() => setIsPopoverOpen(false)}
        anchorRef={buttonRef}
      />
    </div>
  );
}
