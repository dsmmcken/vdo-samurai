import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession, startScreenShare } from '../helpers/test-setup';
import {
  sleep,
  waitForRecordingStart,
  waitForRecordingComplete,
  waitForLocalBlob,
  waitForLocalScreenShare,
} from '../helpers/wait-helpers';
import { getRecordingState, getLocalStreamState } from '../helpers/store-helpers';

test.describe('Recording With Screen Share', () => {
  let host: AppInstance;

  test.afterEach(async () => {
    if (host) {
      await closeApp(host);
    }
  });

  test('recording with active screen share produces both camera and screen blobs', async () => {
    // ==========================================
    // STEP 1: Launch host instance
    // ==========================================
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

    // ==========================================
    // STEP 2: Complete profile setup and create session
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // ==========================================
    // STEP 3: Start screen share before recording
    // ==========================================
    console.log('[E2E] Starting screen share...');
    await startScreenShare(host.page);
    console.log('[E2E] Screen share started');

    // Verify screen share is active in session store
    const streamState = await getLocalStreamState(host.page);
    expect(streamState?.hasLocalStream).toBe(true);
    expect(streamState?.hasLocalScreenStream).toBe(true);
    console.log('[E2E] Confirmed camera and screen streams are active');

    // Verify the screen share button shows active state
    const stopScreenButton = host.page.locator('button[aria-label="Stop sharing screen"]');
    await expect(stopScreenButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Screen share button shows active state');

    // ==========================================
    // STEP 4: Start recording with screen share active
    // ==========================================
    console.log('[E2E] Starting recording with screen share active...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown to pass
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {
        // Countdown may have already finished
      });

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started');

    // Verify isRecording=true
    const stateAfterStart = await getRecordingState(host.page);
    expect(stateAfterStart?.isRecording).toBe(true);

    // ==========================================
    // STEP 5: Verify clips are being recorded for both camera and screen
    // ==========================================
    // Wait for clips to be registered in the store
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            useRecordingStore?: {
              getState?: () => {
                localClips?: Array<{
                  sourceType: string;
                  status: string;
                }>;
                screenRecordingId?: string | null;
              };
            };
          }
        ).useRecordingStore;
        const state = store?.getState?.();
        const cameraClips =
          state?.localClips?.filter(
            (c) => c.sourceType === 'camera' && c.status === 'recording'
          ) ?? [];
        const hasScreenRecording = !!state?.screenRecordingId;
        return cameraClips.length >= 1 && hasScreenRecording;
      },
      undefined,
      { timeout: 15000 }
    );
    console.log('[E2E] Both camera and screen recordings are active');

    // Record for 3 seconds to accumulate meaningful data
    await sleep(3000);

    // ==========================================
    // STEP 6: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete and camera blob to be available
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] Recording stopped, camera blob available');

    // ==========================================
    // STEP 7: Wait for screen blob to be available
    // ==========================================
    console.log('[E2E] Waiting for screen blob...');
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            useRecordingStore?: {
              getState?: () => {
                localScreenBlob?: Blob | null;
              };
            };
          }
        ).useRecordingStore;
        const state = store?.getState?.();
        return state?.localScreenBlob !== null && state?.localScreenBlob !== undefined;
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Screen blob available');

    // ==========================================
    // STEP 8: Verify both blobs exist and have data
    // ==========================================
    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    expect(finalState?.localScreenBlob).toBeTruthy();
    expect(finalState?.localScreenBlob?.size).toBeGreaterThan(0);
    console.log(
      '[E2E] Camera blob size:',
      finalState?.localBlob?.size,
      'Screen blob size:',
      finalState?.localScreenBlob?.size
    );

    // ==========================================
    // STEP 9: Verify local clips include both camera and screen source types
    // ==========================================
    const clips = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                status: string;
                globalStartTime: number;
                globalEndTime: number | null;
              }>;
            };
          };
        }
      ).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });

    const cameraClips = clips.filter((c) => c.sourceType === 'camera');
    const screenClips = clips.filter((c) => c.sourceType === 'screen');

    console.log('[E2E] Camera clips:', cameraClips.length, 'Screen clips:', screenClips.length);
    expect(cameraClips.length).toBeGreaterThanOrEqual(1);
    expect(screenClips.length).toBeGreaterThanOrEqual(1);

    // Verify all clips have end times (recording is stopped)
    for (const clip of clips) {
      expect(clip.globalEndTime).not.toBeNull();
    }
    console.log('[E2E] All clips have end times');

    // ==========================================
    // STEP 10: Verify NLE editor shows clips from both sources
    // ==========================================
    console.log('[E2E] Waiting for NLE editor to appear...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE editor appeared');

    // Verify timeline clips exist
    const timelineClipCount = await host.page.locator(selectors.nle.timelineClip).count();
    console.log('[E2E] Timeline clip count:', timelineClipCount);
    // Should have at least 2 clips: one camera, one screen
    expect(timelineClipCount).toBeGreaterThanOrEqual(2);

    console.log('[E2E] Recording with screen share test passed!');
  });

  test('screen share started mid-recording produces screen blob', async () => {
    // ==========================================
    // STEP 1: Launch host instance
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore
      }
    });

    // ==========================================
    // STEP 2: Complete profile setup and create session
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Verify no screen share initially
    const initialStreamState = await getLocalStreamState(host.page);
    expect(initialStreamState?.hasLocalScreenStream).toBe(false);
    console.log('[E2E] Confirmed no screen share initially');

    // ==========================================
    // STEP 3: Start recording WITHOUT screen share
    // ==========================================
    console.log('[E2E] Starting recording without screen share...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Recording started (camera only)');

    // Record for 2 seconds with camera only
    await sleep(2000);

    // Verify only camera clip is active, no screen recording yet
    const midRecordingClips = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{ sourceType: string; status: string }>;
              screenRecordingId?: string | null;
            };
          };
        }
      ).useRecordingStore;
      const state = store?.getState?.();
      return {
        clips: state?.localClips ?? [],
        screenRecordingId: state?.screenRecordingId,
      };
    });

    const cameraOnly = midRecordingClips.clips.filter((c) => c.sourceType === 'camera');
    expect(cameraOnly.length).toBeGreaterThanOrEqual(1);
    expect(midRecordingClips.screenRecordingId).toBeFalsy();
    console.log('[E2E] Confirmed camera-only recording in progress');

    // ==========================================
    // STEP 4: Start screen share while recording is active
    // ==========================================
    console.log('[E2E] Starting screen share mid-recording...');
    await startScreenShare(host.page);
    await waitForLocalScreenShare(host.page, 10000);
    console.log('[E2E] Screen share started mid-recording');

    // Wait for screen recording to be registered
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            useRecordingStore?: {
              getState?: () => {
                screenRecordingId?: string | null;
              };
            };
          }
        ).useRecordingStore;
        return !!store?.getState?.()?.screenRecordingId;
      },
      undefined,
      { timeout: 15000 }
    );
    console.log('[E2E] Screen recording registered in store');

    // Record for 3 seconds with both camera and screen
    await sleep(3000);

    // ==========================================
    // STEP 5: Stop recording
    // ==========================================
    console.log('[E2E] Stopping recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] Recording stopped, camera blob available');

    // Wait for screen blob
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            useRecordingStore?: {
              getState?: () => {
                localScreenBlob?: Blob | null;
              };
            };
          }
        ).useRecordingStore;
        const state = store?.getState?.();
        return state?.localScreenBlob !== null && state?.localScreenBlob !== undefined;
      },
      undefined,
      { timeout: 30000 }
    );
    console.log('[E2E] Screen blob available');

    // ==========================================
    // STEP 6: Verify both blobs exist
    // ==========================================
    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    expect(finalState?.localScreenBlob).toBeTruthy();
    expect(finalState?.localScreenBlob?.size).toBeGreaterThan(0);
    console.log(
      '[E2E] Camera blob size:',
      finalState?.localBlob?.size,
      'Screen blob size:',
      finalState?.localScreenBlob?.size
    );

    // ==========================================
    // STEP 7: Verify clips have both camera and screen types
    // ==========================================
    const allClips = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                status: string;
                globalStartTime: number;
                globalEndTime: number | null;
              }>;
            };
          };
        }
      ).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });

    const cameraClips = allClips.filter((c) => c.sourceType === 'camera');
    const screenClips = allClips.filter((c) => c.sourceType === 'screen');

    console.log('[E2E] Camera clips:', cameraClips.length, 'Screen clips:', screenClips.length);
    expect(cameraClips.length).toBeGreaterThanOrEqual(1);
    expect(screenClips.length).toBeGreaterThanOrEqual(1);

    // Screen clip should have started after the camera clip
    // (since screen share was started mid-recording)
    const firstCameraStart = cameraClips[0].globalStartTime;
    const firstScreenStart = screenClips[0].globalStartTime;
    expect(firstScreenStart).toBeGreaterThan(firstCameraStart);
    console.log(
      '[E2E] Screen clip started after camera clip (camera:',
      firstCameraStart,
      'screen:',
      firstScreenStart,
      ')'
    );

    // ==========================================
    // STEP 8: Verify NLE editor appears with clips
    // ==========================================
    console.log('[E2E] Waiting for NLE editor...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });

    const timelineClipCount = await host.page.locator(selectors.nle.timelineClip).count();
    console.log('[E2E] Timeline clip count:', timelineClipCount);
    expect(timelineClipCount).toBeGreaterThanOrEqual(2);

    console.log('[E2E] Screen share mid-recording test passed!');
  });
});
