import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForTileFocused,
  getFocusedPeerId,
  sleep,
} from '../helpers/wait-helpers';

test.describe('VDO Samurai E2E - Focus Synchronization', () => {
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

  test('focus selection syncs across all peers', async () => {
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
      await host.page.screenshot({ path: 'e2e/test-results/focus-sync-host-timeout.png' });
      await participant.page.screenshot({ path: 'e2e/test-results/focus-sync-participant-timeout.png' });
      throw new Error(`P2P connection timeout after ${maxWaitTime}ms`);
    }

    console.log('[E2E] P2P connection established');

    // Get peer IDs for verification
    // Host's selfId is null locally (represented as "You" tile)
    // Participant appears as a peer to host with their actual peerId
    const hostPeerIdOnParticipant = await participant.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string }> } }>).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        // Find the host peer (the one that's not us)
        return peers.find(p => p.name.includes('Host'))?.id ?? null;
      }
      return null;
    });

    const participantPeerIdOnHost = await host.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string }> } }>).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        return peers.find(p => p.name.includes('Participant'))?.id ?? null;
      }
      return null;
    });

    // Add small delay for selfId to be exposed
    await sleep(1000);

    // Get selfIds from both apps - the TrysteroContext exposes selfId in context value
    const hostSelfId = await host.page.evaluate(() => {
      const win = window as unknown as { __trysteroSelfId?: string };
      return win.__trysteroSelfId ?? 'not-set';
    });

    const participantSelfId = await participant.page.evaluate(() => {
      const win = window as unknown as { __trysteroSelfId?: string };
      return win.__trysteroSelfId ?? 'not-set';
    });

    console.log('[E2E] Host peer ID (on participant):', hostPeerIdOnParticipant);
    console.log('[E2E] Participant peer ID (on host):', participantPeerIdOnHost);
    console.log('[E2E] Host selfId:', hostSelfId);
    console.log('[E2E] Participant selfId:', participantSelfId);
    console.log('[E2E] Host selfId === hostPeerIdOnParticipant:', hostSelfId === hostPeerIdOnParticipant);
    console.log('[E2E] Participant selfId === participantPeerIdOnHost:', participantSelfId === participantPeerIdOnHost);

    expect(hostPeerIdOnParticipant).toBeTruthy();
    expect(participantPeerIdOnHost).toBeTruthy();

    // ==========================================
    // STEP 6: Verify initial focus state
    // ==========================================
    // Initially, both should have their own tile focused (focusedPeerId = null)
    console.log('[E2E] Checking initial focus state...');

    const hostInitialFocus = await getFocusedPeerId(host.page);
    const participantInitialFocus = await getFocusedPeerId(participant.page);

    console.log('[E2E] Initial focus - Host:', hostInitialFocus, 'Participant:', participantInitialFocus);

    // Both start with null (self focused) or possibly the other peer if auto-focused
    // Just log the initial state for now

    // ==========================================
    // STEP 7: Host clicks on Participant's tile
    // ==========================================
    // Capture console logs from participant page to debug focus sync
    const participantLogs: string[] = [];
    participant.page.on('console', msg => {
      if (msg.text().includes('TrysteroProvider') || msg.text().includes('Focus')) {
        participantLogs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    console.log('[E2E] Host clicking on Participant tile...');
    await host.page.click('[role="button"][aria-label*="Participant"]');

    // Small delay for message to propagate
    await sleep(2000);

    // Print captured console logs
    console.log('[E2E] Participant console logs:', participantLogs);

    // Verify both have the same focus
    console.log('[E2E] Verifying focus after host clicks Participant...');

    // Debug: print current state
    const hostFocusAfterClick1 = await getFocusedPeerId(host.page);
    const participantFocusAfterClick1 = await getFocusedPeerId(participant.page);
    console.log('[E2E] Host focusedPeerId:', hostFocusAfterClick1);
    console.log('[E2E] Participant focusedPeerId:', participantFocusAfterClick1);

    // On host: focusedPeerId should be the participant's ID
    // Tile with "Participant" in name should be focused on host's screen
    await waitForTileFocused(host.page, 'Participant', 5000);
    expect(hostFocusAfterClick1).toBe(participantPeerIdOnHost);

    // On participant: focusedPeerId should be null (self), since the host focused on participant
    // On participant's screen, their own tile is "You", not "Participant"!
    await waitForTileFocused(participant.page, 'You', 5000);
    // Participant should see null (self focused) because their own tile is now focused
    expect(participantFocusAfterClick1).toBe(null);

    console.log('[E2E] Focus sync verified: Both showing Participant focused');

    // ==========================================
    // STEP 8: Participant clicks on Host's tile
    // ==========================================
    console.log('[E2E] Participant clicking on Host tile...');
    await participant.page.click('[role="button"][aria-label*="Host"]');

    await sleep(2000);

    console.log('[E2E] Verifying focus after participant clicks Host...');

    // Debug: print current state
    const participantFocusAfterClick2 = await getFocusedPeerId(participant.page);
    const hostFocusAfterClick2 = await getFocusedPeerId(host.page);
    console.log('[E2E] Participant focusedPeerId:', participantFocusAfterClick2);
    console.log('[E2E] Host focusedPeerId:', hostFocusAfterClick2);

    // On participant: focusedPeerId should be the host's peer ID
    await waitForTileFocused(participant.page, 'Host', 5000);
    expect(participantFocusAfterClick2).toBe(hostPeerIdOnParticipant);

    // On host: focusedPeerId should be null (self), since participant focused on host
    // On host's screen, their own tile is "You", not "Host"!
    await waitForTileFocused(host.page, 'You', 5000);
    expect(hostFocusAfterClick2).toBe(null);

    console.log('[E2E] Focus sync verified: Both showing Host focused');

    // ==========================================
    // STEP 9: Participant clicks on their own tile (You)
    // ==========================================
    console.log('[E2E] Participant clicking on their own (You) tile...');
    await participant.page.click('[role="button"][aria-label*="You"]');

    await sleep(2000);

    console.log('[E2E] Verifying focus after participant clicks their own tile...');

    // Debug: print current state
    const participantFocusAfterClick3 = await getFocusedPeerId(participant.page);
    const hostFocusAfterClick3 = await getFocusedPeerId(host.page);
    console.log('[E2E] Participant focusedPeerId:', participantFocusAfterClick3);
    console.log('[E2E] Host focusedPeerId:', hostFocusAfterClick3);

    // On participant: focusedPeerId should be null (self)
    await waitForTileFocused(participant.page, 'You', 5000);
    expect(participantFocusAfterClick3).toBe(null);

    // On host: focusedPeerId should be the participant's ID (since participant clicked on themselves)
    await waitForTileFocused(host.page, 'Participant', 5000);
    expect(hostFocusAfterClick3).toBe(participantPeerIdOnHost);

    console.log('[E2E] Focus sync verified: Both showing Participant focused');

    // ==========================================
    // STEP 10: Host clicks on their own tile (You)
    // ==========================================
    console.log('[E2E] Host clicking on their own (You) tile...');
    await host.page.click('[role="button"][aria-label*="You"]');

    await sleep(2000);

    console.log('[E2E] Verifying focus after host clicks their own tile...');

    // Debug: print current state
    const hostFocusAfterClick4 = await getFocusedPeerId(host.page);
    const participantFocusAfterClick4 = await getFocusedPeerId(participant.page);
    console.log('[E2E] Host focusedPeerId:', hostFocusAfterClick4);
    console.log('[E2E] Participant focusedPeerId:', participantFocusAfterClick4);

    // On host: focusedPeerId should be null (self)
    await waitForTileFocused(host.page, 'You', 5000);
    expect(hostFocusAfterClick4).toBe(null);

    // On participant: focusedPeerId should be the host's ID (since host clicked on themselves)
    await waitForTileFocused(participant.page, 'Host', 5000);
    expect(participantFocusAfterClick4).toBe(hostPeerIdOnParticipant);

    console.log('[E2E] Focus sync verified: Both showing Host focused');

    console.log('[E2E] All focus sync tests passed!');
  });

  test('new peer joining syncs to existing focus state', async () => {
    // ==========================================
    // STEP 1: Launch host instance
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // ==========================================
    // STEP 2: Complete profile setup for host
    // ==========================================
    console.log('[E2E] Setting up host profile...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 3: Host creates session
    // ==========================================
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);

    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    const hostUrl = host.page.url();
    const sessionIdMatch = hostUrl.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];
    console.log('[E2E] Session created:', sessionId);

    // ==========================================
    // STEP 4: Host clicks on their own tile to set focus
    // ==========================================
    console.log('[E2E] Host clicking on their own (You) tile to set focus...');
    await host.page.click('[role="button"][aria-label*="You"]');
    await sleep(1000);

    // Verify host has focus set
    const hostFocusBefore = await getFocusedPeerId(host.page);
    console.log('[E2E] Host focus before participant joins:', hostFocusBefore);
    expect(hostFocusBefore).toBe(null); // null means self

    // Get host's selfId for verification later
    const hostSelfId = await host.page.evaluate(() => {
      const win = window as unknown as { __trysteroSelfId?: string };
      return win.__trysteroSelfId ?? 'not-set';
    });
    console.log('[E2E] Host selfId:', hostSelfId);

    // ==========================================
    // STEP 5: Launch and setup participant
    // ==========================================
    console.log('[E2E] Launching participant instance...');
    participant = await launchApp('participant');

    console.log('[E2E] Setting up participant profile...');
    await participant.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await participant.page.fill('#display-name', 'Participant');
    await participant.page.fill('#full-name', 'Participant Full Name');
    await participant.page.click('button:has-text("Continue")');

    await participant.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // ==========================================
    // STEP 6: Participant joins session
    // ==========================================
    console.log('[E2E] Participant joining session...');
    await participant.page.fill(selectors.home.roomCodeInput, sessionId);
    await participant.page.click(selectors.home.joinRoomButton);

    await participant.page.waitForSelector(selectors.session.participantList, { timeout: 30000 });

    // ==========================================
    // STEP 7: Wait for P2P connection
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
    // STEP 8: Verify participant synced to host's focus
    // ==========================================
    // Give time for focus sync message to propagate
    await sleep(3000);

    const participantFocus = await getFocusedPeerId(participant.page);
    console.log('[E2E] Participant focus after joining:', participantFocus);

    // The participant should have synced to the host's focus (which was on host themselves)
    // On participant's side, this means focusedPeerId should be the host's peer ID
    expect(participantFocus).toBe(hostSelfId);

    // Verify the UI also shows the correct focus
    await waitForTileFocused(participant.page, 'Host', 5000);

    console.log('[E2E] Focus sync on join verified!');
  });
});
