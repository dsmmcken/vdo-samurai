import { Link } from 'react-router-dom';
import { useSessionStore } from '../../store/sessionStore';
import { ShareLink } from '../connection/ShareLink';
import { ConnectionStatus } from '../connection/ConnectionStatus';

export function Header() {
  const { sessionId, isConnected } = useSessionStore();

  return (
    <header
      className="bg-[--color-dark-lighter] border-b border-gray-700 px-4 sm:px-6 lg:px-8 py-3"
      role="banner"
    >
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/"
            className="text-lg sm:text-xl font-bold text-[--color-primary] hover:text-[--color-primary-dark] transition-colors flex-shrink-0"
            aria-label="VDO Samurai - Go to home page"
          >
            VDO Samurai
          </Link>
        </div>

        <nav
          className="flex items-center gap-2 sm:gap-4"
          role="navigation"
          aria-label="Main navigation"
        >
          {isConnected && sessionId && (
            <>
              <div className="hidden sm:block">
                <ShareLink sessionId={sessionId} />
              </div>
              <ConnectionStatus />
            </>
          )}
          {!isConnected && (
            <Link
              to="/composite"
              className="text-sm text-gray-400 hover:text-white transition-colors hidden sm:block"
            >
              Composite
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
