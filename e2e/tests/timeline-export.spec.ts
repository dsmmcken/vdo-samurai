import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingComplete,
  waitForLocalBlob,
  sleep,
} from '../helpers/wait-helpers';
import {
  verifyFileExists,
  getFileSize,
  getVideoInfo,
} from '../helpers/video-verify';
import * as path from 'path';
import * as os from 'os';

/**
 * E2E tests for timeline-aware video export
 *
 * Tests the new export system that:
 * - Shows only the active user's video at any time
 * - Shows screenshare fullscreen with camera PiP when both exist
 * - Cross-fades between users when switching
 * - Switches audio with active user
 */

test.describe('Timeline Export', () => {
  let app: AppInstance;

  test.afterEach(async () => {
    if (app) {
      await closeApp(app);
    }
  });

  /**
   * Helper to navigate to session as host
   */
  async function setupSessionAsHost(page: typeof app.page, userName: string = 'Test User') {
    // Complete profile setup
    await page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await page.fill('#display-name', userName);
    await page.fill('#full-name', `${userName} Full`);
    await page.click('button:has-text("Continue")');

    // Wait for home page
    await page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Create a room (this makes us the host)
    await page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
  }

  /**
   * Helper to get NLE store state
   */
  async function getNLEState(page: typeof app.page) {
    return await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              clips?: Array<{
                id: string;
                peerId: string | null;
                peerName: string;
                startTime: number;
                endTime: number;
                order: number;
                sourceType: string;
              }>;
              totalDuration?: number;
            };
          }
        >
      ).__nleStore__;
      if (store?.getState) {
        const state = store.getState();
        return {
          clips: state.clips,
          totalDuration: state.totalDuration,
        };
      }
      return null;
    });
  }

  /**
   * Helper to get transfer store state (received recordings)
   */
  async function getTransferState(page: typeof app.page) {
    return await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              receivedRecordings?: Array<{
                peerId: string;
                peerName: string;
                blob: Blob;
                type: 'camera' | 'screen';
              }>;
              transfers?: Array<{
                id: string;
                peerId: string;
                direction: string;
                status: string;
              }>;
            };
          }
        >
      ).__transferStore__;
      if (store?.getState) {
        const state = store.getState();
        return {
          receivedRecordings: state.receivedRecordings?.map((r) => ({
            peerId: r.peerId,
            peerName: r.peerName,
            type: r.type,
            blobSize: r.blob?.size || 0,
          })),
          transfers: state.transfers,
        };
      }
      return null;
    });
  }

  /**
   * Helper to get recording store state
   */
  async function getRecordingState(page: typeof app.page) {
    return await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              localBlob?: Blob | null;
              localScreenBlob?: Blob | null;
            };
          }
        >
      ).useRecordingStore;
      if (store?.getState) {
        const state = store.getState();
        return {
          localBlob: state.localBlob ? { size: state.localBlob.size } : null,
          localScreenBlob: state.localScreenBlob ? { size: state.localScreenBlob.size } : null,
        };
      }
      return null;
    });
  }

  test('exports single-user recording with camera only', async () => {
    // This tests the basic timeline export path with just camera
    app = await launchApp('timeline-export-camera-' + Date.now());
    const { page } = app;

    // Setup session
    await setupSessionAsHost(page, 'Camera Only User');

    // Start recording (camera only)
    console.log('[Timeline Export] Starting camera-only recording...');
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });

    // Record for 3 seconds
    await sleep(3000);

    // Stop recording
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Verify recording
    const recordingState = await getRecordingState(page);
    expect(recordingState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[Timeline Export] Recording complete, blob size:', recordingState?.localBlob?.size);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Wait for export button to be enabled (indicates clips exist)
    console.log('[Timeline Export] Waiting for export button to be enabled...');
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 10000 });

    // Export
    console.log('[Timeline Export] Starting export...');
    await exportButton.click();

    // Wait for export to start
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });

    // Wait for either success or failure
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 120000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 120000 }).then(() => 'failed'),
    ]);

    if (result === 'failed') {
      const errorElement = page.locator(selectors.nle.exportErrorMessage).first();
      const errorText = await errorElement.textContent();
      throw new Error(`Export failed: ${errorText}`);
    }
    console.log('[Timeline Export] Export completed!');

    // Verify success
    await expect(page.locator('h3:has-text("Video Ready!")')).toBeVisible();
    await expect(page.locator('button:has-text("Download")')).toBeVisible();
  });

  test('exports single-user recording with camera and screen share', async () => {
    // This tests the PiP layout (screen + camera overlay)
    app = await launchApp('timeline-export-pip-' + Date.now());
    const { page } = app;

    // Setup session
    await setupSessionAsHost(page, 'Screen Share User');

    // Start screen share
    console.log('[Timeline Export] Starting screen share...');
    await page.click(selectors.session.screenShareButton);
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    await page.click('[role="dialog"] button.bg-blue-600');
    await page.waitForSelector('[aria-label*="Stop sharing"]', { timeout: 10000 });
    console.log('[Timeline Export] Screen share started');

    // Start recording
    console.log('[Timeline Export] Starting recording with screen share...');
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });

    // Record for 3 seconds
    await sleep(3000);

    // Stop recording
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Verify both blobs
    const recordingState = await getRecordingState(page);
    expect(recordingState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[Timeline Export] Recording complete');
    console.log('  Camera blob:', recordingState?.localBlob?.size);
    console.log('  Screen blob:', recordingState?.localScreenBlob?.size);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Export
    console.log('[Timeline Export] Starting export...');
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled();
    await exportButton.click();

    // Wait for export (allow more time for PiP processing)
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    await page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 });
    console.log('[Timeline Export] Export completed!');

    // Verify success
    await expect(page.locator('h3:has-text("Video Ready!")')).toBeVisible();
  });

  test('verifies exported video properties', async () => {
    // This test downloads the video and verifies its properties using FFmpeg
    app = await launchApp('timeline-export-verify-' + Date.now());
    const { page } = app;

    // Setup and record
    await setupSessionAsHost(page, 'Verify User');

    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    await sleep(3000);
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Export
    await page.click(selectors.nle.exportButton);
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });
    await page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 120000 });

    // Download the video
    const downloadPath = path.join(os.tmpdir(), 'vdo-samurai-test', `export-${Date.now()}.webm`);

    // Intercept download
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Download")');
    const download = await downloadPromise;

    // Save to temp path
    await download.saveAs(downloadPath);
    console.log('[Timeline Export] Downloaded to:', downloadPath);

    // Verify file exists and has content
    expect(verifyFileExists(downloadPath)).toBe(true);
    const fileSize = getFileSize(downloadPath);
    expect(fileSize).toBeGreaterThan(50000); // At least 50KB
    console.log('[Timeline Export] File size:', fileSize);

    // Verify video info using FFmpeg
    const videoInfo = await getVideoInfo(page, downloadPath);
    console.log('[Timeline Export] Video info:', videoInfo);

    // Verify dimensions (should be 1920x1080)
    expect(videoInfo.width).toBe(1920);
    expect(videoInfo.height).toBe(1080);

    // Verify duration (should be approximately 3 seconds)
    expect(videoInfo.duration).toBeGreaterThan(2);
    expect(videoInfo.duration).toBeLessThan(5);
  });

  test('detects and reports FFmpeg export errors', async () => {
    // This test checks that export errors are properly detected and displayed
    app = await launchApp('timeline-export-error-check-' + Date.now());
    const { page } = app;

    // Collect console errors for debugging
    const consoleErrors: string[] = [];
    const ffmpegLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      }
      if (text.includes('FFmpeg') || text.includes('ffmpeg') || text.includes('Filter')) {
        ffmpegLogs.push(text);
      }
    });

    // Setup and record
    await setupSessionAsHost(page, 'Error Check User');

    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    await sleep(3000);
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Export - the button should be enabled if there are clips
    console.log('[Export Error Check] Starting export...');
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 5000 });
    await exportButton.click();

    // Wait for export to either complete or fail
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });

    // Wait for either success or failure
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 180000 }).then(() => 'failed'),
    ]);

    if (result === 'failed') {
      // Capture error message
      const errorElement = page.locator(selectors.nle.exportErrorMessage).first();
      const errorText = await errorElement.textContent();
      console.error('[Export Error Check] Export failed with error:', errorText);
      console.error('[Export Error Check] FFmpeg logs:', ffmpegLogs);
      console.error('[Export Error Check] Console errors:', consoleErrors);

      // Fail the test with details
      throw new Error(`Export failed with FFmpeg error:\n${errorText}\n\nFFmpeg logs:\n${ffmpegLogs.join('\n')}`);
    }

    console.log('[Export Error Check] Export completed successfully!');
    console.log('[Export Error Check] FFmpeg logs:', ffmpegLogs);
    expect(result).toBe('success');
  });

  test('verifies NLE clips and received recordings', async () => {
    // This test verifies that NLE clips are properly created and logs
    // the received recordings to help debug multi-user export issues
    app = await launchApp('timeline-verify-clips-' + Date.now());
    const { page } = app;

    // Setup and record with screen share (to test multiple source types)
    await setupSessionAsHost(page, 'Verify Clips User');

    // Start screen share
    await page.click(selectors.session.screenShareButton);
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    await page.click('[role="dialog"] button.bg-blue-600');
    await page.waitForSelector('[aria-label*="Stop sharing"]', { timeout: 10000 });

    // Start recording
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    await sleep(3000);
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Wait a moment for state to settle
    await sleep(1000);

    // Get NLE state
    const nleState = await getNLEState(page);
    console.log('[Verify Clips] NLE State:', JSON.stringify(nleState, null, 2));

    // Get transfer state (received recordings)
    const transferState = await getTransferState(page);
    console.log('[Verify Clips] Transfer State:', JSON.stringify(transferState, null, 2));

    // Verify clips exist
    expect(nleState).not.toBeNull();
    expect(nleState?.clips?.length).toBeGreaterThan(0);

    // Log clip details for debugging
    if (nleState?.clips) {
      for (const clip of nleState.clips) {
        console.log(
          `[Verify Clips] Clip: id=${clip.id}, peer=${clip.peerName} (${clip.peerId}), type=${clip.sourceType}`
        );
      }
    }

    // Log received recordings for debugging
    if (transferState?.receivedRecordings) {
      for (const rec of transferState.receivedRecordings) {
        console.log(
          `[Verify Clips] Received: peer=${rec.peerName} (${rec.peerId}), type=${rec.type}, size=${rec.blobSize}`
        );
      }
    }

    // Verify at least one clip has sourceType
    const clipTypes = nleState?.clips?.map((c) => c.sourceType) || [];
    console.log('[Verify Clips] Clip source types:', clipTypes);
    expect(clipTypes.length).toBeGreaterThan(0);
  });

  test('exports with multiple segments (xfade transitions)', async () => {
    // This test specifically tests the xfade filter by creating multiple segments
    app = await launchApp('timeline-export-xfade-' + Date.now());
    const { page } = app;

    // Collect console for debugging
    const logs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('FFmpeg') ||
        text.includes('ffmpeg') ||
        text.includes('Export') ||
        text.includes('xfade') ||
        text.includes('Filter')
      ) {
        logs.push(`[${msg.type()}] ${text}`);
      }
    });

    // Setup session
    await setupSessionAsHost(page, 'XFade Test User');

    // Record for longer to ensure we have content
    console.log('[XFade Test] Starting recording...');
    await page.click(selectors.session.recordButton);
    await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
    await sleep(4000); // Record for 4 seconds
    await page.click(selectors.session.stopButton);
    await waitForRecordingComplete(page, 30000);
    await waitForLocalBlob(page, 30000);

    // Go to NLE Editor
    await page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await page.click(selectors.recordingComplete.beginTransferButton);
    await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    // Wait for export button to be enabled (indicates clips are ready)
    const exportButton = page.locator(selectors.nle.exportButton);
    await expect(exportButton).toBeEnabled({ timeout: 5000 });

    // Try to create multiple segments by splitting
    // Select a clip first by clicking on timeline
    const clipElement = page.locator('[data-clip-id]').first();
    if (await clipElement.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clipElement.click();
      await sleep(200);

      // Move playhead and split to create multiple segments
      await page.keyboard.press('ArrowRight'); // Move 5 seconds forward
      await sleep(100);
      await page.keyboard.press('s'); // Split
      await sleep(500);
      console.log('[XFade Test] Split clip to create multiple segments');
    }

    // Export
    console.log('[XFade Test] Starting export with multiple segments...');
    await exportButton.click();
    await page.waitForSelector(selectors.nle.exportingHeader, { timeout: 10000 });

    // Wait for completion or failure
    const result = await Promise.race([
      page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 180000 }).then(() => 'success'),
      page.waitForSelector(selectors.nle.exportFailedTitle, { timeout: 180000 }).then(() => 'failed'),
    ]);

    // Log collected FFmpeg info
    console.log('[XFade Test] Collected logs:', logs.slice(-30));

    if (result === 'failed') {
      const errorElement = page.locator(selectors.nle.exportErrorMessage).first();
      const errorText = await errorElement.textContent();
      console.error('[XFade Test] Export FAILED:', errorText);
      throw new Error(`XFade export failed:\n${errorText}\n\nLogs:\n${logs.join('\n')}`);
    }

    console.log('[XFade Test] Export completed successfully!');
    await expect(page.locator('h3:has-text("Video Ready!")')).toBeVisible();
  });
});
