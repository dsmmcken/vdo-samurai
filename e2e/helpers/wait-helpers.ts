import type { Page } from '@playwright/test';

/**
 * Wait for a Zustand store state condition to be true
 */
export async function waitForStoreState<T>(
  page: Page,
  storeName: string,
  predicate: (state: T) => boolean,
  options: { timeout?: number; pollInterval?: number } = {}
): Promise<T> {
  const { timeout = 30000, pollInterval = 100 } = options;

  const result = await page.waitForFunction(
    ({ storeName, predicateStr }) => {
      // Access the store from window (Zustand exposes getState)
      const storeMap: Record<string, () => unknown> = {
        sessionStore: () => (window as unknown as Record<string, { getState?: () => unknown }>).useSessionStore?.getState?.(),
        recordingStore: () => (window as unknown as Record<string, { getState?: () => unknown }>).useRecordingStore?.getState?.(),
        peerStore: () => (window as unknown as Record<string, { getState?: () => unknown }>).usePeerStore?.getState?.(),
        transferStore: () => (window as unknown as Record<string, { getState?: () => unknown }>).useTransferStore?.getState?.(),
        nleStore: () => (window as unknown as Record<string, { getState?: () => unknown }>).useNLEStore?.getState?.(),
      };

      const getState = storeMap[storeName];
      if (!getState) return null;

      const state = getState();
      if (!state) return null;

      // Evaluate predicate (passed as string, eval it)
      const predicateFn = new Function('state', `return ${predicateStr}`);
      if (predicateFn(state)) {
        return state;
      }
      return null;
    },
    { storeName, predicateStr: predicate.toString().replace(/^.*=>/, '').trim() },
    { timeout, polling: pollInterval }
  );

  return result.jsonValue() as T;
}

/**
 * Wait for peer count to reach expected value
 */
export async function waitForPeerCount(
  page: Page,
  expectedCount: number,
  timeout = 30000
): Promise<void> {
  await page.waitForFunction(
    (count) => {
      // Try to access the store - it may be exposed on window or we can count tiles
      const store = (window as unknown as Record<string, { getState?: () => { peers?: unknown[] } }>).usePeerStore;
      if (store?.getState) {
        const state = store.getState();
        return state?.peers?.length === count;
      }
      // Fallback: count peer tiles in the DOM
      const tiles = document.querySelectorAll('[role="button"][aria-label*="Click to focus"]');
      // Subtract 1 for local user tile
      const peerCount = Math.max(0, tiles.length - 1);
      return peerCount === count;
    },
    expectedCount,
    { timeout }
  );
}

/**
 * Wait for recording to start
 */
export async function waitForRecordingStart(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      // Check store if available
      const store = (window as unknown as Record<string, { getState?: () => { isRecording?: boolean } }>).useRecordingStore;
      if (store?.getState) {
        return store.getState()?.isRecording === true;
      }
      // Fallback 1: check if Stop button is visible (host only)
      const stopButton = document.querySelector('button[aria-label="Stop"]');
      if (stopButton) return true;
      // Fallback 2: check for "ON AIR" indicator (visible to all participants)
      // The indicator has a red bg and contains "ON AIR" text
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent === 'ON AIR') return true;
      }
      return false;
    },
    undefined,
    { timeout }
  );
}

/**
 * Wait for recording to stop and blob to be available
 */
export async function waitForRecordingComplete(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      // Check store if available
      const store = (window as unknown as Record<string, { getState?: () => { isRecording?: boolean; localBlob?: unknown } }>).useRecordingStore;
      if (store?.getState) {
        const state = store.getState();
        // First just check that recording stopped
        if (state?.isRecording === false) {
          // localBlob may take a moment to be set, but recording is done
          return true;
        }
        return false;
      }
      // Fallback: check if Record button is visible (indicates not recording)
      const recordButton = document.querySelector('button[aria-label="Record"]');
      if (recordButton) return true;
      // Or check for recording complete text in any h3
      const h3s = document.querySelectorAll('h3');
      for (const h3 of h3s) {
        if (h3.textContent?.includes('Recording Complete')) return true;
      }
      return false;
    },
    undefined,
    { timeout }
  );
}

/**
 * Wait for file transfers to complete
 */
