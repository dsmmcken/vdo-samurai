import { test, expect, Page } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingComplete,
  waitForLocalBlob,
  sleep,
} from '../helpers/wait-helpers';

/**
 * E2E tests for NLE editor preview playback controls
 *
 * Tests the play/pause functionality in the video editor:
 * - Play button starts playback and playhead advances
 * - Pause button stops playback
 * - Spacebar keyboard shortcut toggles play/pause
 * - Playback auto-stops when reaching the end of the timeline
 * - Skip forward/backward buttons adjust playhead by 5s
 * - Arrow key shortcuts for skip forward/backward
 */

// ==========================================
// Common Helper Functions
// ==========================================

/**
 * Helper to navigate to session as host
 */
async function setupSessionAsHost(page: Page, userName: string = 'Test User') {
  await page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
  await page.fill('#display-name', userName);
  await page.fill('#full-name', `${userName} Full`);
  await page.click('button:has-text("Continue")');
  await page.waitForSelector(selectors.home.title, { timeout: 10000 });
  await page.click(selectors.home.createRoomButton);
  await page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
}

/**
 * Helper to record for a given duration then wait for completion
 */
async function recordForDuration(page: Page, durationMs: number) {
  await page.click(selectors.session.recordButton);
  await expect(page.locator(selectors.session.stopButton)).toBeVisible({ timeout: 15000 });
  await sleep(durationMs);
  await page.click(selectors.session.stopButton);
  await waitForRecordingComplete(page, 30000);
  await waitForLocalBlob(page, 30000);
}

/**
 * Helper to wait for NLE Editor to open
 */
async function waitForNLEEditor(page: Page) {
  await page.waitForSelector(selectors.nle.editor, { timeout: 10000 });
}

/**
 * Helper to get NLE store state including isPlaying
 */
async function getNLEState(page: Page) {
  return page.evaluate(() => {
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
              trimStart: number;
              trimEnd: number;
              sourceType: string;
            }>;
            totalDuration?: number;
            selectedClipId?: string | null;
            playheadPosition?: number;
            isPlaying?: boolean;
          };
        }
      >
    ).__nleStore__;
    if (store?.getState) {
      const state = store.getState();
      return {
        clips: state.clips,
        totalDuration: state.totalDuration,
        selectedClipId: state.selectedClipId,
        playheadPosition: state.playheadPosition,
        isPlaying: state.isPlaying,
      };
    }
    return null;
  });
}

/**
 * Helper to set playhead position in the NLE store
 */
async function setPlayheadPosition(page: Page, positionMs: number) {
  await page.evaluate((pos) => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            setPlayheadPosition?: (pos: number) => void;
          };
        }
      >
    ).__nleStore__;
    store?.getState?.()?.setPlayheadPosition?.(pos);
  }, positionMs);
}

// ==========================================
// Test Suite: NLE Preview Playback
// ==========================================

