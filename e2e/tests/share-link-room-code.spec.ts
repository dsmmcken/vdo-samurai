import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession } from '../helpers/test-setup';

test.describe('Share Link and Room Code Display', () => {
  let host: AppInstance;

  test.afterEach(async () => {
    if (host) {
      await closeApp(host);
    }
  });

  test('share link button is visible and shows copied feedback on click', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Verify the Share Link button is visible in the title bar
    const shareLinkButton = host.page.locator(selectors.session.shareLinkButton);
    await expect(shareLinkButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Share Link button is visible');

    // Verify it shows "Share Link" text initially
    await expect(shareLinkButton).toContainText('Share Link');
    console.log('[E2E] Share Link button shows correct initial text');

    // Verify data-copied is false initially
    await expect(shareLinkButton).toHaveAttribute('data-copied', 'false');
    console.log('[E2E] Share Link data-copied is false initially');

    // Click the Share Link button to copy the link
    await shareLinkButton.click();
    console.log('[E2E] Clicked Share Link button');

    // Verify the button text changes to "Copied!" and data-copied becomes true
    await expect(shareLinkButton).toContainText('Copied!', { timeout: 5000 });
    await expect(shareLinkButton).toHaveAttribute('data-copied', 'true');
    console.log('[E2E] Share Link shows "Copied!" feedback');

    // Wait for the feedback to reset (2 seconds timeout in component)
    await expect(shareLinkButton).toContainText('Share Link', { timeout: 5000 });
    await expect(shareLinkButton).toHaveAttribute('data-copied', 'false');
    console.log('[E2E] Share Link reverted to default text after timeout');

    console.log('[E2E] Share link button visibility and feedback test passed!');
  });

  test('connection status shows Connected and displays session info in popover', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Verify connection status button is visible and shows "Connected"
    const connectionStatus = host.page.locator(selectors.session.connectionStatus);
    await expect(connectionStatus).toBeVisible({ timeout: 30000 });
    await expect(connectionStatus).toContainText('Connected', { timeout: 30000 });
    console.log('[E2E] Connection status shows "Connected"');

    // Click the connection status to open the popover
    await connectionStatus.click();
    console.log('[E2E] Clicked connection status button');

    // Verify the popover shows session info
    // The popover contains h4 "Session" and a code element with the session ID (roomId part)
    const sessionHeading = host.page.locator('h4:has-text("Session")');
    await expect(sessionHeading).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Session heading visible in popover');

    // Verify the session ID is displayed in the popover code block
    // The sessionId in the store is just the roomId (without password)
    // Extract the roomId from the full sessionId (format: roomId?p=password)
    const roomId = sessionId.split('?p=')[0];
    const sessionCodeElement = host.page.locator('code').filter({ hasText: roomId });
    await expect(sessionCodeElement).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Session ID (room ID) displayed in popover:', roomId);

    // Verify network status shows "Online"
    const networkHeading = host.page.locator('h4:has-text("Network")');
    await expect(networkHeading).toBeVisible({ timeout: 5000 });
    const onlineText = host.page.locator('text=Online');
    await expect(onlineText).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Network status shows "Online"');

    // Verify "No peers connected" message when solo
    const noPeersText = host.page.locator('text=No peers connected');
    await expect(noPeersText).toBeVisible({ timeout: 5000 });
    console.log('[E2E] "No peers connected" shown for solo host');

    // Close the popover by clicking elsewhere
    await host.page.click('body', { position: { x: 10, y: 200 } });
    console.log('[E2E] Closed connection status popover');

    console.log('[E2E] Connection status and session info popover test passed!');
  });

  test('session controls are present in title bar during active session', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await createSession(host.page);
    console.log('[E2E] Session created');

    // Verify all session controls are visible in the title bar:
    // 1. Share Link button
    const shareLinkButton = host.page.locator(selectors.session.shareLinkButton);
    await expect(shareLinkButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Share Link button visible');

    // 2. Connection status
    const connectionStatus = host.page.locator(selectors.session.connectionStatus);
    await expect(connectionStatus).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Connection status visible');

    // 3. Leave session button
    const leaveButton = host.page.locator(selectors.session.leaveButton);
    await expect(leaveButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Leave session button visible');

    // 4. User menu button
    const userMenu = host.page.locator('button[aria-label="User menu"]');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    // Verify user initials are shown (HU for "Host User")
    await expect(userMenu).toContainText('HU');
    console.log('[E2E] User menu button visible with initials "HU"');

    // 5. Record button (host-only control)
    const recordButton = host.page.locator(selectors.session.recordButton);
    await expect(recordButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Record button visible for host');

    // Verify session store state matches expected values
    const sessionState = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              isConnected?: boolean;
              isHost?: boolean;
              sessionId?: string | null;
              sessionPassword?: string | null;
            };
          }
        >
      ).useSessionStore;
      const state = store?.getState?.();
      return {
        isConnected: state?.isConnected ?? false,
        isHost: state?.isHost ?? false,
        hasSessionId: !!state?.sessionId,
        hasSessionPassword: !!state?.sessionPassword,
      };
    });

    expect(sessionState.isConnected).toBe(true);
    expect(sessionState.isHost).toBe(true);
    expect(sessionState.hasSessionId).toBe(true);
    expect(sessionState.hasSessionPassword).toBe(true);
    console.log('[E2E] Session store confirms: connected, host, sessionId and password present');

    console.log('[E2E] Session controls presence test passed!');
  });

  test('room code format includes verb-adjective-noun pattern with password', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created with ID:', sessionId);

    // Verify the room code format: verb-adjective-noun-hexId?p=password
    // The ?p= delimiter separates room ID from password
    expect(sessionId).toContain('?p=');
    const [roomId, password] = sessionId.split('?p=');
    console.log('[E2E] Room ID:', roomId);
    console.log('[E2E] Password:', password);

    // Room ID should have format: verb-adjective-noun-hexId (4 hyphen-separated parts)
    const roomParts = roomId.split('-');
    expect(roomParts.length).toBeGreaterThanOrEqual(4);
    console.log('[E2E] Room ID has', roomParts.length, 'parts:', roomParts);

    // Password should be 12 characters alphanumeric
    expect(password.length).toBe(12);
    expect(password).toMatch(/^[a-z0-9]+$/);
    console.log('[E2E] Password is 12 chars alphanumeric');

    // Verify the URL contains the encoded session ID
    const url = host.page.url();
    expect(url).toContain('/session/');
    // URL-encoded version of the session ID should be in the URL
    expect(url).toContain(encodeURIComponent(roomId));
    console.log('[E2E] URL contains encoded room ID');

    console.log('[E2E] Room code format validation test passed!');
  });
});
