import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection
} from '../helpers/test-setup';
import { sleep, waitForRecordingStart, waitForRecordingComplete } from '../helpers/wait-helpers';

test.describe('Leave Session and Return to Home', () => {
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

  test('host can leave session and return to home page', async () => {
    // Launch host
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs (beforeunload)
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Verify connection status shows Connected
    const connectionStatus = host.page.locator(selectors.session.connectionStatus);
    await expect(connectionStatus).toBeVisible({ timeout: 30000 });
    await expect(connectionStatus).toContainText('Connected', {
      timeout: 30000
    });
    console.log('[E2E] Connection status shows Connected');

    // Verify Leave button is visible
    const leaveButton = host.page.locator(selectors.session.leaveButton);
    await expect(leaveButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Leave button is visible');

    // Click Leave
    console.log('[E2E] Host clicking Leave...');
    await leaveButton.click();

    // Verify navigation back to home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    console.log('[E2E] Host returned to home page');

    // Verify URL changed to home
    const url = host.page.url();
    expect(url).not.toContain('/session/');
    console.log('[E2E] URL is home page');

    // Verify session store is reset (not connected)
    const isConnected = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<string, { getState?: () => { isConnected?: boolean } }>
      ).useSessionStore;
      return store?.getState?.()?.isConnected ?? null;
    });
    expect(isConnected).toBe(false);
    console.log('[E2E] Session store reset - not connected');

    console.log('[E2E] Host leave session test passed!');
  });

  test('participant can leave session and return to home page', async () => {
    // Launch both instances
    console.log('[E2E] Launching host and participant instances...');
    host = await launchApp('host');
    participant = await launchApp('participant');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });
    participant.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profiles
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // Host creates session
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Participant joins
    await joinSession(participant.page, sessionId);

    // Wait for P2P connection
    await waitForP2PConnection(host.page, participant.page);

    // Verify participant sees connection status Connected
    const participantConnection = participant.page.locator(selectors.session.connectionStatus);
    await expect(participantConnection).toBeVisible({ timeout: 10000 });
    await expect(participantConnection).toContainText('Connected', {
      timeout: 10000
    });
    console.log('[E2E] Participant sees Connected status');

    // Verify participant sees Leave button
    const participantLeave = participant.page.locator(selectors.session.leaveButton);
    await expect(participantLeave).toBeVisible({ timeout: 5000 });

    // Participant leaves
    console.log('[E2E] Participant clicking Leave...');
    await participantLeave.click();

    // Verify participant navigated to home page
    await participant.page.waitForSelector(selectors.home.title, {
      timeout: 10000
    });
    console.log('[E2E] Participant returned to home page');

    // Verify participant is no longer connected
    const participantConnected = await participant.page.evaluate(() => {
      const store = (
        window as unknown as Record<string, { getState?: () => { isConnected?: boolean } }>
      ).useSessionStore;
      return store?.getState?.()?.isConnected ?? null;
    });
    expect(participantConnected).toBe(false);
    console.log('[E2E] Participant session store reset');

    // Verify host is still in session (peer count may drop)
    const hostUrl = host.page.url();
    expect(hostUrl).toContain('/session/');
    console.log('[E2E] Host remains in session after participant left');

    console.log('[E2E] Participant leave session test passed!');
  });

  test('REC indicator is visible to both host and participant during recording', async () => {
    // Launch both instances
    console.log('[E2E] Launching host and participant instances...');
    host = await launchApp('host');
    participant = await launchApp('participant');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });
    participant.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // Setup profiles
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // Host creates session, participant joins
    const sessionId = await createSession(host.page);
    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Verify neither side shows REC indicator before recording
    const hostRecIndicator = host.page.locator(selectors.session.recIndicator);
    const participantRecIndicator = participant.page.locator(selectors.session.recIndicator);
    await expect(hostRecIndicator).not.toBeVisible();
    await expect(participantRecIndicator).not.toBeVisible();
    console.log('[E2E] No REC indicator before recording');

    // Host starts recording
    console.log('[E2E] Host starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for recording to start on host
    await waitForRecordingStart(host.page, 30000);
    console.log('[E2E] Recording started on host');

    // Verify host sees REC indicator in title bar
    await expect(hostRecIndicator).toBeVisible({ timeout: 10000 });
    await expect(hostRecIndicator).toContainText('REC');
    console.log('[E2E] Host sees REC indicator');

    // Wait for participant to receive recording state via P2P
    await participant.page.waitForFunction(
      () => {
        const win = window as unknown as Record<
          string,
          { getState?: () => { isRecording?: boolean } }
        >;
        return win.useRecordingStore?.getState?.()?.isRecording === true;
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Participant received recording state via P2P');

    // Verify participant also sees REC indicator
    await expect(participantRecIndicator).toBeVisible({ timeout: 10000 });
    await expect(participantRecIndicator).toContainText('REC');
    console.log('[E2E] Participant sees REC indicator');

    // Record briefly
    await sleep(2000);

    // Stop recording
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);

    // Verify REC indicator disappears on host
    await expect(hostRecIndicator).not.toBeVisible({ timeout: 10000 });
    console.log('[E2E] Host REC indicator disappeared after stop');

    // Verify REC indicator disappears on participant
    await waitForRecordingComplete(participant.page, 30000);
    await expect(participantRecIndicator).not.toBeVisible({ timeout: 10000 });
    console.log('[E2E] Participant REC indicator disappeared after stop');

    console.log('[E2E] REC indicator visibility test passed!');
  });
});
