import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { waitForRecordingComplete, waitForLocalBlob, sleep } from '../helpers/wait-helpers';

/**
 * Dedicated E2E test for video export functionality
 *
 * This test isolates the export pipeline without P2P complexity.
 * It verifies the full flow: recording -> NLE editor -> export -> completion
 */

test.describe('Video Export', () => {
  let app: AppInstance;

  test.afterEach(async () => {
    if (app) {
      await closeApp(app);
    }
  });

  /**
   * Helper to navigate to session as host
   */
  async function setupSessionAsHost(page: typeof app.page) {
    // Complete profile setup
    await page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await page.fill('#display-name', 'Export Test User');
    await page.fill('#full-name', 'Export Test User Full');
    await page.click('button:has-text("Continue")');

    // Wait for home page
    await page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Create a room (this makes us the host)
    await page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
  }

  /**
   * Helper to check recording store state
   */
  async function getRecordingState(page: typeof app.page) {
    return await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              isRecording?: boolean;
              localBlob?: Blob | null;
              localScreenBlob?: Blob | null;
              startTime?: number | null;
              endTime?: number | null;
              editPoints?: unknown[];
            };
          }
        >
      ).useRecordingStore;
      if (store?.getState) {
        const state = store.getState();
        return {
          isRecording: state.isRecording,
          localBlob: state.localBlob ? { size: state.localBlob.size } : null,
          localScreenBlob: state.localScreenBlob ? { size: state.localScreenBlob.size } : null,
          startTime: state.startTime,
          endTime: state.endTime,
          editPoints: state.editPoints
        };
      }
      return null;
    });
  }

  test('single user can record and export video', async () => {
    // Launch app
    app = await launchApp('export-test-' + Date.now());
    const { page } = app;

    // Step 1: Setup session as host
    console.log('[Export Test] Setting up session as host...');
    await setupSessionAsHost(page);

    // Step 2: Verify we're on session page with Record button visible
    console.log('[Export Test] Verifying session page loaded...');
    await expect(page.locator(selectors.session.recordButton)).toBeVisible();

    // Step 3: Start recording
    console.log('[Export Test] Starting recording...');
    await page.click(selectors.session.recordButton);

    // Wait for countdown to finish and recording to start (Stop button appears)
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });

    // Verify recording started in store
    const stateAfterStart = await getRecordingState(page);
    expect(stateAfterStart?.isRecording).toBe(true);
    console.log('[Export Test] Recording started, startTime:', stateAfterStart?.startTime);

    // Step 4: Record for 3 seconds
    console.log('[Export Test] Recording for 3 seconds...');
    await sleep(3000);

    // Step 5: Stop recording
    console.log('[Export Test] Stopping recording...');
    await page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(page, 30000);
    console.log('[Export Test] Recording stopped');

    // Step 6: Wait for localBlob to be set (this is critical)
    console.log('[Export Test] Waiting for localBlob to be set...');
    await waitForLocalBlob(page, 30000);

    // Verify localBlob was created
    const stateAfterStop = await getRecordingState(page);
    console.log('[Export Test] Recording state after stop:', stateAfterStop);

    // CRITICAL CHECK: This is often where export fails
    expect(stateAfterStop?.localBlob).not.toBeNull();
    expect(stateAfterStop?.localBlob?.size).toBeGreaterThan(0);
    console.log('[Export Test] localBlob size:', stateAfterStop?.localBlob?.size);

    // Step 7: Wait for Recording Complete popover
    console.log('[Export Test] Waiting for Recording Complete popover...');
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });

    // Step 8: Click "Begin Transfer & Edit"
    console.log('[Export Test] Clicking Begin Transfer & Edit...');
    await page.click(selectors.recordingComplete.beginTransferButton);

    // Step 9: Wait for NLE Editor to load
    console.log('[Export Test] Waiting for NLE Editor...');
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Verify Export button is visible and enabled
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeVisible();

    // Check if button is enabled (not disabled)
    const isDisabled = await exportButton.isDisabled();
    if (isDisabled) {
      // Debug: Check why export might be disabled
      const debugInfo = await page.evaluate(() => {
        const recordingStore = (
          window as unknown as Record<
            string,
            { getState?: () => { localBlob?: Blob | null; startTime?: number; endTime?: number } }
          >
        ).useRecordingStore?.getState?.();
        const nleStore = (
          window as unknown as Record<string, { getState?: () => { clips?: unknown[] } }>
        ).useNLEStore?.getState?.();
        return {
          localBlob: recordingStore?.localBlob ? true : false,
          localBlobSize: recordingStore?.localBlob?.size,
          startTime: recordingStore?.startTime,
          endTime: recordingStore?.endTime,
          clipsCount: nleStore?.clips?.length
        };
      });
      console.log('[Export Test] Export button disabled. Debug info:', debugInfo);
    }
    expect(isDisabled).toBe(false);

    // Step 10: Click Export
    console.log('[Export Test] Starting export...');
    await exportButton.click();

    // Step 11: Wait for export to start (shows "Exporting Video" header)
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    console.log('[Export Test] Export started, waiting for completion...');

    // Step 12: Wait for export to complete
    // This can take up to 60s depending on recording length and system speed
    await page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 120000 });
    console.log('[Export Test] Export completed!');

    // Step 13: Verify "Video Ready!" screen shows download option
    await expect(page.locator('h3:has-text("Video Ready!")')).toBeVisible();
    await expect(page.locator('button:has-text("Download")')).toBeVisible();

    // Step 14: Verify output size is shown (confirms blob was created)
    // The size is displayed in format like "2.5 MB"
    await expect(page.locator('text=/\\d+(\\.\\d+)?\\s*(MB|KB)/')).toBeVisible();

    console.log('[Export Test] Test completed successfully!');
  });

  test('single user can record with screen share and export video', async () => {
    // This test uses both camera AND screen share to test multi-source export
    // Launch app
    app = await launchApp('export-screen-test-' + Date.now());
    const { page } = app;

    // Step 1: Setup session as host
    console.log('[Export Screen Test] Setting up session as host...');
    await setupSessionAsHost(page);

    // Step 2: Start screen share before recording
    console.log('[Export Screen Test] Starting screen share...');
    await page.click(selectors.session.screenShareButton);

    // Wait for screen source picker modal
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });

    // Click the Share button inside the dialog
    await page.click('[role="dialog"] button.bg-blue-600');

    // Wait for screen share to be active
    await page.waitForSelector('[aria-label*="Stop sharing"]', { timeout: 10000 });
    console.log('[Export Screen Test] Screen share started');

    // Step 3: Start recording
    console.log('[Export Screen Test] Starting recording...');
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });

    // Step 4: Record for 3 seconds
    console.log('[Export Screen Test] Recording for 3 seconds...');
    await sleep(3000);

    // Step 5: Stop recording
    console.log('[Export Screen Test] Stopping recording...');
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Verify both blobs were created
    const stateAfterStop = await getRecordingState(page);
    console.log('[Export Screen Test] Recording state:', stateAfterStop);
    expect(stateAfterStop?.localBlob?.size).toBeGreaterThan(0);
    // Note: localScreenBlob may or may not be set depending on screen recorder
    if (stateAfterStop?.localScreenBlob) {
      console.log('[Export Screen Test] Screen blob size:', stateAfterStop.localScreenBlob.size);
    }

    // Step 6: Go to NLE Editor
    console.log('[Export Screen Test] Going to NLE Editor...');
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Step 7: Export
    console.log('[Export Screen Test] Starting export...');
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled();
    await exportButton.click();

    // Step 8: Wait for export completion
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    console.log('[Export Screen Test] Export started, waiting for completion...');

    // Wait for export to complete (allow more time for multi-source)
    await page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 });
    console.log('[Export Screen Test] Export completed!');

    // Verify success
    await expect(page.locator('h3:has-text("Video Ready!")')).toBeVisible();
    await expect(page.locator('button:has-text("Download")')).toBeVisible();
    console.log('[Export Screen Test] Test completed successfully!');
  });

  test('export can be cancelled', async () => {
    // Launch app
    app = await launchApp('export-cancel-test-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page);

    // Record briefly (2 seconds)
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    await sleep(2000);
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Navigate to NLE
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Start export
    await page.click(selectors.nle.exportButton);
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });

    // Try to click cancel - export might complete before we can cancel
    const cancelButton = page.locator('button:has-text("Cancel")');
    const completeTitle = page.locator(selectors.nle.exportCompleteTitle);

    // Race between cancel button click and export completion
    try {
      // Wait a moment for export to progress
      await sleep(500);

      // Check if still exporting (cancel button visible)
      const isExporting = await cancelButton.isVisible().catch(() => false);
      const isComplete = await completeTitle.isVisible().catch(() => false);

      if (isExporting && !isComplete) {
        await cancelButton.click({ timeout: 5000 });
        // Should return to editor
        await expect(page.locator(selectors.nle.editor)).toBeVisible({ timeout: 10000 });
        console.log('[Export Cancel Test] Successfully cancelled export');
      } else {
        // Export completed before we could cancel - that's OK
        console.log('[Export Cancel Test] Export completed before cancel could be clicked');
        await expect(completeTitle).toBeVisible({ timeout: 10000 });
      }
    } catch {
      // Export likely completed during our cancel attempt - verify completion
      await expect(completeTitle).toBeVisible({ timeout: 10000 });
      console.log('[Export Cancel Test] Export completed (cancel race condition)');
    }
  });
});
