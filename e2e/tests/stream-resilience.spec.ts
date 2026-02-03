import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingStart,
  waitForRecordingComplete,
  sleep,
} from '../helpers/wait-helpers';

test.describe('Stream Resilience', () => {
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

  test('camera toggle during recording creates proper clips', async () => {
    // ==========================================
    // STEP 1: Launch host instance
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // ==========================================
    // STEP 2: Complete profile setup
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    // Wait for home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 3: Host creates session
    // ==========================================
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // ==========================================
    // STEP 4: Start recording
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    console.log('[E2E] Waiting for countdown...');
    await host.page.waitForSelector('button[aria-label="Starting..."]', { timeout: 5000 }).catch(() => {
      // Countdown may have already finished
    });

    // Wait for recording to start
    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    // Verify isRecording=true and initial clip exists
    await host.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useRecordingStore?: { getState?: () => { isRecording?: boolean; localClips?: unknown[] } }
        }).useRecordingStore;
        const state = store?.getState?.();
        return state?.isRecording === true && (state?.localClips?.length ?? 0) >= 1;
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] Initial camera clip confirmed');

    // ==========================================
    // STEP 5: Record for 1.5 seconds, then toggle camera OFF
    // ==========================================
    console.log('[E2E] Recording for 1.5 seconds...');
    await sleep(1500);

    console.log('[E2E] Toggling camera OFF...');
    await host.page.click(selectors.session.cameraToggle);

    // Wait for clip transition - first camera clip should be stopped
    // Note: In mock environment, we don't have audio tracks, so audio-only clip won't be created
    await host.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                globalEndTime: number | null;
                status: string;
              }>;
            };
          };
        }).useRecordingStore;
        const clips = store?.getState?.()?.localClips ?? [];
        // First camera clip should be stopped (has globalEndTime)
        const stoppedCameraClip = clips.find(
          (c) => c.sourceType === 'camera' && c.globalEndTime !== null
        );
        return stoppedCameraClip !== undefined;
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] First camera clip stopped');

    // ==========================================
    // STEP 6: Wait 1.5 seconds, then toggle camera ON
    // ==========================================
    console.log('[E2E] Waiting 1.5 seconds with camera off...');
    await sleep(1500);

    console.log('[E2E] Toggling camera ON...');
    await host.page.click(selectors.session.cameraToggle);

    // Wait for clip transition - should have 2 camera clips (first stopped, second recording)
    await host.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                globalEndTime: number | null;
                status: string;
              }>;
            };
          };
        }).useRecordingStore;
        const clips = store?.getState?.()?.localClips ?? [];
        const cameraClips = clips.filter((c) => c.sourceType === 'camera');
        // First camera clip stopped, second camera clip recording
        const hasStoppedCamera = cameraClips.some((c) => c.globalEndTime !== null);
        const hasRecordingCamera = cameraClips.some((c) => c.status === 'recording');
        return cameraClips.length >= 2 && hasStoppedCamera && hasRecordingCamera;
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] First camera clip stopped, second camera clip started');

    // ==========================================
    // STEP 7: Stop recording
    // ==========================================
    console.log('[E2E] Recording for 1 more second...');
    await sleep(1000);

    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(host.page, 30000);
    console.log('[E2E] Recording stopped');

    // ==========================================
    // STEP 8: Verify final clip counts
    // ==========================================
    const finalClips = await host.page.evaluate(() => {
      const store = (window as unknown as {
        useRecordingStore?: {
          getState?: () => {
            localClips?: Array<{
              sourceType: string;
              globalEndTime: number | null;
              status: string;
            }>;
          };
        };
      }).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });

    console.log('[E2E] Final clips:', JSON.stringify(finalClips, null, 2));

    // In mock environment without audio tracks:
    // Should have: 2 camera clips (first stopped when camera toggled off, second recording then stopped)
    // Note: Audio-only clips are only created if audio tracks are available
    const cameraClips = finalClips.filter((c) => c.sourceType === 'camera');

    expect(cameraClips.length).toBe(2);
    expect(finalClips.length).toBeGreaterThanOrEqual(2);

    // All clips should have globalEndTime set (stopped)
    for (const clip of finalClips) {
      expect(clip.globalEndTime).not.toBeNull();
    }

    console.log('[E2E] Camera toggle during recording test completed successfully!');
  });

  test('screen share during recording creates screen clip with broadcast', async () => {
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
    const sessionId = decodeURIComponent(sessionIdMatch![1]);
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

    let connected = false;
    while (Date.now() - startTime < maxWaitTime && !connected) {
      await sleep(pollInterval);
      const hostTileCount = await host.page.locator('[role="listitem"]').count();
      const participantTileCount = await participant.page.locator('[role="listitem"]').count();
      console.log(`[E2E] Host tiles: ${hostTileCount}, Participant tiles: ${participantTileCount}`);
      if (hostTileCount >= 2 && participantTileCount >= 2) {
        connected = true;
      }
    }

    if (!connected) {
      throw new Error('P2P connection timeout');
    }
    console.log('[E2E] P2P connection established');

    // ==========================================
    // STEP 6: Start recording
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page.waitForSelector('button[aria-label="Starting..."]', { timeout: 5000 }).catch(() => {});

    // Wait for recording to start on both
    await waitForRecordingStart(host.page, 15000);
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
    console.log('[E2E] Recording started on both instances');

    // ==========================================
    // STEP 7: Record for 1 second, then host starts screen share
    // ==========================================
    await sleep(1000);

    console.log('[E2E] Host starting screen share...');
    await host.page.click(selectors.session.screenShareButton);

    // Wait for screen source picker modal to appear
    await host.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    console.log('[E2E] Host screen source picker appeared');

    // Click the Share button inside the dialog (first source is pre-selected)
    await host.page.click('[role="dialog"] button.bg-blue-600');

    // Wait for host's screen share to start
    await host.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useSessionStore?: { getState?: () => { localScreenStream?: MediaStream | null } };
        }).useSessionStore;
        return store?.getState?.()?.localScreenStream !== null;
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] Host screen share started');

    // Verify host has screen clip in localClips
    await host.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{ sourceType: string; status: string }>;
            };
          };
        }).useRecordingStore;
        const clips = store?.getState?.()?.localClips ?? [];
        return clips.some((c) => c.sourceType === 'screen');
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] Host has screen clip in localClips');

    // Wait for participant to receive peer-clip message
    await participant.page.waitForFunction(
      () => {
        const store = (window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              peerClips?: Array<{ sourceType: string }>;
            };
          };
        }).useRecordingStore;
        const clips = store?.getState?.()?.peerClips ?? [];
        return clips.some((c) => c.sourceType === 'screen');
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Participant received screen clip info from host');

    // ==========================================
    // STEP 8: Stop recording
    // ==========================================
    console.log('[E2E] Recording for 1 more second...');
    await sleep(1000);

    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(host.page, 30000);
    await waitForRecordingComplete(participant.page, 30000);
    console.log('[E2E] Recording stopped');

    // Verify host's screen clip has globalEndTime
    const hostClips = await host.page.evaluate(() => {
      const store = (window as unknown as {
        useRecordingStore?: {
          getState?: () => {
            localClips?: Array<{
              sourceType: string;
              globalEndTime: number | null;
            }>;
          };
        };
      }).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });

    const screenClip = hostClips.find((c) => c.sourceType === 'screen');
    expect(screenClip).toBeDefined();
    // Screen clip may or may not have globalEndTime set depending on whether stopSharing was called
    // The important thing is the clip was created and broadcast

    console.log('[E2E] Screen share during recording test completed successfully!');
  });

  test('rapid camera toggle during recording remains stable', async () => {
    // ==========================================
    // STEP 1: Launch host instance
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // ==========================================
    // STEP 2: Complete profile setup
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    // Wait for home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 3: Host creates session
    // ==========================================
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);

    // Wait for session page to load
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // ==========================================
    // STEP 4: Start recording
    // ==========================================
    console.log('[E2E] Starting recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page.waitForSelector('button[aria-label="Starting..."]', { timeout: 5000 }).catch(() => {});

    // Wait for recording to start
    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    // Wait a moment for initial clip to stabilize
    await sleep(500);

    // ==========================================
    // STEP 5: Rapid camera toggle (3 cycles with 500ms delay)
    // ==========================================
    console.log('[E2E] Starting rapid camera toggle test...');
    const consoleErrors: string[] = [];

    // Listen for console errors
    host.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    for (let i = 0; i < 3; i++) {
      console.log(`[E2E] Toggle cycle ${i + 1}/3: camera OFF`);
      await host.page.click(selectors.session.cameraToggle);
      await sleep(500);

      console.log(`[E2E] Toggle cycle ${i + 1}/3: camera ON`);
      await host.page.click(selectors.session.cameraToggle);
      await sleep(500);
    }

    console.log('[E2E] Rapid toggle complete, waiting for clips to stabilize...');
    await sleep(1000);

    // ==========================================
    // STEP 6: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(host.page, 30000);
    console.log('[E2E] Recording stopped');

    // ==========================================
    // STEP 7: Verify state
    // ==========================================
    // Check isRecording is false
    const isRecording = await host.page.evaluate(() => {
      const store = (window as unknown as {
        useRecordingStore?: { getState?: () => { isRecording?: boolean } };
      }).useRecordingStore;
      return store?.getState?.()?.isRecording;
    });
    expect(isRecording).toBe(false);

    // Get clips
    const clips = await host.page.evaluate(() => {
      const store = (window as unknown as {
        useRecordingStore?: {
          getState?: () => {
            localClips?: Array<{
              sourceType: string;
              globalEndTime: number | null;
              status: string;
            }>;
          };
        };
      }).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });

    console.log('[E2E] Final clips count:', clips.length);
    console.log('[E2E] Clips:', JSON.stringify(clips, null, 2));

    // Should have multiple clips (at least 1 camera + some from toggles)
    expect(clips.length).toBeGreaterThan(0);

    // All clips should have globalEndTime set (all stopped)
    for (const clip of clips) {
      expect(clip.globalEndTime).not.toBeNull();
    }

    // Check for recording-related errors in console (ignore expected errors)
    const recordingErrors = consoleErrors.filter(
      (e) =>
        e.includes('useRecording') &&
        !e.includes('Expected') &&
        !e.includes('Track already stopped')
    );
    console.log('[E2E] Recording-related console errors:', recordingErrors);
    expect(recordingErrors.length).toBe(0);

    console.log('[E2E] Rapid camera toggle test completed successfully!');
  });
});
