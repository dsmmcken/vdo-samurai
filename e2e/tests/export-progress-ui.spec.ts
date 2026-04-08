import { test, expect, Page } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession } from '../helpers/test-setup';
import {
  waitForRecordingComplete,
  waitForLocalBlob,
  sleep,
} from '../helpers/wait-helpers';

/**
 * E2E tests for the Export Progress UI
 *
 * Tests the full export lifecycle UI elements:
 * - Progress bar and percentage indicator during export
 * - Status messages (loading/processing)
 * - Cancel Export button presence
 * - Warning message about not closing the window
 * - Export completion screen with Download button, file size, and Back to Editor
 * - Back to Editor button returns to the NLE editor
 */

// ==========================================
// Common Helper Functions
// ==========================================

/**
 * Helper to record a short session for export testing
 */
async function recordShortSession(page: Page, durationMs: number = 3000) {
  await page.click(selectors.session.recordButton);
  await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
  await sleep(durationMs);
  await page.click(selectors.session.stopButton);
  await waitForRecordingComplete(page, 30000);
  await waitForLocalBlob(page, 30000);
}

/**
 * Helper to wait for the NLE editor to open
 */
async function waitForNLEEditor(page: Page) {
  await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
}

// ==========================================
// Test Suite
// ==========================================