test.describe('NLE Editor: Preview Playback', () => {
  let app: AppInstance;

  test.afterEach(async () => {
    if (app) {
      await closeApp(app);
    }
  });

  test('play button starts playback and playhead advances', async () => {
    app = await launchApp('nle-play-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Play Test User');

    // Record for 4 seconds to get a clip
    console.log('[NLE Playback] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    // Wait for NLE editor
    await waitForNLEEditor(page);
    await sleep(500);

    // Verify initial state: not playing, playhead at 0
    const initialState = await getNLEState(page);
    console.log('[NLE Playback] Initial state:', JSON.stringify({
      isPlaying: initialState?.isPlaying,
      playheadPosition: initialState?.playheadPosition,
      totalDuration: initialState?.totalDuration,
    }));
    expect(initialState).not.toBeNull();
    expect(initialState!.isPlaying).toBe(false);
    expect(initialState!.totalDuration).toBeGreaterThan(1000);

    // Verify play button is visible with "Play" title
    const playButton = page.locator(selectors.nle.playButton);
    await expect(playButton).toBeVisible();

    // Record initial playhead position
    const initialPosition = initialState!.playheadPosition ?? 0;

    // Click play button
    console.log('[NLE Playback] Clicking play button...');
    await page.click(selectors.nle.playPauseButton);
    await sleep(200);

    // Verify isPlaying is now true
    const playingState = await getNLEState(page);
    expect(playingState!.isPlaying).toBe(true);
    console.log('[NLE Playback] isPlaying:', playingState!.isPlaying);

    // Verify the pause button is now visible (title changed)
    const pauseButton = page.locator(selectors.nle.pauseButton);
    await expect(pauseButton).toBeVisible();

    // Wait a bit for playhead to advance
    await sleep(1000);

    // Verify playhead has moved forward
    const afterPlayState = await getNLEState(page);
    console.log('[NLE Playback] Playhead after 1s:', afterPlayState!.playheadPosition);
    expect(afterPlayState!.playheadPosition!).toBeGreaterThan(initialPosition);

    // Click pause button to stop
    await page.click(selectors.nle.playPauseButton);
    await sleep(200);

    // Verify isPlaying is now false
    const pausedState = await getNLEState(page);
    expect(pausedState!.isPlaying).toBe(false);

    // Verify play button is visible again
    await expect(playButton).toBeVisible();

    // Record position after pause
    const pausedPosition = pausedState!.playheadPosition!;

    // Wait briefly and verify playhead stopped
    await sleep(500);
    const afterPauseState = await getNLEState(page);
    // Allow small tolerance (1ms) for floating point
    expect(Math.abs(afterPauseState!.playheadPosition! - pausedPosition)).toBeLessThan(10);

    console.log('[NLE Playback] Play/pause button test passed!');
  });

  test('spacebar toggles play/pause', async () => {
    app = await launchApp('nle-space-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Space Key User');

    // Record for 4 seconds
    console.log('[NLE Spacebar] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    await waitForNLEEditor(page);
    await sleep(500);

    // Verify not playing initially
    const initialState = await getNLEState(page);
    expect(initialState!.isPlaying).toBe(false);

    // Press Space to start playback
    console.log('[NLE Spacebar] Pressing Space to play...');
    await page.keyboard.press('Space');
    await sleep(200);

    // Verify playing
    const playingState = await getNLEState(page);
    expect(playingState!.isPlaying).toBe(true);
    console.log('[NLE Spacebar] isPlaying after Space:', playingState!.isPlaying);

    // Wait for playhead to advance
    await sleep(800);

    // Verify playhead moved
    const afterPlayState = await getNLEState(page);
    expect(afterPlayState!.playheadPosition!).toBeGreaterThan(0);
    console.log('[NLE Spacebar] Playhead after playing:', afterPlayState!.playheadPosition);

    // Press Space to pause
    console.log('[NLE Spacebar] Pressing Space to pause...');
    await page.keyboard.press('Space');
    await sleep(200);

    // Verify paused
    const pausedState = await getNLEState(page);
    expect(pausedState!.isPlaying).toBe(false);
    console.log('[NLE Spacebar] isPlaying after second Space:', pausedState!.isPlaying);

    // Press Space again to resume
    console.log('[NLE Spacebar] Pressing Space to resume...');
    await page.keyboard.press('Space');
    await sleep(200);

    // Verify playing again
    const resumedState = await getNLEState(page);
    expect(resumedState!.isPlaying).toBe(true);

    // Clean up: pause
    await page.keyboard.press('Space');

    console.log('[NLE Spacebar] Spacebar toggle test passed!');
  });

  test('playback auto-stops at end of timeline', async () => {
    app = await launchApp('nle-autostop-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'AutoStop User');

    // Record for 3 seconds to have a short clip
    console.log('[NLE AutoStop] Recording for 3 seconds...');
    await recordForDuration(page, 3000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const totalDuration = initialState!.totalDuration!;
    console.log('[NLE AutoStop] Total duration:', totalDuration, 'ms');
    expect(totalDuration).toBeGreaterThan(0);

    // Set playhead near the end (500ms before end)
    const nearEndPosition = Math.max(0, totalDuration - 500);
    console.log('[NLE AutoStop] Setting playhead to:', nearEndPosition, 'ms (500ms before end)');
    await setPlayheadPosition(page, nearEndPosition);
    await sleep(100);

    // Start playback
    console.log('[NLE AutoStop] Starting playback near end...');
    await page.click(selectors.nle.playPauseButton);
    await sleep(200);

    // Verify playing
    const playingState = await getNLEState(page);
    expect(playingState!.isPlaying).toBe(true);

    // Wait for playback to reach the end (give extra buffer)
    await sleep(2000);

    // Verify playback auto-stopped
    const finalState = await getNLEState(page);
    console.log('[NLE AutoStop] Final state:', JSON.stringify({
      isPlaying: finalState!.isPlaying,
      playheadPosition: finalState!.playheadPosition,
      totalDuration: finalState!.totalDuration,
    }));
    expect(finalState!.isPlaying).toBe(false);

    // Playhead should be at or very near the end
    expect(finalState!.playheadPosition!).toBeGreaterThanOrEqual(totalDuration - 200);

    console.log('[NLE AutoStop] Auto-stop at end test passed!');
  });

  test('skip forward and backward buttons adjust playhead by 5 seconds', async () => {
    app = await launchApp('nle-skip-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Skip Test User');

    // Record for 6 seconds to have a clip longer than 5s
    console.log('[NLE Skip] Recording for 6 seconds...');
    await recordForDuration(page, 6000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const totalDuration = initialState!.totalDuration!;
    console.log('[NLE Skip] Total duration:', totalDuration, 'ms');
    expect(totalDuration).toBeGreaterThan(5000);

    // Set playhead to beginning
    await setPlayheadPosition(page, 0);
    await sleep(100);

    // Click skip forward
    console.log('[NLE Skip] Clicking skip forward...');
    await page.click(selectors.nle.skipForwardButton);
    await sleep(200);

    // Verify playhead moved forward by ~5000ms
    const afterForwardState = await getNLEState(page);
    console.log('[NLE Skip] Playhead after skip forward:', afterForwardState!.playheadPosition);
    expect(afterForwardState!.playheadPosition!).toBeGreaterThanOrEqual(4900);
    expect(afterForwardState!.playheadPosition!).toBeLessThanOrEqual(5100);

    // Click skip backward
    console.log('[NLE Skip] Clicking skip backward...');
    await page.click(selectors.nle.skipBackwardButton);
    await sleep(200);

    // Verify playhead moved back by ~5000ms (close to 0)
    const afterBackwardState = await getNLEState(page);
    console.log('[NLE Skip] Playhead after skip backward:', afterBackwardState!.playheadPosition);
    expect(afterBackwardState!.playheadPosition!).toBeLessThanOrEqual(200);

    console.log('[NLE Skip] Skip button test passed!');
  });

  test('arrow key shortcuts skip forward and backward', async () => {
    app = await launchApp('nle-arrow-keys-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Arrow Key User');

    // Record for 6 seconds
    console.log('[NLE Arrow Keys] Recording for 6 seconds...');
    await recordForDuration(page, 6000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const totalDuration = initialState!.totalDuration!;
    expect(totalDuration).toBeGreaterThan(5000);

    // Set playhead to beginning
    await setPlayheadPosition(page, 0);
    await sleep(100);

    // Press ArrowRight to skip forward
    console.log('[NLE Arrow Keys] Pressing ArrowRight...');
    await page.keyboard.press('ArrowRight');
    await sleep(200);

    // Verify playhead moved forward by ~5000ms
    const afterRightState = await getNLEState(page);
    console.log('[NLE Arrow Keys] Playhead after ArrowRight:', afterRightState!.playheadPosition);
    expect(afterRightState!.playheadPosition!).toBeGreaterThanOrEqual(4900);
    expect(afterRightState!.playheadPosition!).toBeLessThanOrEqual(5100);

    // Press ArrowLeft to skip backward
    console.log('[NLE Arrow Keys] Pressing ArrowLeft...');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);

    // Verify playhead moved back by ~5000ms (close to 0)
    const afterLeftState = await getNLEState(page);
    console.log('[NLE Arrow Keys] Playhead after ArrowLeft:', afterLeftState!.playheadPosition);
    expect(afterLeftState!.playheadPosition!).toBeLessThanOrEqual(200);

    // Verify playhead doesn't go below 0
    console.log('[NLE Arrow Keys] Pressing ArrowLeft at start...');
    await page.keyboard.press('ArrowLeft');
    await sleep(200);

    const atStartState = await getNLEState(page);
    expect(atStartState!.playheadPosition!).toBe(0);

    // Skip forward past the end to verify clamping
    // Set playhead near end, then skip forward
    await setPlayheadPosition(page, totalDuration - 1000);
    await sleep(100);

    console.log('[NLE Arrow Keys] Pressing ArrowRight near end...');
    await page.keyboard.press('ArrowRight');
    await sleep(200);

    const nearEndState = await getNLEState(page);
    console.log('[NLE Arrow Keys] Playhead after skip at end:', nearEndState!.playheadPosition);
    expect(nearEndState!.playheadPosition!).toBeLessThanOrEqual(totalDuration);

    console.log('[NLE Arrow Keys] Arrow key shortcuts test passed!');
  });

  test('play from end resets playhead to beginning', async () => {
    app = await launchApp('nle-play-from-end-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'PlayFromEnd User');

    // Record for 3 seconds
    console.log('[NLE PlayFromEnd] Recording for 3 seconds...');
    await recordForDuration(page, 3000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const totalDuration = initialState!.totalDuration!;
    console.log('[NLE PlayFromEnd] Total duration:', totalDuration, 'ms');

    // Set playhead to the very end
    await setPlayheadPosition(page, totalDuration);
    await sleep(100);

    // Verify playhead is at end
    const endState = await getNLEState(page);
    expect(endState!.playheadPosition!).toBeGreaterThanOrEqual(totalDuration - 100);

    // Click play -- should restart from beginning
    console.log('[NLE PlayFromEnd] Clicking play at end of timeline...');
    await page.click(selectors.nle.playPauseButton);
    await sleep(300);

    // Verify playing and playhead reset near beginning
    const playState = await getNLEState(page);
    expect(playState!.isPlaying).toBe(true);
    // The playhead should have been reset to 0 and then advanced slightly
    expect(playState!.playheadPosition!).toBeLessThan(1000);
    console.log(
      '[NLE PlayFromEnd] Playhead after play from end:',
      playState!.playheadPosition,
      '(should be near 0)'
    );

    // Stop playback
    await page.click(selectors.nle.playPauseButton);
    await sleep(200);

    const finalState = await getNLEState(page);
    expect(finalState!.isPlaying).toBe(false);

    console.log('[NLE PlayFromEnd] Play from end test passed!');
  });
});
