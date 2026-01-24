import { create } from 'zustand';
import type { Peer } from '../types';

interface PeerState {
  peers: Peer[];
  setPeers: (peers: Peer[]) => void;
  addPeer: (peer: Peer) => void;
  updatePeer: (peerId: string, updates: Partial<Peer>) => void;
  removePeer: (peerId: string) => void;
  clearPeers: () => void;
}

export const usePeerStore = create<PeerState>((set) => ({
  peers: [],

  setPeers: (peers) => set({ peers }),

  addPeer: (peer) =>
    set((state) => ({
      peers: [...state.peers.filter((p) => p.id !== peer.id), peer]
    })),

  updatePeer: (peerId, updates) =>
    set((state) => ({
      peers: state.peers.map((p) => (p.id === peerId ? { ...p, ...updates } : p))
    })),

  removePeer: (peerId) =>
    set((state) => ({
      peers: state.peers.filter((p) => p.id !== peerId)
    })),

  clearPeers: () => set({ peers: [] })
}));
