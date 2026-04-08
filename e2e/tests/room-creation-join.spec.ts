import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession, waitForP2PConnection } from '../helpers/test-setup';
import { sleep } from '../helpers/wait-helpers';

test.describe('Room Creation and Join Validation', () => {
  let host: AppInstance;
  let participant: AppInstance;

  test.afterEach(async () => {
    if (participant) {
      await closeApp(participant);
    }
    if (host) {
      await closeApp(host);
    }
  });

  test('profile setup requires both display name and full name', async () => {
    console.log('[E2E] Launching app instance...');
    host = await launchApp('host');

    // Wait for profile setup screen
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    console.log('[E2E] Profile setup screen visible');

    // Continue button should be disabled when both fields are empty
    const continueButton = host.page.locator('button:has-text("Continue")');
    await expect(continueButton).toBeDisabled();
    console.log('[E2E] Continue button is disabled with empty fields');

    // Fill only display name - Continue should still be disabled
    await host.page.fill('#display-name', 'TestUser');
    await expect(continueButton).toBeDisabled();
    console.log('[E2E] Continue button still disabled with only display name');

    // Clear display name, fill only full name - Continue should still be disabled
    await host.page.fill('#display-name', '');
    await host.page.fill('#full-name', 'Test Full Name');
    await expect(continueButton).toBeDisabled();
    console.log('[E2E] Continue button still disabled with only full name');

    // Fill both required fields - Continue should now be enabled
    await host.page.fill('#display-name', 'TestUser');
    await expect(continueButton).toBeEnabled();
    console.log('[E2E] Continue button enabled with both fields filled');

    // Fill in optional subtitle field and verify button is still enabled
    await host.page.fill('#subtitle', 'Engineer');
    await expect(continueButton).toBeEnabled();
    console.log('[E2E] Continue button remains enabled with subtitle');

    // Submit profile
    await continueButton.click();

    // Should navigate to home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    console.log('[E2E] Navigated to home page after profile setup');

    // Verify profile was persisted by checking the user store
    const profile = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { profile?: { displayName: string; fullName: string; subtitle: string } } }
        >
      ).useUserStore;
      return store?.getState?.()?.profile ?? null;
    });

    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('TestUser');
    expect(profile!.fullName).toBe('Test Full Name');
    expect(profile!.subtitle).toBe('Engineer');
    console.log('[E2E] Profile stored correctly in user store');

    console.log('[E2E] Profile setup validation test passed!');
  });

  test('join button is disabled with empty room code', async () => {
    console.log('[E2E] Launching app instance...');
    host = await launchApp('host');

    // Setup profile first
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    console.log('[E2E] Profile setup complete');

    // Verify on home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Room code input should be empty (fresh instance with no last session)
    const roomCodeInput = host.page.locator(selectors.home.roomCodeInput);
    const inputValue = await roomCodeInput.inputValue();
    console.log('[E2E] Initial room code value:', JSON.stringify(inputValue));

    // Join button should be disabled when room code is empty
    // The button text matches "Join Room" or "Rejoin Room"
    const joinButton = host.page.locator(selectors.home.joinRoomButton);
    await expect(joinButton).toBeDisabled();
    console.log('[E2E] Join button is disabled with empty room code');

    // Type only spaces - Join should still be disabled
    await roomCodeInput.fill('   ');
    await expect(joinButton).toBeDisabled();
    console.log('[E2E] Join button still disabled with whitespace-only room code');

    // Type a valid room code - Join should become enabled
    await roomCodeInput.fill('test-room-code');
    await expect(joinButton).toBeEnabled();
    console.log('[E2E] Join button enabled with room code entered');

    // Clear room code - Join should become disabled again
    await roomCodeInput.fill('');
    await expect(joinButton).toBeDisabled();
    console.log('[E2E] Join button disabled again after clearing room code');

    console.log('[E2E] Join button validation test passed!');
  });

  test('create room navigates to session page with valid session ID', async () => {
    console.log('[E2E] Launching app instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try { await dialog.accept(); } catch { /* ignore */ }
    });

    // Setup profile
    await setupProfile(host.page, 'Host Creator', 'Host Creator Full');

    // Verify Create Room button is visible and enabled
    const createButton = host.page.locator(selectors.home.createRoomButton);
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await expect(createButton).toBeEnabled();
    console.log('[E2E] Create Room button visible and enabled');

    // Click Create Room
    console.log('[E2E] Clicking Create Room...');
    await createButton.click();

    // Should navigate to session page with record button visible
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
    console.log('[E2E] Session page loaded with record button visible');

    // Verify URL contains /session/ with a generated session ID
    const url = host.page.url();
    expect(url).toContain('/session/');
    const sessionIdMatch = url.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = decodeURIComponent(sessionIdMatch![1]);
    console.log('[E2E] Session created with ID:', sessionId);

    // Session ID should contain password delimiter format (roomId?p=password)
    expect(sessionId).toContain('?p=');
    console.log('[E2E] Session ID includes password component');

    // Verify session store shows connected and host role
    const sessionState = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { isConnected?: boolean; isHost?: boolean } }
        >
      ).useSessionStore;
      const state = store?.getState?.();
      return {
        isConnected: state?.isConnected ?? false,
        isHost: state?.isHost ?? false,
      };
    });

    expect(sessionState.isConnected).toBe(true);
    expect(sessionState.isHost).toBe(true);
    console.log('[E2E] Session store confirms connected as host');

    // Verify connection status shows Connected
    const connectionStatus = host.page.locator(selectors.session.connectionStatus);
    await expect(connectionStatus).toBeVisible({ timeout: 30000 });
    await expect(connectionStatus).toContainText('Connected', { timeout: 30000 });
    console.log('[E2E] Connection status shows Connected');

    // Verify local tile is visible (self tile)
    const localTile = host.page.locator(selectors.session.localTile);
    await expect(localTile).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Local (You) tile is visible');

    console.log('[E2E] Create room test passed!');
  });

  test('participant can join session created by host using room code', async () => {
    console.log('[E2E] Launching host and participant instances...');
    host = await launchApp('host');
    participant = await launchApp('participant');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try { await dialog.accept(); } catch { /* ignore */ }
    });
    participant.page.on('dialog', async (dialog) => {
      try { await dialog.accept(); } catch { /* ignore */ }
    });

    // Setup profiles
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Joiner', 'Joiner Full Name');

    // Host creates session
    const sessionId = await createSession(host.page);
    console.log('[E2E] Host created session:', sessionId);

    // Participant fills in the room code input
    const roomCodeInput = participant.page.locator(selectors.home.roomCodeInput);
    await roomCodeInput.fill(sessionId);
    console.log('[E2E] Participant entered room code');

    // Verify join button is now enabled
    const joinButton = participant.page.locator(selectors.home.joinRoomButton);
    await expect(joinButton).toBeEnabled();

    // Click Join Room
    await joinButton.click();
    console.log('[E2E] Participant clicked Join Room');

    // Participant should navigate to session page
    await participant.page.waitForSelector(selectors.session.participantList, { timeout: 30000 });
    console.log('[E2E] Participant reached session page');

    // Verify participant session store shows connected and NOT host
    const participantState = await participant.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { isConnected?: boolean; isHost?: boolean } }
        >
      ).useSessionStore;
      const state = store?.getState?.();
      return {
        isConnected: state?.isConnected ?? false,
        isHost: state?.isHost ?? false,
      };
    });

    expect(participantState.isConnected).toBe(true);
    expect(participantState.isHost).toBe(false);
    console.log('[E2E] Participant connected as non-host');

    // Wait for P2P connection between host and participant
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Host should see participant's tile
    const hostPeerTile = host.page.locator(selectors.session.peerTileByName('Joiner'));
    await expect(hostPeerTile).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Host sees participant tile labeled "Joiner"');

    // Participant should see host tile
    const participantHostTile = participant.page.locator(selectors.session.peerTileByName('Host User'));
    await expect(participantHostTile).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Participant sees host tile labeled "Host User"');

    console.log('[E2E] Join session test passed!');
  });

  test('last session is remembered and shows Rejoin Room button', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try { await dialog.accept(); } catch { /* ignore */ }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Leave the session
    const leaveButton = host.page.locator(selectors.session.leaveButton);
    await expect(leaveButton).toBeVisible({ timeout: 5000 });
    await leaveButton.click();

    // Wait for home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    console.log('[E2E] Returned to home page');

    // Room code input should be pre-filled with the last session's room code
    const roomCodeInput = host.page.locator(selectors.home.roomCodeInput);
    const inputValue = await roomCodeInput.inputValue();
    expect(inputValue).toBe(sessionId);
    console.log('[E2E] Room code input pre-filled with last session ID');

    // The join button should show "Rejoin Room" since this was the last session and user was host
    const rejoinButton = host.page.locator('button:has-text("Rejoin Room")');
    await expect(rejoinButton).toBeVisible({ timeout: 5000 });
    await expect(rejoinButton).toBeEnabled();
    console.log('[E2E] Rejoin Room button is visible and enabled');

    // Change room code to something different - button text should change to "Join Room"
    await roomCodeInput.fill('different-room-code');
    await sleep(500); // Wait for React state update
    const joinButton = host.page.locator('button:has-text("Join Room")');
    await expect(joinButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Button text changed to "Join Room" with different room code');

    // Change back to original session ID - button should show "Rejoin Room" again
    await roomCodeInput.fill(sessionId);
    await sleep(500);
    await expect(rejoinButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Button text back to "Rejoin Room" with original room code');

    console.log('[E2E] Last session remembered test passed!');
  });

  test('room code input accepts pasted URLs and extracts room code', async () => {
    console.log('[E2E] Launching app instance...');
    host = await launchApp('host');

    // Setup profile
    await setupProfile(host.page, 'Host User', 'Host Full Name');

    const roomCodeInput = host.page.locator(selectors.home.roomCodeInput);

    // Paste a full URL - should extract room code
    const testUrl = 'https://dsmmcken.github.io/vdo-samurai/?room=test-room&p=abc123';
    await roomCodeInput.fill(testUrl);

    // The parseRoomInput function should extract the room code from URL
    const extractedValue = await roomCodeInput.inputValue();
    expect(extractedValue).toBe('test-room?p=abc123');
    console.log('[E2E] URL pasted and room code extracted:', extractedValue);

    // Join button should be enabled with the extracted room code
    const joinButton = host.page.locator(selectors.home.joinRoomButton);
    await expect(joinButton).toBeEnabled();
    console.log('[E2E] Join button enabled after URL paste');

    // Clear and enter a plain room code
    await roomCodeInput.fill('');
    await roomCodeInput.fill('simple-room?p=password123');
    const plainValue = await roomCodeInput.inputValue();
    expect(plainValue).toBe('simple-room?p=password123');
    console.log('[E2E] Plain room code entered correctly');

    console.log('[E2E] URL parsing test passed!');
  });
});
