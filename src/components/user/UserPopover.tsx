import { useState, useRef, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';

interface UserPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function UserPopover({ isOpen, onClose, anchorRef }: UserPopoverProps) {
  const { profile, updateProfile } = useUserStore();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [fullName, setFullName] = useState(profile?.fullName || '');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && profile) {
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
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose, anchorRef]);

  const handleSave = () => {
    if (displayName.trim() && fullName.trim()) {
      updateProfile({
        displayName: displayName.trim(),
        fullName: fullName.trim(),
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

  if (!isOpen || !profile) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute right-2 top-full mt-1 w-72 border border-white/30 rounded-xl bg-white/70 backdrop-blur-xl shadow-lg z-50"
    >
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg bg-white/50 text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                placeholder="How others see you"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg bg-white/50 text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                placeholder="For recordings"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleCancel}
                className="flex-1 px-3 py-1.5 text-sm text-gray-700 hover:text-black border border-gray-300 rounded-lg hover:bg-white/30 cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!displayName.trim() || !fullName.trim()}
                className="flex-1 px-3 py-1.5 text-sm bg-black hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg cursor-pointer transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-gray-600 mb-0.5">Display Name</div>
              <div className="text-black font-medium">{profile.displayName}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600 mb-0.5">Full Name</div>
              <div className="text-black font-medium">{profile.fullName}</div>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="w-full px-3 py-1.5 text-sm text-gray-700 hover:text-black border border-gray-300 rounded-lg hover:bg-white/30 cursor-pointer transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              Edit Profile
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-gray-300 p-2">
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