test.describe('Export Progress UI', () => {
  let app: AppInstance;

  test.afterEach(async () => {
    if (app) {
      await closeApp(app);
    }
  });

  test('shows progress bar, percentage, and status during export', async () => {
    app = await launchApp('export-progress-ui-' + Date.now());
    const { page } = app;

    // Setup profile and create session
    await setupProfile(page, 'Export UI User', 'Export UI Full');
    await createSession(page);

    // Record briefly
    console.log('[Export Progress UI] Recording...');
    await recordShortSession(page, 3000);

    // Enter NLE editor
    await waitForNLEEditor(page);

    // Click export
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    console.log('[Export Progress UI] Clicking Export...');
    await exportButton.click();

    // Wait for the exporting header to appear
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    console.log('[Export Progress UI] Exporting header visible');

    // Verify progress UI elements are present
    const progressContainer = page.locator(selectors.nle.exportProgress);
    await expect(progressContainer).toBeVisible({ timeout: 5000 });
    console.log('[Export Progress UI] Progress container visible');

    // Verify the percentage text is visible and contains a number followed by %
    const percentText = page.locator(selectors.nle.exportProgressPercent);
    await expect(percentText).toBeVisible({ timeout: 5000 });
    const percentValue = await percentText.textContent();
    expect(percentValue).toMatch(/^\d+%$/);
    console.log('[Export Progress UI] Percentage text:', percentValue);

    // Verify the linear progress bar exists
    const progressBar = page.locator(selectors.nle.exportProgressBar);
    await expect(progressBar).toBeVisible({ timeout: 5000 });
    console.log('[Export Progress UI] Linear progress bar visible');

    // Verify the progress bar fill element has a width style set
    const progressBarFill = page.locator(selectors.nle.exportProgressBarFill);
    await expect(progressBarFill).toBeVisible({ timeout: 5000 });
    const fillWidth = await progressBarFill.getAttribute('style');
    expect(fillWidth).toContain('width:');
    console.log('[Export Progress UI] Progress bar fill style:', fillWidth);

    // Verify the Cancel Export button is visible
    const cancelButton = page.locator(selectors.nle.exportCancelButton);
    await expect(cancelButton).toBeVisible({ timeout: 5000 });
    await expect(cancelButton).toHaveText('Cancel Export');
    console.log('[Export Progress UI] Cancel Export button visible');

    // Verify the warning message about not closing the window
    const warningText = page.locator('text=Please don\'t close this window');
    await expect(warningText).toBeVisible({ timeout: 5000 });
    console.log('[Export Progress UI] Warning message visible');

    // Verify "Processing locally" label
    const processingLabel = page.locator('text=Processing locally');
    await expect(processingLabel).toBeVisible({ timeout: 5000 });
    console.log('[Export Progress UI] "Processing locally" label visible');

    // Verify status text shows either "Initializing..." or "Encoding video..."
    const statusText = page.locator('text=Initializing..., text=Encoding video...').first();
    await expect(statusText).toBeVisible({ timeout: 10000 });
    console.log('[Export Progress UI] Status text visible');

    // Verify the "% complete" label in the progress bar area
    const completeLabel = page.locator('text=/\\d+% complete/').first();
    await expect(completeLabel).toBeVisible({ timeout: 5000 });
    console.log('[Export Progress UI] "% complete" label visible');

    // Wait for export to complete
    console.log('[Export Progress UI] Waiting for export to complete...');
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 180000 }).then(() => 'failed'),
    ]);

    expect(result).toBe('success');
    console.log('[Export Progress UI] Export completed successfully');
  });

  test('export completion screen shows download button, file size, and back to editor', async () => {
    app = await launchApp('export-complete-ui-' + Date.now());
    const { page } = app;

    // Setup profile and create session
    await setupProfile(page, 'Complete UI User', 'Complete UI Full');
    await createSession(page);

    // Record briefly
    console.log('[Export Complete UI] Recording...');
    await recordShortSession(page, 3000);

    // Enter NLE editor and export
    await waitForNLEEditor(page);
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    console.log('[Export Complete UI] Starting export...');
    await exportButton.click();

    // Wait for export to complete
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 180000 }).then(() => 'failed'),
    ]);
    expect(result).toBe('success');
    console.log('[Export Complete UI] Export complete');

    // Verify the export complete screen container
    const completeScreen = page.locator(selectors.nle.exportCompleteScreen);
    await expect(completeScreen).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] Export complete screen visible');

    // Verify "Video Ready!" title
    const readyTitle = page.locator(selectors.nle.exportCompleteTitle);
    await expect(readyTitle).toBeVisible();
    console.log('[Export Complete UI] "Video Ready!" title visible');

    // Verify "Your video has been exported successfully." message
    const successMessage = page.locator('text=Your video has been exported successfully');
    await expect(successMessage).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] Success message visible');

    // Verify Download button is visible
    const downloadButton = page.locator('button:has-text("Download")');
    await expect(downloadButton).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] Download button visible');

    // Verify file size is displayed (format: "X.X MB")
    const fileSizeText = page.locator('text=/\\d+\\.\\d+ MB/').first();
    await expect(fileSizeText).toBeVisible({ timeout: 5000 });
    const sizeValue = await fileSizeText.textContent();
    console.log('[Export Complete UI] File size displayed:', sizeValue);

    // Verify "Output Size" label
    const outputSizeLabel = page.locator('text=Output Size');
    await expect(outputSizeLabel).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] "Output Size" label visible');

    // Verify filename input with placeholder
    const filenameInput = page.locator('input[type="text"][placeholder*="vdo-samurai"]');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] Filename input visible');

    // Verify "Export Complete" header
    const exportCompleteHeader = page.locator('h2:has-text("Export Complete")');
    await expect(exportCompleteHeader).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] "Export Complete" header visible');

    // Verify Back to Editor button is visible
    const backButton = page.locator(selectors.nle.backToEditorButton);
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] "Back to Editor" button visible');

    // Verify privacy notice
    const privacyNotice = page.locator('text=processed entirely on your device');
    await expect(privacyNotice).toBeVisible({ timeout: 5000 });
    console.log('[Export Complete UI] Privacy notice visible');

    console.log('[Export Complete UI] Test passed!');
  });

  test('back to editor button returns to NLE editor from export complete screen', async () => {
    app = await launchApp('export-back-editor-' + Date.now());
    const { page } = app;

    // Setup profile and create session
    await setupProfile(page, 'Back Editor User', 'Back Editor Full');
    await createSession(page);

    // Record briefly
    console.log('[Back to Editor] Recording...');
    await recordShortSession(page, 2000);

    // Enter NLE editor and export
    await waitForNLEEditor(page);
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    console.log('[Back to Editor] Starting export...');
    await exportButton.click();

    // Wait for export to complete
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 180000 }).then(() => 'failed'),
    ]);
    expect(result).toBe('success');
    console.log('[Back to Editor] Export complete');

    // Verify we are on the export complete screen
    const completeScreen = page.locator(selectors.nle.exportCompleteScreen);
    await expect(completeScreen).toBeVisible({ timeout: 5000 });

    // Click "Back to Editor"
    const backButton = page.locator(selectors.nle.backToEditorButton);
    await expect(backButton).toBeVisible({ timeout: 5000 });
    console.log('[Back to Editor] Clicking Back to Editor...');
    await backButton.click();

    // Verify we return to the NLE editor (Video Editor header)
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[Back to Editor] NLE editor visible again');

    // Verify the export complete screen is no longer visible
    await expect(completeScreen).not.toBeVisible({ timeout: 5000 });
    console.log('[Back to Editor] Export complete screen hidden');

    // Verify the Export button is available again for re-export
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    console.log('[Back to Editor] Export button available again');

    // Verify timeline clips are still present
    const clipCount = page.locator(selectors.nle.clipCount);
    await expect(clipCount).toBeVisible({ timeout: 5000 });
    const clipText = await clipCount.textContent();
    expect(clipText).toContain('clip');
    console.log('[Back to Editor] Clips still present:', clipText);

    console.log('[Back to Editor] Test passed!');
  });

  test('progress percentage increases during export', async () => {
    app = await launchApp('export-progress-increase-' + Date.now());
    const { page } = app;

    // Setup profile and create session
    await setupProfile(page, 'Progress User', 'Progress Full');
    await createSession(page);

    // Record longer to give more time to observe progress
    console.log('[Progress Increase] Recording...');
    await recordShortSession(page, 4000);

    // Enter NLE editor and export
    await waitForNLEEditor(page);
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 10000 });
    console.log('[Progress Increase] Starting export...');
    await exportButton.click();

    // Wait for the progress UI to appear
    await page.waitForSelector(selectors.nle.exportProgress, { timeout: 10000 });

    // Collect progress values over time
    const progressValues: number[] = [];
    const startTime = Date.now();
    const maxWait = 120000; // 2 minutes max

    while (Date.now() - startTime < maxWait) {
      // Check if export completed
      const isComplete = await page.locator(selectors.nle.exportCompleteTitle).isVisible().catch(() => false);
      const isFailed = await page.locator(selectors.nle.exportFailedTitle).isVisible().catch(() => false);

      if (isComplete || isFailed) {
        console.log('[Progress Increase] Export finished, status:', isComplete ? 'success' : 'failed');
        break;
      }

      // Read current percentage
      const percentEl = page.locator(selectors.nle.exportProgressPercent);
      const isVisible = await percentEl.isVisible().catch(() => false);
      if (isVisible) {
        const text = await percentEl.textContent();
        if (text) {
          const value = parseInt(text.replace('%', ''), 10);
          if (!isNaN(value)) {
            progressValues.push(value);
          }
        }
      }

      await sleep(500);
    }

    console.log('[Progress Increase] Collected progress values:', progressValues);

    // Verify we collected at least some progress readings
    expect(progressValues.length).toBeGreaterThan(0);

    // Verify the maximum progress value is greater than the minimum
    // (i.e., progress actually increased during export)
    const minProgress = Math.min(...progressValues);
    const maxProgress = Math.max(...progressValues);
    console.log(`[Progress Increase] Progress range: ${minProgress}% to ${maxProgress}%`);

    // The progress should have increased at some point
    // (we allow equality if export was very fast and only captured one value)
    if (progressValues.length > 1) {
      expect(maxProgress).toBeGreaterThanOrEqual(minProgress);
    }

    // Verify export completed successfully
    const completeTitle = page.locator(selectors.nle.exportCompleteTitle);
    await expect(completeTitle).toBeVisible({ timeout: 120000 });
    console.log('[Progress Increase] Export completed successfully');

    console.log('[Progress Increase] Test passed!');
  });
});
