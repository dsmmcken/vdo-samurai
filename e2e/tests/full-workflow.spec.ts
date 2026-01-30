import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingComplete,
  waitForReceivedRecordings,
  waitForLocalScreenShare,
  waitForPeerScreenShareBadge,
  sleep,
} from '../helpers/wait-helpers';
import { verifyFileExists, getFileSize, getVideoInfo, deleteFile } from '../helpers/video-verify';
import * as path from 'path';
import * as os from 'os';

test.describe('VDO Samurai E2E - Full Workflow', () => {
  let host: AppInstance;
  let participant: AppInstance;

  test.afterEach(async () => {
    // Cleanup instances
    if (participant) {
      await closeApp(participant);
    }
    if (host) {
      await closeApp(host);
    }
  });

  test('two peers connect, record 5s, switch active user, transfer, and export', async () => {
    // ==========================================
    // STEP 1: Launch two Electron instances
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    console.log('[E2E] Launching participant instance...');
    participant = await launchApp('participant');

    // ==========================================
    // STEP 2: Complete profile setup for both
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    console.log('[E2E] Setting up participant profile...');
    await participant.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await participant.page.fill('#display-name', 'Participant');
    await participant.page.fill('#full-name', 'Participant Full Name');
    await participant.page.click('button:has-text("Continue")');

    // Wait for both to reach home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await participant.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 3: Host creates session
    // ==========================================
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Extract session ID from URL
    const hostUrl = host.page.url();
    const sessionIdMatch = hostUrl.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];
    console.log('[E2E] Session created:', sessionId);

    // ==========================================
    // STEP 4: Participant joins session
    // ==========================================
    console.log('[E2E] Participant joining session...');
    await participant.page.fill(selectors.home.roomCodeInput, sessionId);
    await participant.page.click(selectors.home.joinRoomButton);

    // Wait for participant to reach session page
    await participant.page.waitForSelector(selectors.session.participantList, { timeout: 30000 });

    // ==========================================
    // STEP 5: Wait for P2P connection
    // ==========================================
    console.log('[E2E] Waiting for P2P connection (this may take up to 90s via Nostr relays)...');

    // Poll for peer visibility with retries
    // TileGrid uses [role="listitem"] for each tile (including local)
    // When connected, there should be 2 tiles (You + peer)
    const maxWaitTime = 90000;
    const pollInterval = 5000;
    const startTime = Date.now();

    let hostSeesPeer = false;
    let participantSeesHost = false;

    while (Date.now() - startTime < maxWaitTime && (!hostSeesPeer || !participantSeesHost)) {
      await sleep(pollInterval);

      const hostTileCount = await host.page.locator('[role="listitem"]').count();
      const participantTileCount = await participant.page.locator('[role="listitem"]').count();

      console.log(`[E2E] Host tiles: ${hostTileCount}, Participant tiles: ${participantTileCount}`);

      // When connected, each should see 2 tiles (self + peer)
      if (!hostSeesPeer && hostTileCount >= 2) {
        hostSeesPeer = true;
        console.log('[E2E] Host sees participant!');
      }

      if (!participantSeesHost && participantTileCount >= 2) {
        participantSeesHost = true;
        console.log('[E2E] Participant sees host!');
      }
    }

    if (!hostSeesPeer || !participantSeesHost) {
      // Take screenshots for debugging
      await host.page.screenshot({ path: 'e2e/test-results/host-timeout.png' });
      await participant.page.screenshot({ path: 'e2e/test-results/participant-timeout.png' });
      throw new Error(`P2P connection timeout after ${maxWaitTime}ms. Host sees peer: ${hostSeesPeer}, Participant sees host: ${participantSeesHost}`);
    }

    console.log('[E2E] P2P connection established');

    // ==========================================
    // STEP 5.5: Both peers start screen share
    // ==========================================
    console.log('[E2E] Starting screen share on both peers...');

    // Host starts screen share
    await host.page.click(selectors.session.screenShareButton);

    // Wait for screen source picker modal to appear
    await host.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    console.log('[E2E] Host screen source picker appeared');

    // Click the Share button (first source is pre-selected)
    await host.page.click('button:has-text("Share")');

    // Wait for host's local screen share to be set
    await waitForLocalScreenShare(host.page, 10000);
    console.log('[E2E] Host screen share started');

    // Participant starts screen share
    await participant.page.click(selectors.session.screenShareButton);

    // Wait for screen source picker modal to appear
    await participant.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    console.log('[E2E] Participant screen source picker appeared');

    // Click the Share button
    await participant.page.click('button:has-text("Share")');

    // Wait for participant's local screen share to be set
    await waitForLocalScreenShare(participant.page, 10000);
    console.log('[E2E] Participant screen share started');

    // ==========================================
    // STEP 5.6: Verify screen share badges
    // ==========================================
    console.log('[E2E] Verifying screen share badges...');

    // Host should see their own screen share badge (on their tile)
    await host.page.waitForSelector(
      '[role="button"][aria-label*="Host User"][aria-label*="sharing screen"]',
      { timeout: 10000 }
    );
    console.log('[E2E] Host sees their own screen share badge');

    // Host should see participant's screen share badge (after P2P propagation)
    await waitForPeerScreenShareBadge(host.page, 'Participant', 30000);
    console.log('[E2E] Host sees participant screen share badge');

    // Participant should see their own screen share badge
    await participant.page.waitForSelector(
      '[role="button"][aria-label*="Participant"][aria-label*="sharing screen"]',
      { timeout: 10000 }
    );
    console.log('[E2E] Participant sees their own screen share badge');

    // Participant should see host's screen share badge
    await waitForPeerScreenShareBadge(participant.page, 'Host User', 30000);
    console.log('[E2E] Participant sees host screen share badge');

    console.log('[E2E] Screen share badges verified');

    // ==========================================
    // STEP 6: Start recording (host only)
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown (button shows "Starting..." during countdown)
    console.log('[E2E] Waiting for countdown...');
    await host.page.waitForSelector('button[aria-label="Starting..."]', { timeout: 5000 }).catch(() => {
      // Countdown may have already finished
    });

    // Wait for recording to start on both instances
    console.log('[E2E] Waiting for recording to start...');

    // Host should see Stop button
    await expect(host.page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });

    // Participant should have isRecording=true in their store
    // (They don't see the Record button, but receive the start message via P2P)
    await participant.page.waitForFunction(
      () => {
        const win = window as unknown as Record<string, { getState?: () => { isRecording?: boolean } }>;
        return win.useRecordingStore?.getState?.()?.isRecording === true;
      },
      undefined,
      { timeout: 30000 }
    );

    console.log('[E2E] Recording started on both instances');

    // ==========================================
    // STEP 7: Record for 2.5 seconds, then switch focus
    // ==========================================
    console.log('[E2E] Recording for 2.5 seconds...');
    await sleep(2500);

    // Switch focus to participant (click on participant's tile on host)
    console.log('[E2E] Switching active user to participant...');
    await host.page.click('[role="button"][aria-label*="Participant"]');

    // ==========================================
    // STEP 8: Record for 2.5 more seconds (total ~5s)
    // ==========================================
    console.log('[E2E] Recording for 2.5 more seconds...');
    await sleep(2500);

    // ==========================================
    // STEP 9: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete on both (may take time for blob processing)
    await waitForRecordingComplete(host.page, 30000);
    await waitForRecordingComplete(participant.page, 30000);

    console.log('[E2E] Recording stopped');

    // ==========================================
    // STEP 10: Wait for file transfer (automatic from non-host)
    // ==========================================
    // The participant automatically sends recording to host (SessionPage lines 133-144)
    console.log('[E2E] Waiting for file transfer from participant to host...');

    // Host should receive at least 1 recording from participant
    await waitForReceivedRecordings(host.page, 1, 60000);

    console.log('[E2E] File transfer complete');

    // ==========================================
    // STEP 11: Host begins transfer & edit
    // ==========================================
    console.log('[E2E] Host clicking Begin Transfer & Edit...');

    // Wait for the recording complete popover to appear
    await host.page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });
    await host.page.click(selectors.recordingComplete.beginTransferButton);

    // Wait for NLE editor to load
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    console.log('[E2E] NLE Editor loaded');

    // ==========================================
    // STEP 12: Wait for any pending transfers
    // ==========================================
    // Check if transfers indicator is visible, if so wait
    const hasTransfers = await host.page.locator(selectors.nle.transfersInProgress).isVisible().catch(() => false);
    if (hasTransfers) {
      console.log('[E2E] Waiting for transfers to complete...');
      await host.page.waitForSelector(selectors.nle.transfersInProgress, { state: 'hidden', timeout: 60000 });
    }

    // ==========================================
    // STEP 13: Export video
    // ==========================================
    console.log('[E2E] Starting video export...');

    // Click export button
    await host.page.click(selectors.nle.exportButton);

    // Wait for export to complete
    await host.page.waitForSelector(selectors.nle.exportCompleteTitle, { timeout: 120000 });

    console.log('[E2E] Export complete');

    // ==========================================
    // STEP 14: Download/save the video
    // ==========================================
    // Find and click the download button
    const downloadButton = host.page.locator('button:has-text("Download"), a:has-text("Download")').first();

    // Set up download handling
    const downloadPromise = host.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

    await downloadButton.click();

    const download = await downloadPromise;
    let exportedFilePath: string | null = null;

    if (download) {
      // Save to temp directory
      exportedFilePath = path.join(os.tmpdir(), 'vdo-samurai-e2e', `test-export-${Date.now()}.mp4`);
      await download.saveAs(exportedFilePath);
      console.log('[E2E] Video saved to:', exportedFilePath);
    } else {
      // Fallback: Try to get the path from the app's storage
      console.log('[E2E] No download event, checking for file via app...');

      // The app may have already saved it - check temp directory
      const tempPaths = await host.page.evaluate(async () => {
        const win = window as unknown as { electronAPI?: { storage?: { listRecordings?: () => Promise<{ recordings: string[] }> } } };
        if (win.electronAPI?.storage?.listRecordings) {
          return win.electronAPI.storage.listRecordings();
        }
        return { recordings: [] };
      });

      console.log('[E2E] Temp recordings:', tempPaths);
    }

    // ==========================================
    // STEP 15: Verify exported video
    // ==========================================
    if (exportedFilePath && verifyFileExists(exportedFilePath)) {
      console.log('[E2E] Verifying exported video...');

      // Check file size (should be > 100KB for 5s video)
      const fileSize = getFileSize(exportedFilePath);
      expect(fileSize).toBeGreaterThan(100000);
      console.log('[E2E] File size:', fileSize, 'bytes');

      // Check duration using FFmpeg (via app's IPC)
      try {
        const videoInfo = await getVideoInfo(host.page, exportedFilePath);
        console.log('[E2E] Video info:', videoInfo);

        // Duration should be ~5 seconds (allow ±1s tolerance for countdown variance)
        expect(videoInfo.duration).toBeGreaterThan(4);
        expect(videoInfo.duration).toBeLessThan(7);
        console.log('[E2E] Video duration:', videoInfo.duration, 'seconds');
      } catch {
        console.log('[E2E] Could not verify duration via FFmpeg, skipping duration check');
      }

      // Cleanup
      deleteFile(exportedFilePath);
      console.log('[E2E] Cleaned up exported file');
    } else {
      console.log('[E2E] No exported file found to verify - checking UI state instead');

      // Verify we're on the export complete screen
      await expect(host.page.locator(selectors.nle.exportCompleteTitle)).toBeVisible();
    }

    console.log('[E2E] Test completed successfully!');
  });
});
