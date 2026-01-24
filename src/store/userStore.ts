import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserProfile {
  displayName: string;
  fullName: string;
}

interface UserState {
  profile: UserProfile | null;
  setProfile: (profile: UserProfile) => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  clearProfile: () => void;
  isProfileComplete: () => boolean;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      profile: null,

      setProfile: (profile) => set({ profile }),

      updateProfile: (updates) => {
        const current = get().profile;
        if (current) {
          set({ profile: { ...current, ...updates } });
        }
      },

      clearProfile: () => set({ profile: null }),

      isProfileComplete: () => {
        const profile = get().profile;
        return !!(profile?.displayName?.trim() && profile?.fullName?.trim());
      },
    }),
    {
      name: 'vdo-samurai-user',
    }
  )
);
