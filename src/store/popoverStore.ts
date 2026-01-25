import { create } from 'zustand';

type PopoverId = 'user' | 'connection' | 'recordingComplete' | null;

interface PopoverState {
  activePopover: PopoverId;
  openPopover: (id: PopoverId) => void;
  closePopover: () => void;
  togglePopover: (id: Exclude<PopoverId, null>) => void;
}

export const usePopoverStore = create<PopoverState>((set, get) => ({
  activePopover: null,
  openPopover: (id) => set({ activePopover: id }),
  closePopover: () => set({ activePopover: null }),
  togglePopover: (id) => {
    const current = get().activePopover;
    set({ activePopover: current === id ? null : id });
  },
}));
