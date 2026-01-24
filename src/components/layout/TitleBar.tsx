import { useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useSessionStore } from '../../store/sessionStore';
import { UserPopover } from '../user/UserPopover';
import { ShareLink } from '../connection/ShareLink';
import { ConnectionStatus } from '../connection/ConnectionStatus';

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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  const isHomePage = location.pathname === '/';
  const initials = profile?.displayName ? getInitials(profile.displayName) : '';
  const showSessionControls = isConnected && sessionId;

  return (
    <div
      className={`h-9 ${isHomePage ? 'bg-white border-b border-gray-200' : 'bg-[--color-dark-lighter] border-b border-gray-700/50'} flex items-center justify-between pr-3 relative ${isMac ? 'pl-20' : 'pl-3'}`}
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
