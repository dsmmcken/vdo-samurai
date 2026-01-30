import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { usePopoverStore } from '../../store/popoverStore';
import { useDelayedUnmount } from '../../hooks/useDelayedUnmount';

interface UserPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function UserPopover({ anchorRef }: UserPopoverProps) {
  const { profile, updateProfile } = useUserStore();
  const { activePopover, closePopover } = usePopoverStore();
  const location = useLocation();
  const isSessionPage = location.pathname.startsWith('/session/');
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [fullName, setFullName] = useState(profile?.fullName || '');
  const popoverRef = useRef<HTMLDivElement>(null);

  const isOpen = activePopover === 'user';
  const { shouldRender, isExiting } = useDelayedUnmount(isOpen);

  // Sync form state when popover opens
  // This effect intentionally sets state to reset form when opening
  useEffect(() => {
    if (isOpen && profile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName(profile.displayName);
      setFullName(profile.fullName);
      setIsEditing(false);
    }
  }, [isOpen, profile]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, closePopover, anchorRef]);

  const handleSave = () => {
    if (displayName.trim() && fullName.trim()) {
      updateProfile({
        displayName: displayName.trim(),
        fullName: fullName.trim()
      });
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setDisplayName(profile.displayName);
      setFullName(profile.fullName);
    }
    setIsEditing(false);
  };

  const handleClearData = () => {
    if (window.confirm('This will clear all app data and reset to a fresh state. Continue?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  if (!shouldRender || !profile) return null;

  return (
    <div
      ref={popoverRef}
      className={`absolute right-2 top-full mt-1 w-72 border rounded-xl shadow-lg z-50 backdrop-blur-xl ${
        isExiting ? 'popover-exit' : 'popover-enter'
      } ${isSessionPage ? 'bg-black/80 border-gray-700' : 'border-white/30 bg-white/70'}`}
    >
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label
                className={`block text-xs font-medium mb-1 ${isSessionPage ? 'text-gray-400' : 'text-gray-700'}`}
              >
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                  isSessionPage
                    ? 'border-gray-600 bg-gray-900 text-white placeholder-gray-500 focus:ring-gray-500'
                    : 'border-gray-300 bg-white/50 text-black placeholder-gray-400 focus:ring-gray-400'
                }`}
                placeholder="How others see you"
              />
            </div>
            <div>
              <label
                className={`block text-xs font-medium mb-1 ${isSessionPage ? 'text-gray-400' : 'text-gray-700'}`}
              >
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={`w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                  isSessionPage
                    ? 'border-gray-600 bg-gray-900 text-white placeholder-gray-500 focus:ring-gray-500'
                    : 'border-gray-300 bg-white/50 text-black placeholder-gray-400 focus:ring-gray-400'
                }`}
                placeholder="For recordings"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCancel}
                className={`flex-1 px-3 py-1.5 text-sm border rounded-lg cursor-pointer transition-colors ${
                  isSessionPage
                    ? 'text-gray-300 hover:text-white border-gray-600 hover:bg-gray-800'
                    : 'text-gray-700 hover:text-black border-gray-300 hover:bg-white/30'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!displayName.trim() || !fullName.trim()}
                className={`flex-1 px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed rounded-lg cursor-pointer transition-colors ${
                  isSessionPage
                    ? 'bg-white hover:bg-gray-200 text-black'
                    : 'bg-black hover:bg-gray-800 text-white'
                }`}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div
                className={`text-xs font-medium mb-0.5 ${isSessionPage ? 'text-gray-400' : 'text-gray-600'}`}
              >
                Display Name
              </div>
              <div className={`font-medium ${isSessionPage ? 'text-white' : 'text-black'}`}>
                {profile.displayName}
              </div>
            </div>
            <div>
              <div
                className={`text-xs font-medium mb-0.5 ${isSessionPage ? 'text-gray-400' : 'text-gray-600'}`}
              >
                Full Name
              </div>
              <div className={`font-medium ${isSessionPage ? 'text-white' : 'text-black'}`}>
                {profile.fullName}
              </div>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className={`w-full px-3 py-1.5 text-sm border rounded-lg cursor-pointer transition-colors flex items-center justify-center gap-2 ${
                isSessionPage
                  ? 'text-gray-300 hover:text-white border-gray-600 hover:bg-gray-800'
                  : 'text-gray-700 hover:text-black border-gray-300 hover:bg-white/30'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              Edit Profile
            </button>
          </div>
        )}
      </div>

      <div className={`border-t p-2 ${isSessionPage ? 'border-gray-700' : 'border-gray-300'}`}>
        <button
          onClick={handleClearData}
          className="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-red-600 cursor-pointer transition-colors"
        >
          Clear all data (debug)
        </button>
      </div>
    </div>
  );
}
