import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForTileFocused,
  sleep,
  waitForRecordingStart,
  waitForRecordingComplete,
} from '../helpers/wait-helpers';

test.describe('VDO Samurai E2E - Timeline Active User Segments', () => {
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

  test('timeline shows correct clips after recording with focus changes', async () => {
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
    console.log('[E2E] Waiting for P2P connection...');

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
      await host.page.screenshot({ path: 'e2e/test-results/timeline-host-timeout.png' });
      await participant.page.screenshot({ path: 'e2e/test-results/timeline-participant-timeout.png' });
      throw new Error(`P2P connection timeout after ${maxWaitTime}ms`);
    }

    console.log('[E2E] P2P connection established');

    // ==========================================
    // STEP 6: Host starts recording
    // ==========================================
    console.log('[E2E] Host starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for recording to start
    await waitForRecordingStart(host.page, 30000);
    console.log('[E2E] Recording started');

    // ==========================================
    // STEP 7: Record with focus changes
    // ==========================================
    // Segment 1: Host focused (initial state) - ~2s
    console.log('[E2E] Recording segment 1: Host focused (initial)');
    await sleep(2000);

    // Switch focus to participant
    console.log('[E2E] Switching focus to Participant...');
    await host.page.click('[role="button"][aria-label*="Participant"]');
    await waitForTileFocused(host.page, 'Participant', 5000);

    // Segment 2: Participant focused - ~2s
    console.log('[E2E] Recording segment 2: Participant focused');
    await sleep(2000);

    // Switch focus back to host (click on "You" tile)
    console.log('[E2E] Switching focus back to Host...');
    await host.page.click('[role="button"][aria-label*="You"]');
    await waitForTileFocused(host.page, 'You', 5000);

    // Segment 3: Host focused again - ~2s
    console.log('[E2E] Recording segment 3: Host focused again');
    await sleep(2000);

    // ==========================================
    // STEP 8: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(host.page, 30000);
    console.log('[E2E] Recording complete');

    // Wait for Recording Complete popover to appear
    await host.page.waitForSelector(selectors.recordingComplete.popoverTitle, { timeout: 10000 });

    // ==========================================
    // STEP 9: Open NLE editor
    // ==========================================
    console.log('[E2E] Opening NLE editor...');
    await host.page.click(selectors.recordingComplete.beginTransferButton);

    // Wait for editor to appear
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE editor opened');

    // Wait a moment for clips to initialize
    await sleep(1000);

    // ==========================================
    // STEP 10: Verify timeline clips
    // ==========================================
    console.log('[E2E] Verifying timeline clips...');

    // Get all timeline clips
    const clips = await host.page.locator(selectors.nle.timelineClip).all();
    const clipCount = clips.length;
    console.log(`[E2E] Found ${clipCount} timeline clips`);

    // We expect at least 3 clips (one per focus segment)
    expect(clipCount).toBeGreaterThanOrEqual(3);

    // Get clip details
    const clipDetails = await host.page.evaluate(() => {
      const clipElements = document.querySelectorAll('[data-testid="timeline-clip"]');
      return Array.from(clipElements).map((clip) => ({
        peerName: clip.getAttribute('data-peer-name'),
        duration: Number(clip.getAttribute('data-duration')),
      }));
    });

    console.log('[E2E] Clip details:', JSON.stringify(clipDetails, null, 2));

    // Verify clip sequence: Host -> Participant -> Host
    // Note: The first clip is for Host (the initial focus)
    // Second clip is for Participant
    // Third clip is for Host again
    const expectedSequence = ['Host User', 'Participant', 'Host User'];

    for (let i = 0; i < Math.min(3, clipDetails.length); i++) {
      const clip = clipDetails[i];

      // Verify peer name matches expected sequence
      expect(clip.peerName).toBe(expectedSequence[i]);

      // Verify each clip has reasonable duration (> 1000ms for ~2s segments)
      // Allow some variance due to timing
      expect(clip.duration).toBeGreaterThan(1000);

      console.log(`[E2E] Clip ${i}: ${clip.peerName}, duration: ${clip.duration}ms`);
    }

    // Verify total duration approximates recording time (~6s = 6000ms)
    // Allow 1s variance on either side
    const totalDuration = clipDetails.reduce((sum, clip) => sum + clip.duration, 0);
    console.log(`[E2E] Total clip duration: ${totalDuration}ms`);
    expect(totalDuration).toBeGreaterThan(5000);
    expect(totalDuration).toBeLessThan(10000);

    console.log('[E2E] Timeline active user test passed!');
  });
});
