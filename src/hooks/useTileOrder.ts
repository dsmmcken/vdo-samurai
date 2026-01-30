import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { usePeerStore } from '../store/peerStore';
import { useTrystero } from '../contexts/TrysteroContext';

const SELF_ID = 'self';

interface UseTileOrderReturn {
  orderedParticipantIds: string[]; // IDs in display order ('self' for local user, peer IDs for others)
  reorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * Hook for managing tile order with P2P sync
 * Handles ordering, peer joins/disconnects, and broadcasting changes
 */
export function useTileOrder(): UseTileOrderReturn {
  const { tileOrder, setTileOrder } = useSessionStore();
  const { peers } = usePeerStore();
  const { broadcastTileOrder } = useTrystero();

  // Track previous peers for detecting joins/leaves
  const prevPeerIdsRef = useRef<Set<string>>(new Set());

  // Get current peer IDs
  const currentPeerIds = useMemo(() => new Set(peers.map((p) => p.id)), [peers]);

  // Compute ordered participant IDs
  const orderedParticipantIds = useMemo(() => {
    // All participant IDs (self + peers)
    const allIds = new Set([SELF_ID, ...Array.from(currentPeerIds)]);

    // If we have a stored order, use it as base but filter out disconnected peers
    if (tileOrder.length > 0) {
      // Start with existing order, filter out IDs that are no longer present
      const validOrderedIds = tileOrder.filter((id) => allIds.has(id));

      // Find new IDs that aren't in the order yet
      const newIds = Array.from(allIds).filter((id) => !tileOrder.includes(id));

      // Combine: existing order + new IDs at end
      return [...validOrderedIds, ...newIds];
    }

    // No stored order - use default: self first, then peers in join order
    return [SELF_ID, ...Array.from(currentPeerIds)];
  }, [tileOrder, currentPeerIds]);

  // Handle peer joins/leaves - update tile order to include/exclude them
  useEffect(() => {
    const prevIds = prevPeerIdsRef.current;

    // Find newly joined peers
    const joinedPeers = Array.from(currentPeerIds).filter((id) => !prevIds.has(id));

    // Find disconnected peers
    const leftPeers = Array.from(prevIds).filter((id) => !currentPeerIds.has(id));

    // Update order if there are changes
    if (joinedPeers.length > 0 || leftPeers.length > 0) {
      // Filter out left peers from current order
      const newOrder = orderedParticipantIds.filter(
        (id) => id === SELF_ID || currentPeerIds.has(id)
      );

      // Add new peers at the end (they should already be included via orderedParticipantIds memo,
      // but we explicitly ensure they're there)
      for (const peerId of joinedPeers) {
        if (!newOrder.includes(peerId)) {
          newOrder.push(peerId);
        }
      }

      // Only update if actually changed
      if (newOrder.length !== tileOrder.length || newOrder.some((id, i) => tileOrder[i] !== id)) {
        // Update local state (don't broadcast - peer joins/leaves are local adjustments)
        setTileOrder(newOrder);
      }
    }

    // Update ref for next comparison
    prevPeerIdsRef.current = new Set(currentPeerIds);
  }, [currentPeerIds, orderedParticipantIds, tileOrder, setTileOrder]);

  // Reorder and broadcast
  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || fromIndex >= orderedParticipantIds.length) return;
      if (toIndex < 0 || toIndex >= orderedParticipantIds.length) return;

      // Create new order with item moved
      const newOrder = [...orderedParticipantIds];
      const [movedItem] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, movedItem);

      console.log('[useTileOrder] Reorder:', fromIndex, '->', toIndex, newOrder);

      // Broadcast to peers (this also updates local state)
      broadcastTileOrder(newOrder);
    },
    [orderedParticipantIds, broadcastTileOrder]
  );

  return {
    orderedParticipantIds,
    reorder
  };
}
