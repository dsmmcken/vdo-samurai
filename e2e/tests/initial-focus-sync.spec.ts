/**
 * E2E Test: Initial Active Feed Synchronization
 *
 * This test verifies that when two users join a session, both see the same
 * person as the "active" (focused) tile. The host who joined first should
 * be focused on both screens.
 *
 * Bug context: When joining, both users get focusTimestamp=1. When host
 * sends focus state to new peer, incoming timestamp (1) is not > current (1),
 * so sync is ignored. Each user sees themselves focused.
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { getFocusedPeerId, waitForTileFocused, sleep } from '../helpers/wait-helpers';

test.describe('VDO Samurai E2E - Initial Focus Synchronization', () => {
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

  test('initial active feed syncs to host when participant joins', async () => {
    // ==========================================
    // STEP 1: Launch both Electron instances
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
    await participant.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', {
      timeout: 15000
    });
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
      await host.page.screenshot({ path: 'e2e/test-results/initial-focus-sync-host-timeout.png' });
      await participant.page.screenshot({
        path: 'e2e/test-results/initial-focus-sync-participant-timeout.png'
      });
      throw new Error(`P2P connection timeout after ${maxWaitTime}ms`);
    }

    console.log('[E2E] P2P connection established');

    // ==========================================
    // STEP 6: Wait for initial sync to complete
    // ==========================================
    console.log('[E2E] Waiting for initial focus sync...');
    await sleep(3000);

    // Get selfIds from both apps
    const hostSelfId = await host.page.evaluate(() => {
      const win = window as unknown as { __trysteroSelfId?: string };
      return win.__trysteroSelfId ?? 'not-set';
    });

    const participantSelfId = await participant.page.evaluate(() => {
      const win = window as unknown as { __trysteroSelfId?: string };
      return win.__trysteroSelfId ?? 'not-set';
    });

    // Get peer IDs as seen by each side
    const hostPeerIdOnParticipant = await participant.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { peers?: Array<{ id: string; name: string }> } }
        >
      ).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        return peers.find((p) => p.name.includes('Host'))?.id ?? null;
      }
      return null;
    });

    const participantPeerIdOnHost = await host.page.evaluate(() => {
      const store = (
        window as unknown as Record<
          string,
          { getState?: () => { peers?: Array<{ id: string; name: string }> } }
        >
      ).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        return peers.find((p) => p.name.includes('Participant'))?.id ?? null;
      }
      return null;
    });

    console.log('[E2E] Host selfId:', hostSelfId);
    console.log('[E2E] Participant selfId:', participantSelfId);
    console.log('[E2E] Host peer ID on participant:', hostPeerIdOnParticipant);
    console.log('[E2E] Participant peer ID on host:', participantPeerIdOnHost);

    expect(hostPeerIdOnParticipant).toBeTruthy();
    expect(participantPeerIdOnHost).toBeTruthy();

    // Verify the peer IDs match selfIds (cross-verification)
    expect(hostPeerIdOnParticipant).toBe(hostSelfId);
    expect(participantPeerIdOnHost).toBe(participantSelfId);

    // ==========================================
    // STEP 7: Verify focus state consistency
    // ==========================================
    console.log('[E2E] Verifying initial focus state...');

    const hostFocus = await getFocusedPeerId(host.page);
    const participantFocus = await getFocusedPeerId(participant.page);

    console.log('[E2E] Host focusedPeerId:', hostFocus);
    console.log('[E2E] Participant focusedPeerId:', participantFocus);

    // The key assertion: Both should see the same person focused (the host)
    // Since host joined first, host should be focused everywhere:
    // - On host: focusedPeerId = null (self)
    // - On participant: focusedPeerId = hostSelfId (the host's peer ID)

    // First verify host sees self focused
    expect(hostFocus).toBe(null);
    console.log('[E2E] Host correctly sees self focused (null)');

    // Participant should see the host focused
    // This is the critical assertion that will fail before the bug fix
    expect(participantFocus).toBe(hostSelfId);
    console.log('[E2E] Participant correctly sees host focused');

    // Also verify via UI tiles
    await waitForTileFocused(host.page, 'You', 5000);
    console.log('[E2E] Host UI shows "You" tile focused');

    await waitForTileFocused(participant.page, 'Host', 5000);
    console.log('[E2E] Participant UI shows "Host" tile focused');

    console.log('[E2E] Initial focus sync test passed!');
  });
});
