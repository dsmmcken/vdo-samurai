import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection,
} from '../helpers/test-setup';
import {
  sleep,
  waitForRecordingStart,
  waitForRecordingComplete,
  waitForLocalBlob,
} from '../helpers/wait-helpers';
import { getRecordingState } from '../helpers/store-helpers';

test.describe('Peer Disconnect During Recording', () => {
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

  test('host recording continues after participant leaves mid-recording', async () => {
    // ==========================================
    // STEP 1: Launch host and participant
    // ==========================================
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

    // ==========================================
    // STEP 2: Setup profiles and connect
    // ==========================================
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Verify host sees participant tile
    const peerTile = host.page.locator(selectors.session.peerTileByName('Participant'));
    await expect(peerTile).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Host sees participant tile');

    // ==========================================
    // STEP 3: Start recording with both connected
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown to pass
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {
        // Countdown may have already finished
      });

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    // Verify recording is active on host
    const stateBeforeDisconnect = await getRecordingState(host.page);
    expect(stateBeforeDisconnect?.isRecording).toBe(true);

    // Verify participant also sees recording state
    await participant.page.waitForFunction(
      () => {
        const win = window as unknown as {
          useRecordingStore?: { getState?: () => { isRecording?: boolean } };
        };
        return win.useRecordingStore?.getState?.()?.isRecording === true;
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Both host and participant see recording active');

    // Record for 2 seconds with participant connected
    await sleep(2000);

    // ==========================================
    // STEP 4: Participant leaves mid-recording
    // ==========================================
    console.log('[E2E] Participant leaving session mid-recording...');
    const participantLeaveButton = participant.page.locator(selectors.session.leaveButton);
    await expect(participantLeaveButton).toBeVisible({ timeout: 5000 });
    await participantLeaveButton.click();

    // Verify participant returned to home page
    await participant.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    console.log('[E2E] Participant returned to home page');

    // ==========================================
    // STEP 5: Verify host recording is STILL active after disconnect
    // ==========================================
    // Wait a moment for the disconnect to propagate
    await sleep(2000);

    const stateAfterDisconnect = await getRecordingState(host.page);
    expect(stateAfterDisconnect?.isRecording).toBe(true);
    console.log('[E2E] Host recording still active after participant left');

    // Verify host is still on the session page
    const hostUrl = host.page.url();
    expect(hostUrl).toContain('/session/');
    console.log('[E2E] Host still on session page');

    // Verify host's connection status still shows connected
    const connectionStatus = host.page.locator(selectors.session.connectionStatus);
    await expect(connectionStatus).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Host connection status still visible');

    // Record for 2 more seconds after disconnect
    console.log('[E2E] Recording continues for 2 more seconds after disconnect...');
    await sleep(2000);

    // ==========================================
    // STEP 6: Stop recording and verify data integrity
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] Recording stopped and blob available');

    // Verify recording produced valid data
    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[E2E] Recording blob size:', finalState?.localBlob?.size);

    // Verify recording has proper timing (start and end times set)
    expect(finalState?.startTime).toBeTruthy();
    expect(finalState?.endTime).toBeTruthy();
    if (finalState?.startTime && finalState?.endTime) {
      const duration = finalState.endTime - finalState.startTime;
      // Recording lasted at least 4 seconds (2s before + 2s after disconnect)
      expect(duration).toBeGreaterThanOrEqual(3000);
      console.log('[E2E] Recording duration:', duration, 'ms');
    }

    // ==========================================
    // STEP 7: Verify NLE editor appears with clips
    // ==========================================
    console.log('[E2E] Waiting for NLE editor to appear...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE editor appeared');

    // Verify clips exist in the timeline
    const clipCount = await host.page.locator(selectors.nle.timelineClip).count();
    expect(clipCount).toBeGreaterThan(0);
    console.log('[E2E] Timeline clip count:', clipCount);

    console.log('[E2E] Peer disconnect during recording test passed!');
  });

  test('host recording continues after participant app is force-closed', async () => {
    // ==========================================
    // STEP 1: Launch host and participant
    // ==========================================
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

    // ==========================================
    // STEP 2: Setup profiles and connect
    // ==========================================
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // ==========================================
    // STEP 3: Start recording
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    // Record for 2 seconds
    await sleep(2000);

    // ==========================================
    // STEP 4: Force-close participant (simulates crash/network loss)
    // ==========================================
    console.log('[E2E] Force-closing participant app...');
    await closeApp(participant);
    // Null out so afterEach does not attempt double-close
    participant = undefined as unknown as AppInstance;
    console.log('[E2E] Participant app force-closed');

    // Wait for disconnect to propagate
    await sleep(3000);

    // ==========================================
    // STEP 5: Verify host recording is STILL running
    // ==========================================
    const stateAfterCrash = await getRecordingState(host.page);
    expect(stateAfterCrash?.isRecording).toBe(true);
    console.log('[E2E] Host recording still active after participant crash');

    // Host should still be on session page
    const hostUrl = host.page.url();
    expect(hostUrl).toContain('/session/');
    console.log('[E2E] Host still on session page');

    // Record for 2 more seconds
    await sleep(2000);

    // ==========================================
    // STEP 6: Stop recording and verify
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] Recording completed');

    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[E2E] Recording blob size:', finalState?.localBlob?.size);

    // Verify editor appears
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    const clipCount = await host.page.locator(selectors.nle.timelineClip).count();
    expect(clipCount).toBeGreaterThan(0);
    console.log('[E2E] NLE editor appeared with', clipCount, 'clips');

    console.log('[E2E] Force-close peer disconnect test passed!');
  });

  test('host sees peer tile removed after participant disconnects during recording', async () => {
    // ==========================================
    // STEP 1: Launch host and participant
    // ==========================================
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

    // ==========================================
    // STEP 2: Setup, connect, and start recording
    // ==========================================
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    const sessionId = await createSession(host.page);
    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Verify initial tile count (host + participant = at least 2)
    const initialTileCount = await host.page.locator('[role="listitem"]').count();
    expect(initialTileCount).toBeGreaterThanOrEqual(2);
    console.log('[E2E] Initial tile count on host:', initialTileCount);

    // Start recording
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});
    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    await sleep(1500);

    // ==========================================
    // STEP 3: Participant leaves
    // ==========================================
    console.log('[E2E] Participant leaving...');
    await participant.page.locator(selectors.session.leaveButton).click();
    await participant.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    console.log('[E2E] Participant left');

    // ==========================================
    // STEP 4: Verify peer tile is removed on host
    // ==========================================
    // Wait for host to detect peer departure -- tile count should decrease
    await host.page.waitForFunction(
      (expected) => {
        const tiles = document.querySelectorAll('[role="listitem"]');
        return tiles.length < expected;
      },
      initialTileCount,
      { timeout: 30000 }
    );
    console.log('[E2E] Host tile count decreased after participant left');

    const tileCountAfterLeave = await host.page.locator('[role="listitem"]').count();
    console.log('[E2E] Tile count after leave:', tileCountAfterLeave);
    expect(tileCountAfterLeave).toBeLessThan(initialTileCount);

    // ==========================================
    // STEP 5: Verify recording is still running
    // ==========================================
    const stateAfterLeave = await getRecordingState(host.page);
    expect(stateAfterLeave?.isRecording).toBe(true);
    console.log('[E2E] Recording still active after peer tile removed');

    // Record a bit more then stop
    await sleep(1500);

    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);

    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[E2E] Recording completed with blob size:', finalState?.localBlob?.size);

    console.log('[E2E] Peer tile removal during recording test passed!');
  });
});
