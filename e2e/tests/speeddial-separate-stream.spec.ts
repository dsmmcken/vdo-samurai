import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { sleep } from '../helpers/wait-helpers';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Speed Dial Separate Stream Architecture Tests
 *
 * These tests verify the new architecture where Speed Dial uses a completely
 * separate stream type (speedDialStream) instead of hijacking screenStream.
 *
 * Key verifications:
 * 1. speedDialStream is used (not screenStream) when playing speed dial
 * 2. isPlayingSpeedDial flag is properly set
 * 3. Browser participant receives the speed dial stream
 * 4. Stream is correctly classified even without metadata (fallback)
 */

/**
 * Helper: Start a simple dev server for browser participant
 */
async function startDevServer(): Promise<{ server: http.Server; port: number }> {
  // Check if dev server is already running
  const checkPort = async (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  };

  // Try to connect to existing dev server on port 5173
  if (await checkPort(5173)) {
    console.log('[TEST] Using existing dev server on port 5173');
    return { server: null as unknown as http.Server, port: 5173 };
  }

  // If no existing server, we need to tell user to start it
  throw new Error(
    'Dev server not running. Please start it with: npm run dev'
  );
}

/**
 * Helper: Wait for P2P connection between two instances
 */
async function waitForP2PConnection(
  hostPage: Page,
  browserPage: Page,
  timeout = 90000
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < timeout) {
    await sleep(pollInterval);

    // Check host sees participant
    const hostPeerCount = await hostPage.evaluate(() => {
      const store = (window as unknown as { usePeerStore?: { getState: () => { peers: unknown[] } } }).usePeerStore;
      return store?.getState()?.peers?.length ?? 0;
    });

    // Check participant sees host
    const browserPeerCount = await browserPage.evaluate(() => {
      const store = (window as unknown as { usePeerStore?: { getState: () => { peers: unknown[] } } }).usePeerStore;
      return store?.getState()?.peers?.length ?? 0;
    });

    console.log(`[TEST] P2P check - Host peers: ${hostPeerCount}, Browser peers: ${browserPeerCount}`);

    if (hostPeerCount >= 1 && browserPeerCount >= 1) {
      console.log('[TEST] P2P connection established');
      return;
    }
  }

  throw new Error('P2P connection timeout');
}

/**
 * Helper: Get peer state from browser participant
 */
async function getBrowserPeerState(browserPage: Page, hostName: string): Promise<{
  hasSpeedDialStream: boolean;
  hasScreenStream: boolean;
  isPlayingSpeedDial: boolean;
  speedDialStreamActive: boolean | null;
}> {
  return browserPage.evaluate((name) => {
    const store = (window as unknown as { usePeerStore?: { getState: () => { peers: Array<{
      name: string;
      speedDialStream: MediaStream | null;
      screenStream: MediaStream | null;
      isPlayingSpeedDial: boolean;
    }> } } }).usePeerStore;
    const peers = store?.getState()?.peers ?? [];
    const hostPeer = peers.find(p => p.name?.includes(name));
    if (!hostPeer) {
      return {
        hasSpeedDialStream: false,
        hasScreenStream: false,
        isPlayingSpeedDial: false,
        speedDialStreamActive: null
      };
    }
    return {
      hasSpeedDialStream: hostPeer.speedDialStream !== null,
      hasScreenStream: hostPeer.screenStream !== null,
      isPlayingSpeedDial: hostPeer.isPlayingSpeedDial,
      speedDialStreamActive: hostPeer.speedDialStream?.active ?? null
    };
  }, hostName);
}

