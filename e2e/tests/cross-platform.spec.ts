/**
 * Cross-platform E2E test: Electron Host + Browser Participant
 *
 * This test validates that VDO Samurai works with an Electron host
 * and a browser-based participant connecting via P2P.
 *
 * Prerequisites:
 * - npm run build      (Electron app)
 * - npm run build:web  (Browser app)
 * - npm run generate:test-videos (test videos)
 */
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import {
  launchBrowserParticipant,
  closeBrowserParticipant,
  type BrowserParticipant,
} from '../fixtures/browser-participant';
import { startTestServer, stopTestServer, type TestServer } from '../fixtures/test-server';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingComplete,
  waitForReceivedRecordings,
  waitForLocalScreenShare,
  waitForPeerScreenShareBadge,
  sleep,
} from '../helpers/wait-helpers';

// Test server port
const TEST_SERVER_PORT = 5174;

test.describe('Cross-Platform: Electron Host + Browser Participant', () => {
  let testServer: TestServer;
  let host: AppInstance;
  let browserParticipant: BrowserParticipant;

  test.beforeAll(async () => {
    // Start the test server
    console.log('[E2E] Starting test server...');
    testServer = await startTestServer(TEST_SERVER_PORT);
    console.log(`[E2E] Test server running at ${testServer.baseUrl}`);
  });

  test.afterAll(async () => {
    // Stop the test server
    if (testServer) {
      await stopTestServer(testServer);
    }
  });

  test.afterEach(async () => {
    // Cleanup instances in reverse order
    if (browserParticipant) {
      await closeBrowserParticipant(browserParticipant);
    }
    if (host) {
      await closeApp(host);
    }
  });

  test('Electron host and browser participant connect, record, and transfer', async () => {
    // ==========================================
    // STEP 1: Launch Electron host
    // ==========================================
    console.log('[E2E] Launching Electron host...');
    host = await launchApp('host');

    // ==========================================
    // STEP 2: Launch browser participant
    // ==========================================
    console.log('[E2E] Launching browser participant...');
    browserParticipant = await launchBrowserParticipant('browser-participant', {
      testServerBaseUrl: testServer.baseUrl,
    });

    // ==========================================
    // STEP 3: Complete profile setup for both
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    console.log('[E2E] Setting up browser participant profile...');
    await browserParticipant.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', {
      timeout: 15000,
    });
    await browserParticipant.page.fill('#display-name', 'Browser User');
    await browserParticipant.page.fill('#full-name', 'Browser Full Name');
    await browserParticipant.page.click('button:has-text("Continue")');

    // Wait for both to reach home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await browserParticipant.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 4: Host creates session
    // ==========================================
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Extract session ID from URL
    const hostUrl = host.page.url();
    const sessionIdMatch = hostUrl.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];
    console.log('[E2E] Session created:', sessionId);

    // ==========================================
    // STEP 5: Browser participant joins session
    // ==========================================
    console.log('[E2E] Browser participant joining session...');
    await browserParticipant.page.fill(selectors.home.roomCodeInput, sessionId);
    await browserParticipant.page.click(selectors.home.joinRoomButton);

    // Wait for browser participant to reach session page
    await browserParticipant.page.waitForSelector(selectors.session.participantList, {
      timeout: 30000,
    });

    // ==========================================
    // STEP 6: Wait for P2P connection
    // ==========================================
    console.log('[E2E] Waiting for P2P connection (this may take up to 90s)...');

    const maxWaitTime = 90000;
    const pollInterval = 5000;
    const startTime = Date.now();

    let hostSeesPeer = false;
    let participantSeesHost = false;

    while (Date.now() - startTime < maxWaitTime && (!hostSeesPeer || !participantSeesHost)) {
      await sleep(pollInterval);

      const hostTileCount = await host.page.locator('[role="listitem"]').count();
      const participantTileCount = await browserParticipant.page.locator('[role="listitem"]').count();

      console.log(`[E2E] Host tiles: ${hostTileCount}, Browser participant tiles: ${participantTileCount}`);

      // When connected, each should see 2 tiles (self + peer)
      if (!hostSeesPeer && hostTileCount >= 2) {
        hostSeesPeer = true;
        console.log('[E2E] Host sees browser participant!');
      }

      if (!participantSeesHost && participantTileCount >= 2) {
        participantSeesHost = true;
        console.log('[E2E] Browser participant sees host!');
      }
    }

    if (!hostSeesPeer || !participantSeesHost) {
      // Take screenshots for debugging
      await host.page.screenshot({ path: 'e2e/test-results/cross-platform-host-timeout.png' });
      await browserParticipant.page.screenshot({
        path: 'e2e/test-results/cross-platform-browser-timeout.png',
      });
      throw new Error(
        `P2P connection timeout after ${maxWaitTime}ms. Host sees peer: ${hostSeesPeer}, Browser sees host: ${participantSeesHost}`
      );
    }

    console.log('[E2E] P2P connection established between Electron and browser!');

    // ==========================================
    // STEP 7: Both peers start screen share
    // ==========================================
    console.log('[E2E] Starting screen share on both peers...');

    // Host starts screen share (Electron - uses screen picker)
    await host.page.click(selectors.session.screenShareButton);
    await host.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    console.log('[E2E] Host screen source picker appeared');
    await host.page.click('[role="dialog"] button.bg-blue-600');
    await waitForLocalScreenShare(host.page, 10000);
    console.log('[E2E] Host screen share started');

    // Browser participant starts screen share (browser - uses getDisplayMedia directly, auto-mocked)
    await browserParticipant.page.click(selectors.session.screenShareButton);

    // Browser doesn't have a screen picker (mocked getDisplayMedia returns immediately)
    // Wait for screen share to be set
    await waitForLocalScreenShare(browserParticipant.page, 10000);
    console.log('[E2E] Browser participant screen share started');

    // ==========================================
    // STEP 8: Verify screen share badges
    // ==========================================
    console.log('[E2E] Verifying screen share badges...');

    // Host should see their own screen share badge
    await host.page.waitForSelector(
      '[role="button"][aria-label*="You"][aria-label*="sharing screen"]',
      { timeout: 10000 }
    );
    console.log('[E2E] Host sees their own screen share badge');

    // Host should see browser participant's screen share badge
    await waitForPeerScreenShareBadge(host.page, 'Browser User', 30000);
    console.log('[E2E] Host sees browser participant screen share badge');

    // Browser participant should see their own screen share badge
    await browserParticipant.page.waitForSelector(
      '[role="button"][aria-label*="You"][aria-label*="sharing screen"]',
      { timeout: 10000 }
    );
    console.log('[E2E] Browser participant sees their own screen share badge');

    // Browser participant should see host's screen share badge
    await waitForPeerScreenShareBadge(browserParticipant.page, 'Host User', 30000);
    console.log('[E2E] Browser participant sees host screen share badge');

    console.log('[E2E] Screen share badges verified');

    // ==========================================
    // STEP 9: Start recording (host only)
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    console.log('[E2E] Waiting for countdown...');
    await host.page.waitForSelector('button[aria-label="Starting..."]', { timeout: 5000 }).catch(() => {
      // Countdown may have already finished
    });

    // Wait for recording to start on host
    await expect(host.page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    console.log('[E2E] Host is recording');

    // Browser participant should have isRecording=true in their store (via P2P)
    await browserParticipant.page.waitForFunction(
      () => {
        const win = window as unknown as Record<string, { getState?: () => { isRecording?: boolean } }>;
        return win.useRecordingStore?.getState?.()?.isRecording === true;
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Browser participant received recording state via P2P');

    // ==========================================
    // STEP 10: Record for 5 seconds
    // ==========================================
    console.log('[E2E] Recording for 5 seconds...');
    await sleep(5000);

    // ==========================================
    // STEP 11: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete on both
    await waitForRecordingComplete(host.page, 30000);
    await waitForRecordingComplete(browserParticipant.page, 30000);
    console.log('[E2E] Recording stopped');

    // ==========================================
    // STEP 12: Wait for file transfer from browser to host
    // ==========================================
    console.log('[E2E] Waiting for file transfer from browser participant to host...');

    // Host should receive at least 1 recording from browser participant
    await waitForReceivedRecordings(host.page, 1, 60000);
    console.log('[E2E] File transfer complete');

    // ==========================================
    // STEP 13: Verify NLE Editor opens
    // ==========================================
    console.log('[E2E] Waiting for NLE Editor to open...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE Editor loaded');

    // ==========================================
    // STEP 14: Wait for any pending transfers
    // ==========================================
    const hasTransfers = await host.page
      .locator(selectors.nle.transfersInProgress)
      .isVisible()
      .catch(() => false);
    if (hasTransfers) {
      console.log('[E2E] Waiting for transfers to complete...');
      await host.page.waitForSelector(selectors.nle.transfersInProgress, {
        state: 'hidden',
        timeout: 60000,
      });
    }

    console.log('[E2E] Cross-platform test completed successfully!');
    console.log('[E2E] Verified: Electron host + Browser participant P2P connection, recording, and file transfer');
  });
});
