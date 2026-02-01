import type { Page } from '@playwright/test';

/**
 * Get recording store state
 */
export async function getRecordingState(page: Page) {
  return page.evaluate(() => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            isRecording?: boolean;
            localBlob?: Blob | null;
            localScreenBlob?: Blob | null;
            startTime?: number | null;
            endTime?: number | null;
          };
        }
      >
    ).useRecordingStore;
    if (store?.getState) {
      const state = store.getState();
      return {
        isRecording: state.isRecording,
        localBlob: state.localBlob ? { size: state.localBlob.size } : null,
        localScreenBlob: state.localScreenBlob ? { size: state.localScreenBlob.size } : null,
        startTime: state.startTime,
        endTime: state.endTime,
      };
    }
    return null;
  });
}

/**
 * Get the currently focused peer ID from session store
 */
export async function getFocusedPeerId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (
      window as unknown as Record<
        string,
        { getState?: () => { focusedPeerId?: string | null } }
      >
    ).useSessionStore;
    return store?.getState?.()?.focusedPeerId ?? null;
  });
}

/**
 * Get a peer's info by name pattern from peer store
 */
export async function getPeerByName(page: Page, namePattern: string) {
  return page.evaluate((pattern) => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            peers?: Array<{
              id: string;
              name: string;
              stream?: MediaStream | null;
              screenStream?: MediaStream | null;
              isScreenSharing?: boolean;
            }>;
          };
        }
      >
    ).usePeerStore;
    if (store?.getState) {
      const peers = store.getState()?.peers ?? [];
      const peer = peers.find((p) => p.name?.includes(pattern));
      if (peer) {
        return {
          id: peer.id,
          name: peer.name,
          hasStream: !!peer.stream,
          hasScreenStream: !!peer.screenStream,
          isScreenSharing: peer.isScreenSharing,
        };
      }
    }
    return null;
  }, namePattern);
}

/**
 * Get local stream state from session store
 */
export async function getLocalStreamState(page: Page) {
  return page.evaluate(() => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            localStream?: MediaStream | null;
            localScreenStream?: MediaStream | null;
          };
        }
      >
    ).useSessionStore;
    if (store?.getState) {
      const state = store.getState();
      return {
        hasLocalStream: !!state?.localStream,
        hasLocalScreenStream: !!state?.localScreenStream,
      };
    }
    return null;
  });
}

/**
 * Get all peers from peer store
 */
export async function getAllPeers(page: Page) {
  return page.evaluate(() => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            peers?: Array<{
              id: string;
              name: string;
              stream?: MediaStream | null;
              screenStream?: MediaStream | null;
            }>;
          };
        }
      >
    ).usePeerStore;
    if (store?.getState) {
      const peers = store.getState()?.peers ?? [];
      return peers.map((p) => ({
        id: p.id,
        name: p.name,
        hasStream: !!p.stream,
        hasScreenStream: !!p.screenStream,
      }));
    }
    return [];
  });
}
