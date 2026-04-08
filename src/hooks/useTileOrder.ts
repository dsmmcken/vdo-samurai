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

  // Handle peer joins/leaves - persist tile order to the store.
  // Computes the new order from tileOrder (store) + currentPeerIds directly,
  // avoiding a dependency on orderedParticipantIds which would create a
  // re-render cascade (effect writes tileOrder -> memo recomputes -> effect re-runs).
  useEffect(() => {
    const prevIds = prevPeerIdsRef.current;

    // Find newly joined peers
    const joinedPeers = Array.from(currentPeerIds).filter((id) => !prevIds.has(id));

    // Find disconnected peers
    const leftPeers = Array.from(prevIds).filter((id) => !currentPeerIds.has(id));

    // Update order if there are changes
    if (joinedPeers.length > 0 || leftPeers.length > 0) {
      const allIds = new Set([SELF_ID, ...Array.from(currentPeerIds)]);

      let newOrder: string[];
      if (tileOrder.length > 0) {
        // Start with existing order, filter out IDs that are no longer present
        newOrder = tileOrder.filter((id) => allIds.has(id));
        // Add any IDs not yet in the order (newly joined peers + self if missing)
        for (const id of Array.from(allIds)) {
          if (!newOrder.includes(id)) {
            newOrder.push(id);
          }
        }
      } else {
        // No stored order - use default: self first, then peers
        newOrder = [SELF_ID, ...Array.from(currentPeerIds)];
      }

      // Only update if actually changed
      if (newOrder.length !== tileOrder.length || newOrder.some((id, i) => tileOrder[i] !== id)) {
        // Update local state (don't broadcast - peer joins/leaves are local adjustments)
        setTileOrder(newOrder);
      }
    }

    // Update ref for next comparison
    prevPeerIdsRef.current = new Set(currentPeerIds);
  }, [currentPeerIds, tileOrder, setTileOrder]);

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
