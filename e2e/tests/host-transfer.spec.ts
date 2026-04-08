import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection
} from '../helpers/test-setup';
import { sleep } from '../helpers/wait-helpers';

/**
 * Host Transfer E2E Tests
 *
 * Tests the host transfer feature where the current host can right-click
 * on a participant's tile to open a context menu and transfer host role.
 *
 * Covers:
 * - Host perspective: context menu appears on right-click, "Make Host" option works
 * - Participant perspective: receives host role after transfer
 * - Both perspectives: isHost state updates correctly on both sides
 */
test.describe('Host Transfer via Context Menu', () => {
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

  test('host can transfer host role to participant via right-click context menu', async () => {
    // ==========================================
    // STEP 1: Launch two Electron instances
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    console.log('[E2E] Launching participant instance...');
    participant = await launchApp('participant');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });
    participant.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });

    // ==========================================
    // STEP 2: Complete profile setup for both
    // ==========================================
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // ==========================================
    // STEP 3: Host creates session, participant joins
    // ==========================================
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    await joinSession(participant.page, sessionId);

    // ==========================================
    // STEP 4: Wait for P2P connection
    // ==========================================
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Allow peer info to sync
    await sleep(3000);

    // ==========================================
    // STEP 5: Verify initial host state
    // ==========================================
    console.log('[E2E] Verifying initial host state...');

    const hostIsHostBefore = await host.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { isHost?: boolean } }>)
        .useSessionStore;
      return store?.getState?.()?.isHost;
    });
    expect(hostIsHostBefore).toBe(true);
    console.log('[E2E] Host confirms it is host:', hostIsHostBefore);

    const participantIsHostBefore = await participant.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { isHost?: boolean } }>)
        .useSessionStore;
      return store?.getState?.()?.isHost;
    });
    expect(participantIsHostBefore).toBe(false);
    console.log('[E2E] Participant confirms it is not host:', participantIsHostBefore);

    // ==========================================
    // STEP 6: Right-click on participant's tile (host side)
    // ==========================================
    console.log('[E2E] Right-clicking on Participant tile...');

    const participantTile = host.page.locator(selectors.session.peerTileByName('Participant'));
    await expect(participantTile).toBeVisible({ timeout: 10000 });

    // Right-click to open context menu
    // The context menu is attached to the listitem wrapper, so right-click on the tile's parent
    const tileListItem = participantTile.locator('xpath=ancestor::div[@role="listitem"]');
    await tileListItem.click({ button: 'right' });

    // ==========================================
    // STEP 7: Verify context menu appears with "Make Host" option
    // ==========================================
    console.log('[E2E] Verifying context menu...');

    // Context menu should show participant name
    const contextMenuNameLabel = host.page.locator('div.fixed.z-50 >> text=Participant');
    await expect(contextMenuNameLabel).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Context menu shows participant name');

    // "Make Host" button should be visible and enabled
    const makeHostButton = host.page.locator('div.fixed.z-50 button:has-text("Make Host")');
    await expect(makeHostButton).toBeVisible({ timeout: 5000 });
    await expect(makeHostButton).toBeEnabled();
    console.log('[E2E] "Make Host" button is visible and enabled');

    // ==========================================
    // STEP 8: Click "Make Host"
    // ==========================================
    console.log('[E2E] Clicking "Make Host"...');
    await makeHostButton.click();

    // Context menu should close
    await expect(contextMenuNameLabel).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Context menu closed after click');

    // ==========================================
    // STEP 9: Verify host state changed on BOTH sides
    // ==========================================
    console.log('[E2E] Waiting for host transfer to propagate...');

    // Host should no longer be host
    await host.page.waitForFunction(
      () => {
        const store = (
          window as unknown as Record<string, { getState?: () => { isHost?: boolean } }>
        ).useSessionStore;
        return store?.getState?.()?.isHost === false;
      },
      undefined,
      { timeout: 15000 }
    );
    console.log('[E2E] Host confirms it is no longer host');

    // Participant should now be host
    await participant.page.waitForFunction(
      () => {
        const store = (
          window as unknown as Record<string, { getState?: () => { isHost?: boolean } }>
        ).useSessionStore;
        return store?.getState?.()?.isHost === true;
      },
      undefined,
      { timeout: 15000 }
    );
    console.log('[E2E] Participant confirms it is now host');

    // ==========================================
    // STEP 10: Verify peer store reflects new host status
    // ==========================================
    console.log('[E2E] Verifying peer store state...');

    // On host's side: participant peer should have isHost=true
    const participantPeerOnHost = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              peers?: Array<{ id: string; name: string; isHost: boolean }>;
            };
          }
        >
      ).usePeerStore;
      const peers = store?.getState?.()?.peers ?? [];
      const peer = peers.find((p) => p.name?.includes('Participant'));
      return peer ? { name: peer.name, isHost: peer.isHost } : null;
    });
    expect(participantPeerOnHost).not.toBeNull();
    expect(participantPeerOnHost?.isHost).toBe(true);
    console.log('[E2E] Host sees participant as host:', participantPeerOnHost);

    // On participant's side: host peer should have isHost=false
    const hostPeerOnParticipant = await participant.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          {
            getState?: () => {
              peers?: Array<{ id: string; name: string; isHost: boolean }>;
            };
          }
        >
      ).usePeerStore;
      const peers = store?.getState?.()?.peers ?? [];
      const peer = peers.find((p) => p.name?.includes('Host'));
      return peer ? { name: peer.name, isHost: peer.isHost } : null;
    });
    expect(hostPeerOnParticipant).not.toBeNull();
    expect(hostPeerOnParticipant?.isHost).toBe(false);
    console.log('[E2E] Participant sees original host as non-host:', hostPeerOnParticipant);

    console.log('[E2E] Host transfer test passed!');
  });

  test('context menu appears on right-click for self tile and can be dismissed', async () => {
    // ==========================================
    // STEP 1: Launch host instance only
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

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
    await createSession(host.page);

    // ==========================================
    // STEP 3: Right-click on own tile ("You")
    // ==========================================
    console.log('[E2E] Right-clicking on own tile (You)...');

    const selfTile = host.page.locator(selectors.session.localTile);
    await expect(selfTile).toBeVisible({ timeout: 10000 });

    const selfListItem = selfTile.locator('xpath=ancestor::div[@role="listitem"]');
    await selfListItem.click({ button: 'right' });

    // ==========================================
    // STEP 4: Verify context menu appears with "You" label and "Make Host" option
    // ==========================================
    console.log('[E2E] Verifying context menu for self...');

    // Context menu should appear with "You" label
    const contextMenuNameLabel = host.page.locator('div.fixed.z-50 >> text=You');
    await expect(contextMenuNameLabel).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Context menu shows "You" label');

    // "Make Host" button should be visible
    const makeHostButton = host.page.locator('div.fixed.z-50 button:has-text("Make Host")');
    await expect(makeHostButton).toBeVisible({ timeout: 5000 });

    // The button shows "Already the host" tooltip text when self is already host
    const tooltipText = await makeHostButton.getAttribute('title');
    expect(tooltipText).toBe('Already the host');
    console.log('[E2E] "Make Host" button shows "Already the host" tooltip');

    // ==========================================
    // STEP 5: Dismiss context menu via Escape
    // ==========================================
    await host.page.keyboard.press('Escape');
    await expect(contextMenuNameLabel).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Context menu dismissed via Escape');

    // ==========================================
    // STEP 6: Re-open and dismiss by clicking outside
    // ==========================================
    await selfListItem.click({ button: 'right' });
    await expect(contextMenuNameLabel).toBeVisible({ timeout: 5000 });

    // Click on the page body (outside the context menu) to dismiss
    await host.page.mouse.click(10, 10);
    await expect(contextMenuNameLabel).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Context menu dismissed by clicking outside');

    console.log('[E2E] Self-tile context menu test passed!');
  });

  test('new host can see record button after receiving host role', async () => {
    // ==========================================
    // STEP 1: Launch two Electron instances
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    console.log('[E2E] Launching participant instance...');
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
    // STEP 2: Setup profiles, connect
    // ==========================================
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    const sessionId = await createSession(host.page);
    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    await sleep(3000);

    // ==========================================
    // STEP 3: Verify participant does NOT see record button initially
    // ==========================================
    console.log('[E2E] Verifying participant does not see Record button...');

    // Participant should not have a Record button (only host has it)
    const participantRecordButton = participant.page.locator(selectors.session.recordButton);
    await expect(participantRecordButton).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant correctly does not see Record button');

    // Host should see the Record button
    const hostRecordButton = host.page.locator(selectors.session.recordButton);
    await expect(hostRecordButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Host correctly sees Record button');

    // ==========================================
    // STEP 4: Transfer host role to participant
    // ==========================================
    console.log('[E2E] Transferring host role...');

    const participantTile = host.page.locator(selectors.session.peerTileByName('Participant'));
    const tileListItem = participantTile.locator('xpath=ancestor::div[@role="listitem"]');
    await tileListItem.click({ button: 'right' });

    const makeHostButton = host.page.locator('div.fixed.z-50 button:has-text("Make Host")');
    await expect(makeHostButton).toBeVisible({ timeout: 5000 });
    await makeHostButton.click();

    // Wait for host transfer to propagate
    await participant.page.waitForFunction(
      () => {
        const store = (
          window as unknown as Record<string, { getState?: () => { isHost?: boolean } }>
        ).useSessionStore;
        return store?.getState?.()?.isHost === true;
      },
      undefined,
      { timeout: 15000 }
    );
    console.log('[E2E] Participant is now host');

    // ==========================================
    // STEP 5: Verify participant now sees Record button
    // ==========================================
    console.log('[E2E] Verifying participant now sees Record button...');
    await expect(participantRecordButton).toBeVisible({ timeout: 10000 });
    console.log('[E2E] Participant now sees Record button');

    // Original host should no longer see Record button
    await expect(hostRecordButton).not.toBeVisible({ timeout: 10000 });
    console.log('[E2E] Original host no longer sees Record button');

    console.log('[E2E] New host record button test passed!');
  });
});