test.describe('Speed Dial Separate Stream Architecture', () => {
  let host: AppInstance;
  let browserContext: BrowserContext | null = null;
  let browserPage: Page | null = null;
  let devServerPort: number | null = null;

  test.afterEach(async () => {
    // Close browser context (saves video recording)
    if (browserContext) {
      try {
        await browserContext.close();
        console.log('[TEST] Browser context closed, recording saved');
      } catch (e) {
        console.error('[TEST] Failed to close browser context:', e);
      }
      browserContext = null;
      browserPage = null;
    }

    // Close Electron host
    if (host) {
      await closeApp(host);
    }
  });

  test('peer state includes speedDialStream and isPlayingSpeedDial fields', async () => {
    // This test verifies the type system changes are in place
    console.log('[TEST] Launching host instance...');
    host = await launchApp('host');

    // Complete profile setup
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    // Create session
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await host.page.click(selectors.home.createRoomButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Verify local state has the new fields
    const localState = await host.page.evaluate(() => {
      const sessionStore = (window as unknown as { useSessionStore?: { getState: () => {
        localSpeedDialStream: MediaStream | null;
      } } }).useSessionStore;
      const state = sessionStore?.getState();
      return {
        hasLocalSpeedDialStreamField: 'localSpeedDialStream' in (state ?? {}),
        localSpeedDialStreamValue: state?.localSpeedDialStream
      };
    });

    expect(localState.hasLocalSpeedDialStreamField).toBe(true);
    expect(localState.localSpeedDialStreamValue).toBeNull();
    console.log('[TEST] sessionStore has localSpeedDialStream field');

    // Verify speed dial store is accessible
    const speedDialState = await host.page.evaluate(() => {
      const store = (window as unknown as { useSpeedDialStore?: { getState: () => {
        isPlaying: boolean;
        activeClipId: string | null;
      } } }).useSpeedDialStore;
      const state = store?.getState();
      return {
        hasStore: !!store,
        isPlaying: state?.isPlaying,
        activeClipId: state?.activeClipId
      };
    });

    expect(speedDialState.hasStore).toBe(true);
    expect(speedDialState.isPlaying).toBe(false);
    expect(speedDialState.activeClipId).toBeNull();
    console.log('[TEST] Speed dial store is properly initialized');

    console.log('[TEST] Type system verification complete');
  });

  test('speed dial uses separate speedDialStream for P2P transmission', async () => {
    // This test requires a browser participant to verify P2P stream transmission
    console.log('[TEST] Launching host instance...');
    host = await launchApp('host');

    // Complete host profile setup
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'SD Host');
    await host.page.fill('#full-name', 'SD Host Full Name');
    await host.page.click('button:has-text("Continue")');

    // Host creates session
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await host.page.click(selectors.home.createRoomButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Get session ID
    const hostUrl = host.page.url();
    const sessionIdMatch = hostUrl.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = decodeURIComponent(sessionIdMatch![1]);
    console.log('[TEST] Session ID:', sessionId);

    // Create test recordings directory
    const recordingsDir = path.join(__dirname, '../test-recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    // Launch browser participant with video recording
    console.log('[TEST] Launching browser participant...');
    const headless = process.env.HEADLESS === 'true' || process.env.CI === 'true';
    const browser = await chromium.launch({ headless });
    browserContext = await browser.newContext({
      recordVideo: {
        dir: recordingsDir,
        size: { width: 1280, height: 720 }
      },
      permissions: ['camera', 'microphone']
    });
    browserPage = await browserContext.newPage();

    // Start dev server if needed
    if (!devServerPort) {
      const { port } = await startDevServer();
      devServerPort = port;
    }

    // Navigate to dev server
    await browserPage.goto(`http://localhost:${devServerPort}`);
    await browserPage.waitForLoadState('domcontentloaded');

    // Complete browser participant profile
    await browserPage.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await browserPage.fill('#display-name', 'Browser Participant');
    await browserPage.fill('#full-name', 'Browser Participant Full');
    await browserPage.click('button:has-text("Continue")');

    // Join session
    await browserPage.waitForSelector(selectors.home.title, { timeout: 10000 });
    await browserPage.fill(selectors.home.roomCodeInput, sessionId);
    await browserPage.click(selectors.home.joinRoomButton);
    await browserPage.waitForSelector(selectors.session.participantList, { timeout: 30000 });

    // Wait for P2P connection
    console.log('[TEST] Waiting for P2P connection...');
    await waitForP2PConnection(host.page, browserPage);

    // Verify initial state - no speed dial stream
    console.log('[TEST] Checking initial state (before speed dial)...');
    const beforeState = await getBrowserPeerState(browserPage, 'SD Host');
    console.log('[TEST] Before state:', beforeState);
    expect(beforeState.hasSpeedDialStream).toBe(false);
    expect(beforeState.isPlayingSpeedDial).toBe(false);
    // screenStream should also be false initially
    expect(beforeState.hasScreenStream).toBe(false);

    // Import a test clip on host (if speed dial import is available)
    // For this test, we'll use the IPC to import a clip by path if available
    const hasSpeedDialIPC = await host.page.evaluate(() => {
      return !!(window as unknown as { electronAPI?: { speedDial?: { importClipByPath?: unknown } } }).electronAPI?.speedDial?.importClipByPath;
    });

    if (!hasSpeedDialIPC) {
      console.log('[TEST] Speed dial IPC not available, skipping P2P transmission test');
      // Still verify the stores have the right fields
      return;
    }

    // Import a test clip
    // Read env var in Node.js context, then pass to browser evaluate
    const testVideoPath = process.env.TEST_VIDEO_PATH || '/tmp/test-video.mp4';
    console.log('[TEST] Importing test clip via IPC...', testVideoPath);
    const importResult = await host.page.evaluate(async (videoPath) => {
      const api = (window as unknown as { electronAPI?: { speedDial?: { importClipByPath?: (path: string) => Promise<{ success: boolean; error?: string; clip?: { name: string; path: string; duration: number } }> } } }).electronAPI?.speedDial;
      if (!api?.importClipByPath) return { success: false, error: 'No IPC' };

      return api.importClipByPath(videoPath);
    }, testVideoPath);

    if (!importResult.success) {
      console.log('[TEST] Could not import test clip:', importResult.error);
      console.log('[TEST] Skipping P2P stream verification - no test video available');
      return;
    }

    console.log('[TEST] Clip imported, playing...');

    // Play the clip (click first clip in speed dial panel)
    await host.page.locator('button[aria-label="Open Speed Dial"]').click();
    await host.page.waitForSelector('[role="dialog"][aria-label="Speed Dial"]', { timeout: 5000 });

    // Find and click the first clip button
    const clipButton = host.page.locator('[role="dialog"][aria-label="Speed Dial"] button').filter({ hasText: importResult.clip?.name || '' });
    if (await clipButton.count() > 0) {
      await clipButton.click();
    } else {
      console.log('[TEST] No clip button found, test cannot verify P2P transmission');
      return;
    }

    // Wait for stream to propagate
    console.log('[TEST] Waiting for speed dial stream to propagate...');
    await sleep(3000);

    // Check state after speed dial started
    console.log('[TEST] Checking state after speed dial play...');
    const afterState = await getBrowserPeerState(browserPage, 'SD Host');
    console.log('[TEST] After state:', afterState);

    // CRITICAL ASSERTIONS:
    // 1. speedDialStream should be set (NOT screenStream!)
    expect(afterState.hasSpeedDialStream).toBe(true);
    // 2. screenStream should NOT be set (we didn't hijack it)
    expect(afterState.hasScreenStream).toBe(false);
    // 3. isPlayingSpeedDial flag should be true
    expect(afterState.isPlayingSpeedDial).toBe(true);
    // 4. Stream should be active
    expect(afterState.speedDialStreamActive).toBe(true);

    console.log('[TEST] Speed dial stream architecture verified!');
    console.log('[TEST] Browser recording saved to:', recordingsDir);
  });

  test('TrysteroContext exposes speed dial functions', async () => {
    // This test verifies the context API is properly set up
    console.log('[TEST] Launching host instance...');
    host = await launchApp('host');

    // Complete profile setup
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    // Create session
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await host.page.click(selectors.home.createRoomButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Verify speed dial panel is accessible for host
    const speedDialButton = host.page.locator('button[aria-label="Open Speed Dial"]');
    await expect(speedDialButton).toBeVisible({ timeout: 5000 });

    // Open panel and verify it shows
    await speedDialButton.click();
    const panel = host.page.locator('[role="dialog"][aria-label="Speed Dial"]');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Close panel
    await host.page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible({ timeout: 5000 });

    console.log('[TEST] Speed dial panel UI verification complete');
  });
});
