import { useState } from 'react';
import { useUserStore } from '../../store/userStore';

export function ProfileSetup() {
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const { setProfile } = useUserStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim() && fullName.trim()) {
      setProfile({
        displayName: displayName.trim(),
        fullName: fullName.trim(),
      });
    }
  };

  const isValid = displayName.trim() && fullName.trim();

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[--color-dark-lighter] rounded-xl p-8 shadow-xl border border-gray-700">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">
              Welcome to <span className="text-[--color-primary]">VDO</span> Samurai
            </h1>
            <p className="text-gray-400">
              Set up your profile to get started
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="display-name"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Display Name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others will see you"
                className="w-full px-4 py-3 bg-[--color-dark] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[--color-primary] transition-colors"
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">
                This name will be shown to other participants
              </p>
            </div>

            <div>
              <label
                htmlFor="full-name"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Full Name
              </label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full px-4 py-3 bg-[--color-dark] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[--color-primary] transition-colors"
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">
                Used for recordings and video exports
              </p>
            </div>

            <button
              type="submit"
              disabled={!isValid}
              className="w-full px-4 py-3 bg-[--color-primary] hover:bg-[--color-primary]/80 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors mt-2"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
