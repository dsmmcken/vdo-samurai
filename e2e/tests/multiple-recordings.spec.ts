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

test.describe('Multiple Sequential Recordings', () => {
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

  test('host can record, discard, and record again in same session', async () => {
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
    // STEP 3: First recording
    // ==========================================
    console.log('[E2E] Starting first recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown to pass
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {
        // Countdown may have already finished
      });

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] First recording started');

    // Verify isRecording=true
    const stateAfterStart1 = await getRecordingState(host.page);
    expect(stateAfterStart1?.isRecording).toBe(true);

    // Record for 2 seconds
    await sleep(2000);

    // Stop recording
    console.log('[E2E] Stopping first recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete and blob to be available
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] First recording complete');

    // Verify we have a blob with data
    const stateAfterStop1 = await getRecordingState(host.page);
    expect(stateAfterStop1?.isRecording).toBe(false);
    expect(stateAfterStop1?.localBlob).toBeTruthy();
    expect(stateAfterStop1?.localBlob?.size).toBeGreaterThan(0);
    const firstBlobSize = stateAfterStop1?.localBlob?.size ?? 0;
    console.log('[E2E] First recording blob size:', firstBlobSize);

    // ==========================================
    // STEP 4: Editor should appear automatically
    // ==========================================
    console.log('[E2E] Waiting for NLE editor to appear...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE editor appeared');

    // Verify clips exist in the editor
    const clipCount1 = await host.page.locator(selectors.nle.timelineClip).count();
    console.log('[E2E] First recording clip count:', clipCount1);
    expect(clipCount1).toBeGreaterThan(0);

    // ==========================================
    // STEP 5: Discard first recording
    // ==========================================
    console.log('[E2E] Discarding first recording...');
    await host.page.click(selectors.nle.discardButton);

    // Wait for editor to disappear and session view to return
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 10000 });
    console.log('[E2E] Returned to session view after discard');

    // Verify recording store was reset
    const stateAfterDiscard = await getRecordingState(host.page);
    expect(stateAfterDiscard?.isRecording).toBe(false);
    expect(stateAfterDiscard?.localBlob).toBeNull();
    console.log('[E2E] Recording store reset confirmed');

    // ==========================================
    // STEP 6: Second recording
    // ==========================================
    console.log('[E2E] Starting second recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {
        // Countdown may have already finished
      });

    await waitForRecordingStart(host.page, 15000);
    console.log('[E2E] Second recording started');

    // Verify isRecording=true
    const stateAfterStart2 = await getRecordingState(host.page);
    expect(stateAfterStart2?.isRecording).toBe(true);

    // Record for 2 seconds
    await sleep(2000);

    // Stop second recording
    console.log('[E2E] Stopping second recording...');
    await host.page.click(selectors.session.stopButton);

    // Wait for recording to complete and blob to be available
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);
    console.log('[E2E] Second recording complete');

    // Verify second blob exists
    const stateAfterStop2 = await getRecordingState(host.page);
    expect(stateAfterStop2?.isRecording).toBe(false);
    expect(stateAfterStop2?.localBlob).toBeTruthy();
    expect(stateAfterStop2?.localBlob?.size).toBeGreaterThan(0);
    const secondBlobSize = stateAfterStop2?.localBlob?.size ?? 0;
    console.log('[E2E] Second recording blob size:', secondBlobSize);

    // ==========================================
    // STEP 7: Verify second recording enters editor
    // ==========================================
    console.log('[E2E] Waiting for NLE editor to appear for second recording...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] NLE editor appeared for second recording');

    // Verify clips exist in the editor for second recording
    const clipCount2 = await host.page.locator(selectors.nle.timelineClip).count();
    console.log('[E2E] Second recording clip count:', clipCount2);
    expect(clipCount2).toBeGreaterThan(0);

    console.log('[E2E] Multiple sequential recordings test passed!');
  });

  test('host can record twice with participant present', async () => {
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
    // STEP 3: First recording with participant
    // ==========================================
    console.log('[E2E] Starting first recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});

    await waitForRecordingStart(host.page, 15000);

    // Verify participant sees recording state
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
    console.log('[E2E] Both sides see first recording active');

    // Record for 2 seconds
    await sleep(2000);

    // Stop first recording
    console.log('[E2E] Stopping first recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);

    // Participant should see recording stopped
    await waitForRecordingComplete(participant.page, 30000);
    console.log('[E2E] First recording stopped on both sides');

    // ==========================================
    // STEP 4: Discard first recording from editor
    // ==========================================
    console.log('[E2E] Waiting for editor and discarding...');
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    await host.page.click(selectors.nle.discardButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 10000 });
    console.log('[E2E] First recording discarded');

    // ==========================================
    // STEP 5: Verify participant is still connected
    // ==========================================
    const participantTiles = await participant.page.locator('[role="listitem"]').count();
    console.log('[E2E] Participant tile count after discard:', participantTiles);
    expect(participantTiles).toBeGreaterThanOrEqual(2);

    const hostTiles = await host.page.locator('[role="listitem"]').count();
    console.log('[E2E] Host tile count after discard:', hostTiles);
    expect(hostTiles).toBeGreaterThanOrEqual(2);

    // ==========================================
    // STEP 6: Second recording with participant
    // ==========================================
    console.log('[E2E] Starting second recording...');
    await host.page.click(selectors.session.recordButton);

    // Wait for countdown
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});

    await waitForRecordingStart(host.page, 15000);

    // Verify participant sees second recording
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
    console.log('[E2E] Both sides see second recording active');

    // Record for 2 seconds
    await sleep(2000);

    // Stop second recording
    console.log('[E2E] Stopping second recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);

    // Participant should see recording stopped
    await waitForRecordingComplete(participant.page, 30000);
    console.log('[E2E] Second recording stopped on both sides');

    // ==========================================
    // STEP 7: Verify second recording has valid data
    // ==========================================
    const finalState = await getRecordingState(host.page);
    expect(finalState?.isRecording).toBe(false);
    expect(finalState?.localBlob).toBeTruthy();
    expect(finalState?.localBlob?.size).toBeGreaterThan(0);
    console.log('[E2E] Second recording blob size:', finalState?.localBlob?.size);

    // Verify NLE editor appears for second recording
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    const clipCount = await host.page.locator(selectors.nle.timelineClip).count();
    console.log('[E2E] Second recording clip count in editor:', clipCount);
    expect(clipCount).toBeGreaterThan(0);

    console.log('[E2E] Multiple recordings with participant test passed!');
  });

  test('recording state resets properly between sequential recordings', async () => {
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
    // STEP 2: Setup profile and create session
    // ==========================================
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // ==========================================
    // STEP 3: First recording - with camera toggle to create multiple clips
    // ==========================================
    console.log('[E2E] Starting first recording with camera toggle...');
    await host.page.click(selectors.session.recordButton);
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});
    await waitForRecordingStart(host.page, 15000);

    // Wait for initial clip to stabilize
    await sleep(1000);

    // Toggle camera off and on to create multiple clips
    console.log('[E2E] Toggling camera off...');
    await host.page.click(selectors.session.cameraToggle);
    await sleep(1000);

    console.log('[E2E] Toggling camera on...');
    await host.page.click(selectors.session.cameraToggle);
    await sleep(1000);

    // Stop first recording
    console.log('[E2E] Stopping first recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);

    // Check first recording had multiple clips
    const firstClips = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                globalEndTime: number | null;
                status: string;
              }>;
            };
          };
        }
      ).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });
    console.log('[E2E] First recording clip count:', firstClips.length);
    expect(firstClips.length).toBeGreaterThanOrEqual(2);

    // ==========================================
    // STEP 4: Discard from editor
    // ==========================================
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    await host.page.click(selectors.nle.discardButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 10000 });
    console.log('[E2E] First recording discarded');

    // Verify clips are cleared
    const clipsAfterDiscard = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<unknown>;
              peerClips?: Array<unknown>;
              localBlob?: Blob | null;
              isRecording?: boolean;
              globalClockStart?: number | null;
              globalClockEnd?: number | null;
            };
          };
        }
      ).useRecordingStore;
      const state = store?.getState?.();
      return {
        localClipCount: state?.localClips?.length ?? -1,
        peerClipCount: state?.peerClips?.length ?? -1,
        hasLocalBlob: !!state?.localBlob,
        isRecording: state?.isRecording,
        globalClockStart: state?.globalClockStart,
        globalClockEnd: state?.globalClockEnd,
      };
    });
    console.log('[E2E] State after discard:', clipsAfterDiscard);
    expect(clipsAfterDiscard.localClipCount).toBe(0);
    expect(clipsAfterDiscard.peerClipCount).toBe(0);
    expect(clipsAfterDiscard.hasLocalBlob).toBe(false);
    expect(clipsAfterDiscard.isRecording).toBe(false);
    expect(clipsAfterDiscard.globalClockStart).toBeNull();

    // ==========================================
    // STEP 5: Second recording - verify clean slate
    // ==========================================
    console.log('[E2E] Starting second recording...');
    await host.page.click(selectors.session.recordButton);
    await host.page
      .waitForSelector(selectors.session.startingButton, { timeout: 5000 })
      .catch(() => {});
    await waitForRecordingStart(host.page, 15000);

    // Verify fresh clip started
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as {
            useRecordingStore?: {
              getState?: () => {
                isRecording?: boolean;
                localClips?: Array<{ status: string }>;
              };
            };
          }
        ).useRecordingStore;
        const state = store?.getState?.();
        return (
          state?.isRecording === true &&
          (state?.localClips?.length ?? 0) >= 1 &&
          state?.localClips?.some((c) => c.status === 'recording')
        );
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] Second recording has fresh clip');

    // Record briefly
    await sleep(1500);

    // Stop second recording
    console.log('[E2E] Stopping second recording...');
    await host.page.click(selectors.session.stopButton);
    await waitForRecordingComplete(host.page, 30000);
    await waitForLocalBlob(host.page, 30000);

    // Verify second recording has its own clips (not leftover from first)
    const secondClips = await host.page.evaluate(() => {
      const store = (
        window as unknown as {
          useRecordingStore?: {
            getState?: () => {
              localClips?: Array<{
                sourceType: string;
                globalEndTime: number | null;
                status: string;
              }>;
            };
          };
        }
      ).useRecordingStore;
      return store?.getState?.()?.localClips ?? [];
    });
    console.log('[E2E] Second recording clips:', secondClips.length);

    // Second recording should have exactly 1 camera clip (no toggle this time)
    const secondCameraClips = secondClips.filter((c) => c.sourceType === 'camera');
    expect(secondCameraClips.length).toBe(1);

    // All clips should be stopped (have end time)
    for (const clip of secondClips) {
      expect(clip.globalEndTime).not.toBeNull();
    }

    // Verify editor appears
    await host.page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
    console.log('[E2E] Second recording editor appeared');

    console.log('[E2E] Recording state reset test passed!');
  });
});