export async function waitForTransfersComplete(page: Page, timeout = 60000): Promise<void> {
  await page.waitForFunction(
    () => {
      type TransferState = { transfers?: Array<{ status: string }>; receivedRecordings?: unknown[] };
      const win = window as unknown as { useTransferStore?: { getState?: () => TransferState } };
      const state = win.useTransferStore?.getState?.();
      if (!state?.transfers || state.transfers.length === 0) return true;
      return state.transfers.every(
        (t) => t.status === 'complete' || t.status === 'error'
      );
    },
    undefined,
    { timeout }
  );
}

/**
 * Wait for received recordings from peers
 */
export async function waitForReceivedRecordings(
  page: Page,
  minCount: number,
  timeout = 60000
): Promise<void> {
  await page.waitForFunction(
    (count) => {
      type TransferState = { receivedRecordings?: unknown[] };
      const win = window as unknown as { useTransferStore?: { getState?: () => TransferState } };
      const state = win.useTransferStore?.getState?.();
      return (state?.receivedRecordings?.length ?? 0) >= count;
    },
    minCount,
    { timeout }
  );
}

/**
 * Simple sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for local screen share stream to be set in sessionStore
 */
export async function waitForLocalScreenShare(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as Record<string, { getState?: () => { localScreenStream?: MediaStream | null } }>
      ).useSessionStore;
      if (store?.getState) {
        const state = store.getState();
        return state?.localScreenStream !== null && state?.localScreenStream !== undefined;
      }
      return false;
    },
    undefined,
    { timeout }
  );
}

/**
 * Wait for a peer's screen share badge to be visible
 * The badge is inside a UserTile with aria-label containing the peer name
 * and has "Screen" text with green background
 */
export async function waitForPeerScreenShareBadge(
  page: Page,
  peerName: string,
  timeout = 30000
): Promise<void> {
  // The UserTile has role="button" and aria-label containing the peer name and "sharing screen"
  // We wait for the aria-label to include "sharing screen"
  await page.waitForSelector(
    `[role="button"][aria-label*="${peerName}"][aria-label*="sharing screen"]`,
    { timeout }
  );
}

/**
 * Get the name of the currently focused tile (from aria-pressed="true")
 * Returns the name extracted from the tile's aria-label
 */
export async function getFocusedTileName(page: Page): Promise<string | null> {
  const focusedTile = await page.locator('[role="button"][aria-pressed="true"]').first();
  if (await focusedTile.count() === 0) return null;

  const ariaLabel = await focusedTile.getAttribute('aria-label');
  if (!ariaLabel) return null;

  // Extract name - aria-label format is like "Host User (Host) sharing screen. Currently focused."
  // or "Participant sharing screen. Click to focus."
  // The name is at the beginning before any parentheses or status text
  const match = ariaLabel.match(/^([^(.\n]+)/);
  return match ? match[1].trim() : null;
}

/**
 * Wait for a specific tile to be focused (aria-pressed="true")
 */
export async function waitForTileFocused(
  page: Page,
  tileName: string,
  timeout = 10000
): Promise<void> {
  await page.waitForSelector(
    `[role="button"][aria-label*="${tileName}"][aria-pressed="true"]`,
    { timeout }
  );
}

/**
 * Get the focusedPeerId from the sessionStore
 */
export async function getFocusedPeerId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = (window as unknown as Record<string, { getState?: () => { focusedPeerId?: string | null } }>).useSessionStore;
    if (store?.getState) {
      return store.getState()?.focusedPeerId ?? null;
    }
    return null;
  });
}

/**
 * Wait for focusedPeerId to match expected value
 */
export async function waitForFocusedPeerId(
  page: Page,
  expectedPeerId: string | null,
  timeout = 10000
): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const store = (window as unknown as Record<string, { getState?: () => { focusedPeerId?: string | null } }>).useSessionStore;
      if (store?.getState) {
        const actual = store.getState()?.focusedPeerId;
        // Handle null comparison
        if (expected === null) return actual === null || actual === undefined;
        return actual === expected;
      }
      return false;
    },
    expectedPeerId,
    { timeout }
  );
}

/**
 * Wait for local blob to be set in recording store
 * More reliable than UI-based detection for verifying recording completed
 */
export async function waitForLocalBlob(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = (window as unknown as Record<string, { getState?: () => { localBlob?: Blob | null } }>).useRecordingStore;
      if (store?.getState) {
        const state = store.getState();
        return state?.localBlob !== null && state?.localBlob !== undefined;
      }
      return false;
    },
    undefined,
    { timeout }
  );
}
