import type { Page } from '@playwright/test';
import { selectors } from './selectors';
import { sleep, waitForLocalScreenShare } from './wait-helpers';

/**
 * Complete profile setup on the welcome screen
 */
export async function setupProfile(page: Page, displayName: string, fullName?: string) {
  await page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
  await page.fill('#display-name', displayName);
  await page.fill('#full-name', fullName || `${displayName} Full`);
  await page.click('button:has-text("Continue")');
  await page.waitForSelector(selectors.home.title, { timeout: 10000 });
}

/**
 * Create a new session as host and return the session ID
 */
export async function createSession(page: Page): Promise<string> {
  await page.click(selectors.home.createRoomButton);
  await page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
  const url = page.url();
  const match = url.match(/\/session\/([^/]+)/);
  if (!match) throw new Error('Could not extract session ID from URL');
  return match[1];
}

/**
 * Join an existing session as participant
 */
export async function joinSession(page: Page, sessionId: string) {
  await page.fill(selectors.home.roomCodeInput, sessionId);
  await page.click(selectors.home.joinRoomButton);
  await page.waitForSelector(selectors.session.participantList, { timeout: 30000 });
}

/**
 * Wait for P2P connection between host and participant
 * Both pages should see 2 or more tiles (self + peer)
 */
export async function waitForP2PConnection(
  hostPage: Page,
  participantPage: Page,
  timeout: number = 90000
) {
  const pollInterval = 5000;
  const startTime = Date.now();
  let connected = false;

  while (Date.now() - startTime < timeout && !connected) {
    await sleep(pollInterval);
    const hostTiles = await hostPage.locator('[role="listitem"]').count();
    const participantTiles = await participantPage.locator('[role="listitem"]').count();
    console.log(`[P2P] Host tiles: ${hostTiles}, Participant tiles: ${participantTiles}`);
    if (hostTiles >= 2 && participantTiles >= 2) {
      connected = true;
    }
  }

  if (!connected) {
    throw new Error(`P2P connection timeout after ${timeout}ms`);
  }
  console.log('[P2P] Connection established');
}

/**
 * Start screen share by clicking the button and confirming in the dialog
 */
export async function startScreenShare(page: Page) {
  await page.click(selectors.session.screenShareButton);
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
  await page.click('[role="dialog"] button.bg-blue-600');
  await waitForLocalScreenShare(page, 10000);
}

/**
 * Get host's selfId from the window object
 */
export async function getSelfId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const win = window as unknown as { __trysteroSelfId?: string };
    return win.__trysteroSelfId ?? null;
  });
}

/**
 * Get a peer's ID by their name from the peer store
 */
export async function getPeerIdByName(page: Page, namePattern: string): Promise<string | null> {
  return page.evaluate((pattern) => {
    const store = (
      window as unknown as Record<
        string,
        { getState?: () => { peers?: Array<{ id: string; name: string }> } }
      >
    ).usePeerStore;
    if (store?.getState) {
      const peers = store.getState()?.peers ?? [];
      return peers.find((p) => p.name.includes(pattern))?.id ?? null;
    }
    return null;
  }, namePattern);
}
