import { useState, useEffect } from 'react';
import { useUserStore } from '../../store/userStore';

const BG_IMAGE_URL = './samurai-bg.jpg';

export function ProfileSetup() {
  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [bgLoaded, setBgLoaded] = useState(false);
  const { setProfile } = useUserStore();

  useEffect(() => {
    const img = new Image();
    img.onload = () => setBgLoaded(true);
    img.src = BG_IMAGE_URL;
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim() && fullName.trim()) {
      setProfile({
        displayName: displayName.trim(),
        fullName: fullName.trim()
      });
    }
  };

  const isValid = displayName.trim() && fullName.trim();

  return (
    <div
      className={`flex-1 flex items-center justify-center p-4 min-h-screen bg-cover bg-center bg-no-repeat bg-fixed bg-fade-in ${bgLoaded ? 'loaded' : ''}`}
      style={{ backgroundImage: `url(${BG_IMAGE_URL})` }}
    >
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center p-8 border border-white/30 rounded-xl bg-white/20 backdrop-blur-xl shadow-lg">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-black mb-2">Welcome to VDO Samurai</h1>
            <p className="text-gray-600">Set up your profile to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 w-full">
            <div>
              <label
                htmlFor="display-name"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Display Name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others will see you"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/50 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">
                This name will be shown to other participants
              </p>
            </div>

            <div>
              <label htmlFor="full-name" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
              </label>
              <input
                id="full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white/50 text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                required
              />
              <p className="mt-1.5 text-xs text-gray-500">Used for recordings and video exports</p>
            </div>

            <button
              type="submit"
              disabled={!isValid}
              className="w-full px-4 py-3 bg-black text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors mt-2"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
