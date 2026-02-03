import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';

/**
 * E2E tests for Transfer Indicator persistence
 *
 * These tests verify that the transfer indicator:
 * 1. Appears when transfers are added to the store
 * 2. Persists after transfers complete (doesn't flash away)
 * 3. Can be dismissed manually via popover
 */

// Helper type for transfer data (matches Transfer interface in transferStore.ts)
interface MockTransfer {
  id: string;
  peerId: string;
  peerName: string;
  filename: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'complete' | 'error';
  direction: 'send' | 'receive';
  // Extended fields for broadcast status (used by TransferRacePopover)
  role?: 'sender' | 'receiver' | 'observer';
  senderId?: string;
  senderName?: string;
  receiverId?: string;
  receiverName?: string;
}

test.describe('Transfer Indicator Persistence', () => {
  let app: AppInstance;

  test.beforeEach(async () => {
    app = await launchApp('transfer-test-' + Date.now());

    // Handle any dialogs (like beforeunload confirmations) automatically
    app.page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
  });

  test.afterEach(async () => {
    if (app) {
      // Clear any pending transfers to avoid beforeunload dialogs
      try {
        await app.page.evaluate(() => {
          type StoreType = {
            getState: () => { reset: () => void };
          };
          const store = (window as Window & { __transferStore__?: StoreType }).__transferStore__;
          if (store) {
            store.getState().reset();
          }
        });
      } catch {
        // Ignore errors during cleanup
      }

      await closeApp(app);
    }
  });

  /**
   * Helper to inject mock transfers into the store via exposed __transferStore__
   */
  async function injectTransfers(page: typeof app.page, transfers: MockTransfer[]) {
    return await page.evaluate((transferData) => {
      type StoreType = {
        getState: () => { setTransfers: (t: unknown[]) => void };
      };
      const store = (window as Window & { __transferStore__?: StoreType }).__transferStore__;
      if (store) {
        store.getState().setTransfers(transferData);
        return true;
      }
      return false;
    }, transfers);
  }

  /**
   * Helper to get current transfer state from store
   */
  async function getTransferState(page: typeof app.page) {
    return await page.evaluate(() => {
      type StoreType = {
        getState: () => {
          transfers: unknown[];
          hasHadTransfers: boolean;
          indicatorDismissed: boolean;
        };
      };
      const store = (window as Window & { __transferStore__?: StoreType }).__transferStore__;
      if (store) {
        const state = store.getState();
        return {
          transferCount: state.transfers.length,
          hasHadTransfers: state.hasHadTransfers,
          indicatorDismissed: state.indicatorDismissed,
        };
      }
      return null;
    });
  }

  /**
   * Helper to navigate to session page
   */
  async function navigateToSession(page: typeof app.page) {
    // Wait for welcome screen
    await page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });

    // Setup profile
    await page.fill('#display-name', 'Test User');
    await page.fill('#full-name', 'Test User Full');
    await page.click('button:has-text("Continue")');

    // Wait for home page
    await page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Create a room
    await page.click(selectors.home.createRoomButton);

    // Wait for session page
    await page.waitForURL(/\/session\//);
    await page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });
  }

  test('indicator appears when transfers are injected', async () => {
    const { page } = app;
    await navigateToSession(page);

    const indicator = page.locator('button[aria-label="File transfers"]');
    // Note: Indicator is visible for host in session (to see the race), but without active transfers
    // The indicator is always visible now for hosts, so we just verify the store state

    // Verify store is accessible
    const initialState = await getTransferState(page);
    expect(initialState).not.toBeNull();
    expect(initialState?.transferCount).toBe(0);
    expect(initialState?.hasHadTransfers).toBe(false);

    // Inject an active transfer (with extended fields for popover support)
    const injected = await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Test Peer',
        filename: 'camera-recording-123.webm',
        size: 10 * 1024 * 1024,
        progress: 0.5,
        status: 'active',
        direction: 'send',
        role: 'sender',
        senderId: 'self',
        senderName: 'Test User',
        receiverId: 'peer-123',
        receiverName: 'Test Peer',
      },
    ]);

    expect(injected).toBe(true);

    // Indicator should be visible
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Popover auto-opens when transfers start - close it first to verify button state
    const closeButton = page.locator('button:has-text("Close")');
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(300);
    }

    // Verify it shows progress after transfer is injected (50% shows as "50%")
    await expect(indicator.locator('text=50%')).toBeVisible();
  });

  test('indicator persists after transfer completes - does not flash away', async () => {
    const { page } = app;
    await navigateToSession(page);

    const indicator = page.locator('button[aria-label="File transfers"]');

    // Inject an active transfer
    await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Test Peer',
        filename: 'camera-recording-123.webm',
        size: 10 * 1024 * 1024,
        progress: 0.5,
        status: 'active',
        direction: 'send',
        role: 'sender',
        senderId: 'self',
        senderName: 'Test User',
        receiverId: 'peer-123',
        receiverName: 'Test Peer',
      },
    ]);

    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Complete the transfer
    await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Test Peer',
        filename: 'camera-recording-123.webm',
        size: 10 * 1024 * 1024,
        progress: 1,
        status: 'complete',
        direction: 'send',
        role: 'sender',
        senderId: 'self',
        senderName: 'Test User',
        receiverId: 'peer-123',
        receiverName: 'Test Peer',
      },
    ]);

    // Indicator should still be visible showing "Done"
    await expect(indicator).toBeVisible();
    await expect(page.locator('text=Done')).toBeVisible();

    // CRITICAL: Wait and verify it doesn't disappear
    await page.waitForTimeout(2000);
    await expect(indicator).toBeVisible();

    // Verify state shows hasHadTransfers is true
    const state = await getTransferState(page);
    expect(state?.hasHadTransfers).toBe(true);
    expect(state?.indicatorDismissed).toBe(false);
  });

  test('indicator persists even when transfers array is cleared', async () => {
    const { page } = app;
    await navigateToSession(page);

    const indicator = page.locator('button[aria-label="File transfers"]');

    // Inject and complete a transfer
    await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Test Peer',
        filename: 'test.webm',
        size: 5 * 1024 * 1024,
        progress: 1,
        status: 'complete',
        direction: 'send',
        role: 'sender',
        senderId: 'self',
        senderName: 'Test User',
        receiverId: 'peer-123',
        receiverName: 'Test Peer',
      },
    ]);

    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Check state before clearing
    const stateBefore = await getTransferState(page);
    expect(stateBefore?.hasHadTransfers).toBe(true);

    // Clear transfers (simulating what happens on hook unmount)
    await injectTransfers(page, []);

    // Wait a moment
    await page.waitForTimeout(1000);

    // Indicator should STILL be visible due to hasHadTransfers flag
    await expect(indicator).toBeVisible();

    // Verify the hasHadTransfers flag is still true
    const stateAfter = await getTransferState(page);
    expect(stateAfter?.hasHadTransfers).toBe(true);
  });

  test('indicator can be dismissed via popover', async () => {
    const { page } = app;
    await navigateToSession(page);

    const indicator = page.locator('button[aria-label="File transfers"]');

    // Inject completed transfer
    await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Test Peer',
        filename: 'test.webm',
        size: 5 * 1024 * 1024,
        progress: 1,
        status: 'complete',
        direction: 'send',
        role: 'sender',
        senderId: 'self',
        senderName: 'Test User',
        receiverId: 'peer-123',
        receiverName: 'Test Peer',
      },
    ]);

    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Click to open popover
    await indicator.click();

    // Wait for popover to appear (new UI shows "File transfer" heading)
    await expect(page.locator('h3:has-text("File transfer")')).toBeVisible();

    // Click dismiss button
    await page.click('button:has-text("Dismiss")');

    // Wait for animation
    await page.waitForTimeout(500);

    // Verify state - indicatorDismissed should be true
    const state = await getTransferState(page);
    expect(state?.indicatorDismissed).toBe(true);

    // Note: The indicator may still be visible for hosts in session (isHostInSession)
    // as the host can always access the race view. The key is that indicatorDismissed is set.
  });

  test('popover displays file transfer UI', async () => {
    const { page } = app;
    await navigateToSession(page);

    // Inject transfer with full fields required by TransferRacePopover
    // The popover groups transfers by senderId and shows senderName
    await injectTransfers(page, [
      {
        id: 'test-transfer-1',
        peerId: 'peer-123',
        peerName: 'Ninja Warrior',
        filename: 'test.webm',
        size: 5 * 1024 * 1024,
        progress: 0.6,
        status: 'active',
        direction: 'receive',
        // Extended fields for racer display
        role: 'receiver',
        senderId: 'peer-123',
        senderName: 'Ninja Warrior',
        receiverId: 'self',
        receiverName: 'Test User',
      },
    ]);

    const indicator = page.locator('button[aria-label="File transfers"]');
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Open popover (may already be open due to auto-open)
    if (!(await page.locator('h3:has-text("File transfer")').isVisible({ timeout: 500 }).catch(() => false))) {
      await indicator.click();
    }

    // Verify file transfer UI elements
    await expect(page.locator('h3:has-text("File transfer")')).toBeVisible();
    await expect(page.locator('text=Keep browser open')).toBeVisible();

    // Verify racer row shows sender name (for received transfers, shows the sender)
    await expect(page.locator('text=Ninja Warrior')).toBeVisible();

    // Close popover
    await page.click('button:has-text("Close")');

    // Wait for close animation
    await page.waitForTimeout(500);

    // Popover should be closed
    await expect(page.locator('h3:has-text("File transfer")')).toHaveCount(0);
  });
});
