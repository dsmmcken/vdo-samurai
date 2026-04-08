import { test, expect, Page } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForRecordingComplete,
  waitForLocalBlob,
  sleep,
} from '../helpers/wait-helpers';

/**
 * E2E tests for NLE editor split and delete operations
 *
 * Tests the clip editing functionality:
 * - Splitting a clip at the playhead position
 * - Deleting a selected clip
 * - Keyboard shortcuts (S for split, Delete for delete)
 * - Verifying clip count and state after operations
 * - Split + delete workflow preserving remaining clips
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
 * Helper to get NLE store state
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

/**
 * Helper to select a clip in the NLE store
 */
async function selectClipById(page: Page, clipId: string) {
  await page.evaluate((id) => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            setSelectedClipId?: (id: string | null) => void;
          };
        }
      >
    ).__nleStore__;
    store?.getState?.()?.setSelectedClipId?.(id);
  }, clipId);
}

// ==========================================
// Test Suite: NLE Split & Delete
// ==========================================

test.describe('NLE Editor: Split and Delete', () => {
  let app: AppInstance;

  test.afterEach(async () => {
    if (app) {
      await closeApp(app);
    }
  });

  test('split clip at playhead creates two clips', async () => {
    app = await launchApp('nle-split-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Split Test User');

    // Record for 4 seconds to get a clip with enough duration to split
    console.log('[NLE Split] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    // Wait for NLE editor
    await waitForNLEEditor(page);
    await sleep(500); // Let state settle

    // Get initial state
    const initialState = await getNLEState(page);
    console.log('[NLE Split] Initial clips:', JSON.stringify(initialState?.clips, null, 2));
    expect(initialState).not.toBeNull();
    expect(initialState!.clips!.length).toBeGreaterThanOrEqual(1);

    const initialClipCount = initialState!.clips!.length;
    const firstClip = initialState!.clips![0];
    const firstClipDuration = firstClip.endTime - firstClip.startTime - firstClip.trimStart - firstClip.trimEnd;

    console.log('[NLE Split] First clip ID:', firstClip.id, 'duration:', firstClipDuration, 'ms');
    expect(firstClipDuration).toBeGreaterThan(1000); // Should be at least 1 second

    // Position the playhead at the midpoint of the first clip
    const midpoint = Math.floor(firstClipDuration / 2);
    console.log('[NLE Split] Setting playhead to midpoint:', midpoint, 'ms');
    await setPlayheadPosition(page, midpoint);

    // Select the first clip (by clicking on it in the timeline)
    const firstClipElement = page.locator(selectors.nle.timelineClip).first();
    await firstClipElement.click();
    await sleep(200);

    // Verify clip is selected
    const stateAfterSelect = await getNLEState(page);
    expect(stateAfterSelect?.selectedClipId).toBe(firstClip.id);
    console.log('[NLE Split] Clip selected:', stateAfterSelect?.selectedClipId);

    // Click the Split button
    const splitButton = page.locator(selectors.nle.splitButton);
    await expect(splitButton).toBeEnabled();
    await splitButton.click();
    await sleep(300);

    // Verify we now have one more clip
    const stateAfterSplit = await getNLEState(page);
    console.log('[NLE Split] Clips after split:', JSON.stringify(stateAfterSplit?.clips, null, 2));
    expect(stateAfterSplit).not.toBeNull();
    expect(stateAfterSplit!.clips!.length).toBe(initialClipCount + 1);

    // Verify the original clip was replaced by two clips with IDs derived from the original
    const splitClipA = stateAfterSplit!.clips!.find((c) => c.id === `${firstClip.id}-a`);
    const splitClipB = stateAfterSplit!.clips!.find((c) => c.id === `${firstClip.id}-b`);
    expect(splitClipA).toBeDefined();
    expect(splitClipB).toBeDefined();

    // Verify the two halves have the same peerName and sourceType
    expect(splitClipA!.peerName).toBe(firstClip.peerName);
    expect(splitClipB!.peerName).toBe(firstClip.peerName);
    expect(splitClipA!.sourceType).toBe(firstClip.sourceType);
    expect(splitClipB!.sourceType).toBe(firstClip.sourceType);

    // Verify ordering (clip A should come before clip B)
    expect(splitClipA!.order).toBeLessThan(splitClipB!.order);

    // Verify the DOM shows the correct number of clips
    const clipElements = page.locator(selectors.nle.timelineClip);
    await expect(clipElements).toHaveCount(initialClipCount + 1);

    // Verify clip count text
    const clipCountText = await page.locator(selectors.nle.clipCount).textContent();
    expect(clipCountText).toContain(`${initialClipCount + 1} clip`);

    console.log('[NLE Split] Split test passed!');
  });

  test('delete selected clip removes it from timeline', async () => {
    app = await launchApp('nle-delete-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Delete Test User');

    // Record for 4 seconds
    console.log('[NLE Delete] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    // Wait for NLE editor
    await waitForNLEEditor(page);
    await sleep(500);

    // Get initial state
    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const initialClipCount = initialState!.clips!.length;
    expect(initialClipCount).toBeGreaterThanOrEqual(1);
    console.log('[NLE Delete] Initial clip count:', initialClipCount);

    // First, split the clip so we have multiple clips to work with
    const firstClip = initialState!.clips![0];
    const duration = firstClip.endTime - firstClip.startTime - firstClip.trimStart - firstClip.trimEnd;
    const midpoint = Math.floor(duration / 2);

    // Set playhead and select clip
    await setPlayheadPosition(page, midpoint);
    const firstClipElement = page.locator(selectors.nle.timelineClip).first();
    await firstClipElement.click();
    await sleep(200);

    // Split to create two clips
    await page.locator(selectors.nle.splitButton).click();
    await sleep(300);

    const stateAfterSplit = await getNLEState(page);
    const splitClipCount = stateAfterSplit!.clips!.length;
    expect(splitClipCount).toBe(initialClipCount + 1);
    console.log('[NLE Delete] Clips after split:', splitClipCount);

    // Select the first clip (the "a" half from the split)
    const clipToDelete = stateAfterSplit!.clips![0];
    const clipToDeleteId = clipToDelete.id;
    console.log('[NLE Delete] Will delete clip:', clipToDeleteId);

    // Click the first clip to select it
    const targetClip = page.locator(selectors.nle.timelineClip).first();
    await targetClip.click();
    await sleep(200);

    // Verify it's selected
    const stateBeforeDelete = await getNLEState(page);
    expect(stateBeforeDelete?.selectedClipId).toBe(clipToDeleteId);

    // Click the Delete button
    const deleteButton = page.locator(selectors.nle.deleteButton);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await sleep(300);

    // Verify clip was removed
    const stateAfterDelete = await getNLEState(page);
    console.log('[NLE Delete] Clips after delete:', JSON.stringify(stateAfterDelete?.clips, null, 2));
    expect(stateAfterDelete!.clips!.length).toBe(splitClipCount - 1);

    // Verify the deleted clip no longer exists
    const deletedClip = stateAfterDelete!.clips!.find((c) => c.id === clipToDeleteId);
    expect(deletedClip).toBeUndefined();

    // Verify selection was cleared
    expect(stateAfterDelete?.selectedClipId).toBeNull();

    // Verify remaining clips have proper order values (0-indexed, sequential)
    const orders = stateAfterDelete!.clips!.map((c) => c.order).sort((a, b) => a - b);
    orders.forEach((order, index) => {
      expect(order).toBe(index);
    });

    // Verify DOM matches
    const clipElements = page.locator(selectors.nle.timelineClip);
    await expect(clipElements).toHaveCount(splitClipCount - 1);

    console.log('[NLE Delete] Delete test passed!');
  });

  test('keyboard shortcut S splits selected clip', async () => {
    app = await launchApp('nle-keyboard-split-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Keyboard Split User');

    // Record for 4 seconds
    console.log('[NLE Keyboard Split] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const initialClipCount = initialState!.clips!.length;
    const firstClip = initialState!.clips![0];
    const duration = firstClip.endTime - firstClip.startTime - firstClip.trimStart - firstClip.trimEnd;

    // Position playhead at 1/3 through the clip
    const splitPos = Math.floor(duration / 3);
    console.log('[NLE Keyboard Split] Playhead at:', splitPos, 'ms');
    await setPlayheadPosition(page, splitPos);

    // Select the clip
    await page.locator(selectors.nle.timelineClip).first().click();
    await sleep(200);

    // Verify clip is selected
    const stateBeforeSplit = await getNLEState(page);
    expect(stateBeforeSplit?.selectedClipId).toBe(firstClip.id);

    // Press S to split
    console.log('[NLE Keyboard Split] Pressing S key...');
    await page.keyboard.press('s');
    await sleep(300);

    // Verify split happened
    const stateAfterSplit = await getNLEState(page);
    console.log('[NLE Keyboard Split] Clips after keyboard split:', stateAfterSplit?.clips?.length);
    expect(stateAfterSplit!.clips!.length).toBe(initialClipCount + 1);

    // Verify the two new clips exist
    const clipA = stateAfterSplit!.clips!.find((c) => c.id === `${firstClip.id}-a`);
    const clipB = stateAfterSplit!.clips!.find((c) => c.id === `${firstClip.id}-b`);
    expect(clipA).toBeDefined();
    expect(clipB).toBeDefined();

    console.log('[NLE Keyboard Split] Keyboard split test passed!');
  });

  test('keyboard shortcut Delete removes selected clip', async () => {
    app = await launchApp('nle-keyboard-delete-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Keyboard Delete User');

    // Record for 4 seconds
    console.log('[NLE Keyboard Delete] Recording for 4 seconds...');
    await recordForDuration(page, 4000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const initialClipCount = initialState!.clips!.length;

    // First split so we have multiple clips
    const firstClip = initialState!.clips![0];
    const duration = firstClip.endTime - firstClip.startTime - firstClip.trimStart - firstClip.trimEnd;
    await setPlayheadPosition(page, Math.floor(duration / 2));
    await page.locator(selectors.nle.timelineClip).first().click();
    await sleep(200);
    await page.keyboard.press('s');
    await sleep(300);

    const stateAfterSplit = await getNLEState(page);
    const splitClipCount = stateAfterSplit!.clips!.length;
    expect(splitClipCount).toBe(initialClipCount + 1);

    // Select the second clip (clip B)
    const clipB = stateAfterSplit!.clips!.find((c) => c.id === `${firstClip.id}-b`);
    expect(clipB).toBeDefined();

    // Click the second timeline clip to select it
    const secondClipElement = page.locator(selectors.nle.timelineClip).nth(1);
    await secondClipElement.click();
    await sleep(200);

    const stateBeforeDelete = await getNLEState(page);
    expect(stateBeforeDelete?.selectedClipId).toBe(clipB!.id);
    console.log('[NLE Keyboard Delete] Selected clip for deletion:', clipB!.id);

    // Press Delete key
    console.log('[NLE Keyboard Delete] Pressing Delete key...');
    await page.keyboard.press('Delete');
    await sleep(300);

    // Verify deletion
    const stateAfterDelete = await getNLEState(page);
    expect(stateAfterDelete!.clips!.length).toBe(splitClipCount - 1);
    expect(stateAfterDelete!.clips!.find((c) => c.id === clipB!.id)).toBeUndefined();
    expect(stateAfterDelete?.selectedClipId).toBeNull();

    console.log('[NLE Keyboard Delete] Keyboard delete test passed!');
  });

  test('split then delete preserves remaining clips with correct ordering', async () => {
    app = await launchApp('nle-split-delete-workflow-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Workflow User');

    // Record for 5 seconds for a longer clip to split multiple times
    console.log('[NLE Workflow] Recording for 5 seconds...');
    await recordForDuration(page, 5000);

    await waitForNLEEditor(page);
    await sleep(500);

    const initialState = await getNLEState(page);
    expect(initialState).not.toBeNull();
    const initialClipCount = initialState!.clips!.length;
    const firstClip = initialState!.clips![0];
    const fullDuration =
      firstClip.endTime - firstClip.startTime - firstClip.trimStart - firstClip.trimEnd;

    console.log('[NLE Workflow] Initial clip duration:', fullDuration, 'ms');

    // Step 1: Split the clip at 1/3 to create clip-a and clip-b
    const firstSplitPos = Math.floor(fullDuration / 3);
    console.log('[NLE Workflow] First split at position:', firstSplitPos, 'ms');
    await setPlayheadPosition(page, firstSplitPos);
    await page.locator(selectors.nle.timelineClip).first().click();
    await sleep(200);
    await page.locator(selectors.nle.splitButton).click();
    await sleep(300);

    const stateAfterSplit1 = await getNLEState(page);
    expect(stateAfterSplit1!.clips!.length).toBe(initialClipCount + 1);
    console.log('[NLE Workflow] After first split:', stateAfterSplit1!.clips!.length, 'clips');

    // Step 2: Split the second clip (clip-b) to get clip-b-a and clip-b-b
    // The second clip is now at index 1
    const clipB = stateAfterSplit1!.clips!.find((c) => c.id === `${firstClip.id}-b`);
    expect(clipB).toBeDefined();
    const clipBDuration = clipB!.endTime - clipB!.startTime - clipB!.trimStart - clipB!.trimEnd;

    // Calculate accumulated position: first clip (clip-a) duration + half of clip-b
    const clipA = stateAfterSplit1!.clips!.find((c) => c.id === `${firstClip.id}-a`);
    const clipADuration = clipA!.endTime - clipA!.startTime - clipA!.trimStart - clipA!.trimEnd;
    const secondSplitPos = clipADuration + Math.floor(clipBDuration / 2);

    console.log('[NLE Workflow] Second split at position:', secondSplitPos, 'ms');
    await setPlayheadPosition(page, secondSplitPos);

    // Select clip-b by clicking on it
    await selectClipById(page, clipB!.id);
    await sleep(200);

    // Verify selection
    const stateBeforeSplit2 = await getNLEState(page);
    expect(stateBeforeSplit2?.selectedClipId).toBe(clipB!.id);

    await page.keyboard.press('s');
    await sleep(300);

    const stateAfterSplit2 = await getNLEState(page);
    expect(stateAfterSplit2!.clips!.length).toBe(initialClipCount + 2);
    console.log('[NLE Workflow] After second split:', stateAfterSplit2!.clips!.length, 'clips');

    // We should now have 3 clips (for the original 1):
    // clip-a, clip-b-a, clip-b-b
    const clipBA = stateAfterSplit2!.clips!.find((c) => c.id === `${firstClip.id}-b-a`);
    const clipBB = stateAfterSplit2!.clips!.find((c) => c.id === `${firstClip.id}-b-b`);
    expect(clipBA).toBeDefined();
    expect(clipBB).toBeDefined();

    // Step 3: Delete the middle clip (clip-b-a) -- this simulates removing an unwanted segment
    console.log('[NLE Workflow] Deleting middle clip:', clipBA!.id);
    await selectClipById(page, clipBA!.id);
    await sleep(200);

    // Verify it's selected
    const stateBeforeDelete = await getNLEState(page);
    expect(stateBeforeDelete?.selectedClipId).toBe(clipBA!.id);

    await page.keyboard.press('Delete');
    await sleep(300);

    const stateAfterDelete = await getNLEState(page);
    expect(stateAfterDelete!.clips!.length).toBe(initialClipCount + 1);

    // Verify the middle clip is gone
    expect(stateAfterDelete!.clips!.find((c) => c.id === clipBA!.id)).toBeUndefined();

    // Verify the remaining clips have sequential order values
    const remainingClips = stateAfterDelete!.clips!.sort((a, b) => a.order - b.order);
    console.log(
      '[NLE Workflow] Remaining clips:',
      remainingClips.map((c) => ({ id: c.id, order: c.order }))
    );

    for (let i = 0; i < remainingClips.length; i++) {
      expect(remainingClips[i].order).toBe(i);
    }

    // Verify clip-a and clip-b-b still exist
    expect(stateAfterDelete!.clips!.find((c) => c.id === `${firstClip.id}-a`)).toBeDefined();
    expect(stateAfterDelete!.clips!.find((c) => c.id === `${firstClip.id}-b-b`)).toBeDefined();

    // Verify total duration decreased (middle segment was removed)
    // Recalculate total duration after delete
    await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              calculateTotalDuration?: () => void;
            };
          }
        >
      ).__nleStore__;
      store?.getState?.()?.calculateTotalDuration?.();
    });

    const finalState = await getNLEState(page);
    console.log(
      '[NLE Workflow] Original duration:',
      initialState!.totalDuration,
      'Final duration:',
      finalState!.totalDuration
    );
    expect(finalState!.totalDuration!).toBeLessThan(initialState!.totalDuration!);

    // Verify DOM matches the store state
    const clipElements = page.locator(selectors.nle.timelineClip);
    await expect(clipElements).toHaveCount(stateAfterDelete!.clips!.length);

    console.log('[NLE Workflow] Split-then-delete workflow test passed!');
  });

  test('split button is disabled when no clip is selected', async () => {
    app = await launchApp('nle-split-disabled-' + Date.now());
    const { page } = app;

    await setupSessionAsHost(page, 'Disabled Button User');

    // Record for 3 seconds
    console.log('[NLE Disabled] Recording...');
    await recordForDuration(page, 3000);

    await waitForNLEEditor(page);
    await sleep(500);

    // Ensure no clip is selected (click empty area of timeline)
    await selectClipById(page, '');

    // Clear selection by setting null explicitly
    await page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              setSelectedClipId?: (id: string | null) => void;
            };
          }
        >
      ).__nleStore__;
      store?.getState?.()?.setSelectedClipId?.(null);
    });
    await sleep(200);

    // Verify Split button is disabled
    const splitButton = page.locator(selectors.nle.splitButton);
    await expect(splitButton).toBeDisabled();
    console.log('[NLE Disabled] Split button is disabled when no clip selected');

    // Verify Delete button is disabled
    const deleteButton = page.locator(selectors.nle.deleteButton);
    await expect(deleteButton).toBeDisabled();
    console.log('[NLE Disabled] Delete button is disabled when no clip selected');

    // Now select a clip and verify buttons become enabled
    const clipElement = page.locator(selectors.nle.timelineClip).first();
    await clipElement.click();
    await sleep(200);

    await expect(splitButton).toBeEnabled();
    await expect(deleteButton).toBeEnabled();
    console.log('[NLE Disabled] Both buttons enabled after selecting a clip');

    console.log('[NLE Disabled] Button state test passed!');
  });
});
