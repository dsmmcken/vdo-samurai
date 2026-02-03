/**
 * Browser participant fixture for cross-platform E2E tests
 * Launches a Chromium browser with mocked media APIs
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getBrowserMediaMockScript } from './browser-media-mock';

export interface BrowserParticipant {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  instanceId: string;
}

export interface LaunchBrowserParticipantOptions {
  /** Base URL of the test server */
  testServerBaseUrl: string;
  /** Whether to run headless (default: based on HEADLESS env) */
  headless?: boolean;
}

/**
 * Launch a browser participant instance with mocked media
 */
export async function launchBrowserParticipant(
  instanceId: string,
  options: LaunchBrowserParticipantOptions
): Promise<BrowserParticipant> {
  const { testServerBaseUrl } = options;
  const headless = options.headless ??
    (process.env.HEADLESS === 'true' || process.env.CI === 'true');

  console.log(`[BrowserParticipant] Launching ${instanceId} (headless: ${headless})`);

  // Launch Chromium with fake media device flags
  const browser = await chromium.launch({
    headless,
    args: [
      // Use fake UI for media stream (auto-accept permissions)
      '--use-fake-ui-for-media-stream',
      // Use fake device for media stream
      '--use-fake-device-for-media-stream',
      // Disable GPU to avoid issues in headless mode
      '--disable-gpu',
      // Allow autoplay
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  // Create context with permissions granted
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    // Set a reasonable viewport
    viewport: { width: 1280, height: 720 },
    // Ignore HTTPS errors for local test server
    ignoreHTTPSErrors: true,
  });

  // Get the media mock script
  const mockScript = getBrowserMediaMockScript(testServerBaseUrl);

  // Add the mock script to run on every page navigation
  await context.addInitScript(mockScript);

  // Create a new page
  const page = await context.newPage();

  // Enable console logging for debugging
  page.on('console', (msg) => {
    const text = msg.text();
    // Only log mock-related messages to reduce noise
    if (text.includes('[BROWSER-MOCK]')) {
      console.log(`[BrowserParticipant:${instanceId}] ${text}`);
    }
  });

  // Navigate to the app
  const appUrl = `${testServerBaseUrl}/vdo-samurai/`;
  console.log(`[BrowserParticipant] Navigating to: ${appUrl}`);
  await page.goto(appUrl);

  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');

  // Wait for media mock to be ready
  await page.waitForFunction(
    () => (window as unknown as { __MEDIA_MOCKED__?: boolean }).__MEDIA_MOCKED__ === true,
    undefined,
    { timeout: 10000 }
  );

  console.log(`[BrowserParticipant] ${instanceId} ready`);

  return {
    browser,
    context,
    page,
    instanceId,
  };
}

/**
 * Close a browser participant instance with timeout and force kill
 */
export async function closeBrowserParticipant(participant: BrowserParticipant): Promise<void> {
  console.log(`[BrowserParticipant] Closing ${participant.instanceId}`);

  // Helper to wrap operations with a timeout
  const withTimeout = <T>(promise: Promise<T>, ms: number, name: string): Promise<{ result: T; timedOut: false } | { timedOut: true }> => {
    return Promise.race([
      promise.then((result) => ({ result, timedOut: false as const })),
      new Promise<{ timedOut: true }>((resolve) => {
        setTimeout(() => {
          console.warn(`[BrowserParticipant] ${name} timed out after ${ms}ms, will force kill`);
          resolve({ timedOut: true });
        }, ms);
      }),
    ]);
  };

  try {
    // Set up dialog handler to auto-accept any dialogs during close
    participant.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be dismissed
      }
    });

    // Try to close context first (this also closes pages)
    const contextResult = await withTimeout(participant.context.close(), 3000, 'context.close');

    // Try to close browser
    const browserResult = await withTimeout(participant.browser.close(), 3000, 'browser.close');

    // If either timed out, force kill the browser process
    if (contextResult.timedOut || browserResult.timedOut) {
      console.log(`[BrowserParticipant] Force killing browser process for ${participant.instanceId}`);
      try {
        // Get the browser process and kill it
        const browserProcess = participant.browser.process();
        if (browserProcess && !browserProcess.killed) {
          browserProcess.kill('SIGKILL');
        }
      } catch (killError) {
        console.warn(`[BrowserParticipant] Could not force kill: ${killError}`);
      }
    }

    console.log(`[BrowserParticipant] ${participant.instanceId} closed`);
  } catch (e) {
    console.error(`[BrowserParticipant] Failed to close ${participant.instanceId}:`, e);
    // Try to force kill on any error
    try {
      const browserProcess = participant.browser.process();
      if (browserProcess && !browserProcess.killed) {
        browserProcess.kill('SIGKILL');
      }
    } catch {
      // Ignore kill errors
    }
  }
}
