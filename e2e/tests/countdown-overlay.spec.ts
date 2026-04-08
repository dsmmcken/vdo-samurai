import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession } from '../helpers/test-setup';
import { waitForRecordingStart, waitForRecordingComplete } from '../helpers/wait-helpers';

test.describe('Countdown Overlay During Recording Start', () => {
  let host: AppInstance;

  test.afterEach(async () => {
    if (host) {
      await closeApp(host);
    }
  });

  test('countdown overlay appears with numbers and text when host starts recording', async () => {
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

    // Verify Record button is visible and shows "Record"
    const recordButton = host.page.locator(selectors.session.recordButton);
    await expect(recordButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Record button visible');

    // Verify countdown overlay is NOT visible before recording
    const countdownOverlay = host.page.locator(selectors.countdown.overlay);
    await expect(countdownOverlay).not.toBeVisible();
    console.log('[E2E] Countdown overlay not visible before recording');

    // Click Record to start the countdown
    console.log('[E2E] Clicking Record button...');
    await recordButton.click();

    // Verify the countdown overlay appears
    await expect(countdownOverlay).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Countdown overlay appeared');

    // Verify the "Recording starting..." text is visible
    const countdownText = host.page.locator(selectors.countdown.text);
    await expect(countdownText).toBeVisible({ timeout: 5000 });
    await expect(countdownText).toHaveText('Recording starting...');
    console.log('[E2E] "Recording starting..." text visible');

    // Verify the record button shows "Starting..." during countdown
    const startingButton = host.page.locator(selectors.session.startingButton);
    await expect(startingButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Record button shows "Starting..." during countdown');

    // Verify the "Starting..." button is disabled during countdown
    await expect(startingButton).toBeDisabled();
    console.log('[E2E] Starting button is disabled during countdown');

    // Verify countdown store state shows a countdown value
    const countdownValue = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { countdown?: number | null } }
        >
      ).useRecordingStore;
      return store?.getState?.()?.countdown ?? null;
    });
    expect(countdownValue).not.toBeNull();
    expect(typeof countdownValue).toBe('number');
    console.log('[E2E] Countdown store value:', countdownValue);

    // Wait for recording to actually start (countdown finishes)
    await waitForRecordingStart(host.page, 30000);
    console.log('[E2E] Recording started');

    // Verify countdown overlay disappears after recording starts
    await expect(countdownOverlay).not.toBeVisible({ timeout: 10000 });
    console.log('[E2E] Countdown overlay disappeared after recording started');

    // Verify the Stop button is now visible (confirming recording is active)
    const stopButton = host.page.locator(selectors.session.stopButton);
    await expect(stopButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Stop button visible - recording is active');

    // Verify countdown is null in store after recording starts
    const postCountdown = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { countdown?: number | null; isRecording?: boolean } }
        >
      ).useRecordingStore;
      const state = store?.getState?.();
      return { countdown: state?.countdown, isRecording: state?.isRecording };
    });
    expect(postCountdown.countdown).toBeNull();
    expect(postCountdown.isRecording).toBe(true);
    console.log('[E2E] Countdown is null and isRecording is true in store');

    // Stop the recording to clean up
    console.log('[E2E] Stopping recording...');
    await stopButton.click();
    await waitForRecordingComplete(host.page, 30000);
    console.log('[E2E] Recording stopped');

    console.log('[E2E] Countdown overlay test passed!');
  });

  test('countdown counts down from 3 to 1 sequentially', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await createSession(host.page);

    // Wait for Record button
    const recordButton = host.page.locator(selectors.session.recordButton);
    await expect(recordButton).toBeVisible({ timeout: 10000 });

    // Set up a listener to capture all countdown values seen in the store
    // We poll the store rapidly to capture the 3-2-1 sequence
    const countdownPromise = host.page.evaluate(() => {
      return new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const store = (
          window as unknown as Record<
            string,
            { getState?: () => { countdown?: number | null; isRecording?: boolean }; subscribe?: (fn: () => void) => () => void }
          >
        ).useRecordingStore;

        if (!store?.subscribe || !store?.getState) {
          resolve([]);
          return;
        }

        const unsubscribe = store.subscribe(() => {
          const state = store.getState!();
          if (state.countdown !== null && state.countdown !== undefined) {
            if (seen.length === 0 || seen[seen.length - 1] !== state.countdown) {
              seen.push(state.countdown);
            }
          }
          // Once recording starts, we're done
          if (state.isRecording === true) {
            unsubscribe();
            resolve(seen);
          }
        });

        // Timeout safety
        setTimeout(() => {
          unsubscribe();
          resolve(seen);
        }, 15000);
      });
    });

    // Click Record to start countdown
    console.log('[E2E] Clicking Record button...');
    await recordButton.click();

    // Wait for the countdown values to be captured
    const countdownValues = await countdownPromise;
    console.log('[E2E] Captured countdown values:', countdownValues);

    // Verify we saw 3, 2, 1 in order
    expect(countdownValues).toEqual([3, 2, 1]);
    console.log('[E2E] Countdown sequence 3-2-1 verified');

    // Wait for recording to start and then stop to clean up
    await waitForRecordingStart(host.page, 10000);
    const stopButton = host.page.locator(selectors.session.stopButton);
    await expect(stopButton).toBeVisible({ timeout: 5000 });
    await stopButton.click();
    await waitForRecordingComplete(host.page, 30000);

    console.log('[E2E] Countdown sequence test passed!');
  });

  test('countdown overlay shows animated number elements', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await createSession(host.page);

    // Wait for Record button
    const recordButton = host.page.locator(selectors.session.recordButton);
    await expect(recordButton).toBeVisible({ timeout: 10000 });

    // Click Record
    console.log('[E2E] Clicking Record button...');
    await recordButton.click();

    // Wait for countdown overlay to appear
    const countdownOverlay = host.page.locator(selectors.countdown.overlay);
    await expect(countdownOverlay).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Countdown overlay visible');

    // Verify at least one countdown number element is rendered
    // The numbers cycle 3 -> 2 -> 1, so we should see at least one
    const anyCountdownNumber = host.page.locator(
      '[data-testid^="countdown-number-"]'
    );
    await expect(anyCountdownNumber.first()).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Countdown number element visible');

    // Wait for the countdown to finish and recording to start
    await waitForRecordingStart(host.page, 30000);

    // Verify overlay is gone
    await expect(countdownOverlay).not.toBeVisible({ timeout: 10000 });
    console.log('[E2E] Countdown overlay gone after recording started');

    // Stop recording to clean up
    const stopButton = host.page.locator(selectors.session.stopButton);
    await expect(stopButton).toBeVisible({ timeout: 5000 });
    await stopButton.click();
    await waitForRecordingComplete(host.page, 30000);

    console.log('[E2E] Animated number elements test passed!');
  });
});
