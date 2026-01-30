import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  waitForTileFocused,
  getFocusedPeerId,
  sleep,
  waitForLocalScreenShare,
  waitForPeerScreenShareBadge,
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

  test('screen share focus syncs correctly when both peers share', async () => {
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

    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

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

    // Capture console logs from both to debug stream handling
    const hostLogs: string[] = [];
    host.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('TrysteroProvider') || text.includes('screen')) {
        hostLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    const participantLogs: string[] = [];
    participant.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('TrysteroProvider') || text.includes('screen')) {
        participantLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    // Get peer IDs
    const participantPeerIdOnHost = await host.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string }> } }>).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        return peers.find(p => p.name.includes('Participant'))?.id ?? null;
      }
      return null;
    });
    expect(participantPeerIdOnHost).toBeTruthy();
    console.log('[E2E] Participant peer ID on host:', participantPeerIdOnHost);

    // ==========================================
    // STEP 6: Both peers start screen share
    // (Same approach as full-workflow test)
    // ==========================================
    console.log('[E2E] Starting screen share on HOST...');
    await host.page.click(selectors.session.screenShareButton);
    await host.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    // Use specific selector for the blue Share button inside the dialog
    await host.page.click('[role="dialog"] button.bg-blue-600');
    await waitForLocalScreenShare(host.page, 10000);
    console.log('[E2E] Host screen share started');

    // Wait a bit for host's screen share to propagate
    await sleep(2000);

    console.log('[E2E] Starting screen share on PARTICIPANT...');
    await participant.page.click(selectors.session.screenShareButton);
    await participant.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    // Use specific selector for the blue Share button inside the dialog
    await participant.page.click('[role="dialog"] button.bg-blue-600');
    await waitForLocalScreenShare(participant.page, 10000);
    console.log('[E2E] Participant screen share started');

    // Wait for screen share badges to appear on both sides
    await waitForPeerScreenShareBadge(host.page, 'Participant', 30000);
    await waitForPeerScreenShareBadge(participant.page, 'Host User', 30000);
    console.log('[E2E] Both peers see each other\'s screen share badges');

    // Wait for WebRTC screen streams to propagate (takes longer than status messages)
    // WebRTC renegotiation for additional streams can take a while
    console.log('[E2E] Waiting for screen streams to propagate...');
    await sleep(15000);

    // Debug: Check participant's local screen stream
    const participantLocalScreenStream = await participant.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { localScreenStream?: MediaStream | null } }>).useSessionStore;
      if (store?.getState) {
        const state = store.getState();
        return !!state?.localScreenStream;
      }
      return false;
    });
    console.log('[E2E] Participant has local screen stream:', participantLocalScreenStream);

    // Print captured logs
    console.log('[E2E] Host console logs:', JSON.stringify(hostLogs, null, 2));
    console.log('[E2E] Participant console logs:', JSON.stringify(participantLogs, null, 2));

    // ==========================================
    // STEP 7: Verify host received participant's screen stream
    // ==========================================
    // Check if the participant has a screenStream set on the host side
    const participantHasScreenStreamOnHost = await host.page.evaluate(() => {
      const store = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name?: string; screenStream?: MediaStream | null; isScreenSharing?: boolean }> } }>).usePeerStore;
      if (store?.getState) {
        const peers = store.getState()?.peers ?? [];
        const participant = peers.find(p => p.name?.includes('Participant'));
        console.log('[E2E in-browser] All peers:', peers.map(p => ({ id: p.id, name: p.name, hasScreenStream: !!p.screenStream, isScreenSharing: p.isScreenSharing })));
        console.log('[E2E in-browser] Participant peer:', { id: participant?.id, name: participant?.name, hasScreenStream: !!participant?.screenStream, isScreenSharing: participant?.isScreenSharing });
        return participant?.screenStream !== null && participant?.screenStream !== undefined;
      }
      return false;
    });

    console.log('[E2E] Participant has screenStream on host:', participantHasScreenStreamOnHost);

    // ==========================================
    // STEP 8: Host clicks on Participant's tile
    // ==========================================
    console.log('[E2E] Host clicking on Participant tile...');
    await host.page.click('[role="button"][aria-label*="Participant"]');
    await sleep(2000);

    // Verify focus changed on host
    const hostFocus = await getFocusedPeerId(host.page);
    expect(hostFocus).toBe(participantPeerIdOnHost);

    // This is the critical assertion - the participant's screen stream should be
    // received by the host, not just their camera
    expect(participantHasScreenStreamOnHost).toBe(true);

    console.log('[E2E] Screen share focus sync test passed!');
  });

  test('MainDisplay shows correct video when switching focus', async () => {
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

    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

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
    // STEP 6: Start screen share on both peers
    // ==========================================
    console.log('[E2E] Starting screen share on HOST...');
    await host.page.click(selectors.session.screenShareButton);
    await host.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    await host.page.click('[role="dialog"] button.bg-blue-600');
    await waitForLocalScreenShare(host.page, 10000);
    console.log('[E2E] Host screen share started');

    console.log('[E2E] Starting screen share on PARTICIPANT...');
    await participant.page.click(selectors.session.screenShareButton);
    await participant.page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    await participant.page.click('[role="dialog"] button.bg-blue-600');
    await waitForLocalScreenShare(participant.page, 10000);
    console.log('[E2E] Participant screen share started');

    // Wait for screen streams to propagate
    await sleep(5000);

    // ==========================================
    // STEP 7: Verify MainDisplay shows video
    // ==========================================
    // Initially focus is on self, MainDisplay should show local screen share
    console.log('[E2E] Checking MainDisplay shows local screen share...');

    // Check MainDisplay has video element with stream
    const hostMainDisplayHasVideo = await host.page.evaluate(() => {
      const mainDisplay = document.querySelector('[role="region"][aria-label*="Main video display"]');
      const video = mainDisplay?.querySelector('video');
      console.log('[E2E in-browser] MainDisplay video element:', {
        hasMainDisplay: !!mainDisplay,
        hasVideo: !!video,
        videoSrcObject: video?.srcObject ? 'has srcObject' : 'no srcObject',
        videoReadyState: video?.readyState,
        ariaLabel: mainDisplay?.getAttribute('aria-label')
      });
      return video?.srcObject !== null && video?.srcObject !== undefined;
    });
    console.log('[E2E] Host MainDisplay has video (self):', hostMainDisplayHasVideo);
    expect(hostMainDisplayHasVideo).toBe(true);

    // ==========================================
    // STEP 8: Host clicks on Participant tile to change focus
    // ==========================================
    console.log('[E2E] Host clicking on Participant tile to switch focus...');
    await host.page.click('[role="button"][aria-label*="Participant"]');
    await sleep(2000);

    // Verify focus changed
    const hostFocus = await getFocusedPeerId(host.page);
    console.log('[E2E] Host focusedPeerId after click:', hostFocus);
    expect(hostFocus).not.toBe(null);

    // ==========================================
    // STEP 9: Verify MainDisplay shows participant's video
    // ==========================================
    console.log('[E2E] Checking MainDisplay shows participant video after focus switch...');

    const mainDisplayInfo = await host.page.evaluate(() => {
      const mainDisplay = document.querySelector('[role="region"][aria-label*="Main video display"]');
      const video = mainDisplay?.querySelector('video');
      const noVideoDiv = mainDisplay?.querySelector('.text-gray-500');

      // Get peer info from store
      const peerStore = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string; screenStream?: MediaStream | null; stream?: MediaStream | null }> } }>).usePeerStore;
      const sessionStore = (window as unknown as Record<string, { getState?: () => { focusedPeerId?: string | null } }>).useSessionStore;

      const peers = peerStore?.getState?.()?.peers ?? [];
      const focusedPeerId = sessionStore?.getState?.()?.focusedPeerId;
      const focusedPeer = peers.find(p => p.id === focusedPeerId);

      console.log('[E2E in-browser] MainDisplay state:', {
        ariaLabel: mainDisplay?.getAttribute('aria-label'),
        hasVideo: !!video,
        hasNoVideoDiv: !!noVideoDiv,
        videoSrcObject: video?.srcObject ? 'has srcObject' : 'no srcObject',
        focusedPeerId,
        focusedPeerName: focusedPeer?.name,
        focusedPeerHasScreenStream: !!focusedPeer?.screenStream,
        focusedPeerHasStream: !!focusedPeer?.stream,
        allPeers: peers.map(p => ({ id: p.id, name: p.name, hasScreenStream: !!p.screenStream, hasStream: !!p.stream }))
      });

      return {
        hasVideo: !!video,
        hasVideoSrcObject: video?.srcObject !== null && video?.srcObject !== undefined,
        hasNoVideoDiv: !!noVideoDiv,
        ariaLabel: mainDisplay?.getAttribute('aria-label'),
        focusedPeerId,
        focusedPeerHasScreenStream: !!focusedPeer?.screenStream,
        focusedPeerHasStream: !!focusedPeer?.stream
      };
    });

    console.log('[E2E] MainDisplay info after focus switch:', mainDisplayInfo);

    // The MainDisplay should show video (either screen share or camera)
    expect(mainDisplayInfo.hasVideo).toBe(true);
    expect(mainDisplayInfo.hasVideoSrcObject).toBe(true);
    // The focused peer should have at least a screen stream (since we enabled screen share)
    expect(mainDisplayInfo.focusedPeerHasScreenStream).toBe(true);

    console.log('[E2E] MainDisplay video switch test passed!');
  });

  test('camera streams are transmitted between peers', async () => {
    // ==========================================
    // This test verifies that camera streams (not screen shares) are
    // properly transmitted between peers
    // ==========================================
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    console.log('[E2E] Launching participant instance...');
    participant = await launchApp('participant');

    // Capture console logs
    const hostLogs: string[] = [];
    host.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('useWebRTC') || text.includes('TrysteroProvider') || text.includes('Adding')) {
        hostLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    const participantLogs: string[] = [];
    participant.page.on('console', msg => {
      const text = msg.text();
      if (text.includes('useWebRTC') || text.includes('TrysteroProvider') || text.includes('Adding')) {
        participantLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    // Setup profiles
    console.log('[E2E] Setting up profiles...');
    await host.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await host.page.fill('#display-name', 'Host User');
    await host.page.fill('#full-name', 'Host Full Name');
    await host.page.click('button:has-text("Continue")');

    await participant.page.waitForSelector('h1:has-text("Welcome to VDO Samurai")', { timeout: 15000 });
    await participant.page.fill('#display-name', 'Participant');
    await participant.page.fill('#full-name', 'Participant Full Name');
    await participant.page.click('button:has-text("Continue")');

    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });
    await participant.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Host creates session (this should trigger camera request)
    console.log('[E2E] Host creating session...');
    await host.page.click(selectors.home.createRoomButton);
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 30000 });

    // Check host's local camera stream
    const hostHasLocalStream = await host.page.evaluate(() => {
      const sessionStore = (window as unknown as Record<string, { getState?: () => { localStream?: MediaStream | null } }>).useSessionStore;
      const localStream = sessionStore?.getState?.()?.localStream;
      console.log('[E2E in-browser] Host localStream:', {
        hasStream: !!localStream,
        videoTracks: localStream?.getVideoTracks().length,
        audioTracks: localStream?.getAudioTracks().length
      });
      return !!localStream;
    });
    console.log('[E2E] Host has localStream:', hostHasLocalStream);

    const hostUrl = host.page.url();
    const sessionIdMatch = hostUrl.match(/\/session\/([^/]+)/);
    expect(sessionIdMatch).toBeTruthy();
    const sessionId = sessionIdMatch![1];
    console.log('[E2E] Session created:', sessionId);

    // Participant joins session (this should trigger camera request)
    console.log('[E2E] Participant joining session...');
    await participant.page.fill(selectors.home.roomCodeInput, sessionId);
    await participant.page.click(selectors.home.joinRoomButton);
    await participant.page.waitForSelector(selectors.session.participantList, { timeout: 30000 });

    // Check participant's local camera stream
    const participantHasLocalStream = await participant.page.evaluate(() => {
      const sessionStore = (window as unknown as Record<string, { getState?: () => { localStream?: MediaStream | null } }>).useSessionStore;
      const localStream = sessionStore?.getState?.()?.localStream;
      console.log('[E2E in-browser] Participant localStream:', {
        hasStream: !!localStream,
        videoTracks: localStream?.getVideoTracks().length,
        audioTracks: localStream?.getAudioTracks().length
      });
      return !!localStream;
    });
    console.log('[E2E] Participant has localStream:', participantHasLocalStream);

    // Wait for P2P connection
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

    // Wait for streams to propagate
    await sleep(5000);

    // Check if host received participant's camera stream
    const hostPeerInfo = await host.page.evaluate(() => {
      const peerStore = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string; stream?: MediaStream | null; screenStream?: MediaStream | null }> } }>).usePeerStore;
      const peers = peerStore?.getState?.()?.peers ?? [];
      const participantPeer = peers.find(p => p.name?.includes('Participant'));

      console.log('[E2E in-browser] Host peer store:', {
        peerCount: peers.length,
        peers: peers.map(p => ({
          id: p.id,
          name: p.name,
          hasStream: !!p.stream,
          hasScreenStream: !!p.screenStream,
          streamTracks: p.stream?.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState }))
        }))
      });

      return {
        peerCount: peers.length,
        participantFound: !!participantPeer,
        participantHasStream: !!participantPeer?.stream,
        participantHasScreenStream: !!participantPeer?.screenStream
      };
    });
    console.log('[E2E] Host peer info:', hostPeerInfo);

    // Check if participant received host's camera stream
    const participantPeerInfo = await participant.page.evaluate(() => {
      const peerStore = (window as unknown as Record<string, { getState?: () => { peers?: Array<{ id: string; name: string; stream?: MediaStream | null; screenStream?: MediaStream | null }> } }>).usePeerStore;
      const peers = peerStore?.getState?.()?.peers ?? [];
      const hostPeer = peers.find(p => p.name?.includes('Host'));

      console.log('[E2E in-browser] Participant peer store:', {
        peerCount: peers.length,
        peers: peers.map(p => ({
          id: p.id,
          name: p.name,
          hasStream: !!p.stream,
          hasScreenStream: !!p.screenStream,
          streamTracks: p.stream?.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState }))
        }))
      });

      return {
        peerCount: peers.length,
        hostFound: !!hostPeer,
        hostHasStream: !!hostPeer?.stream,
        hostHasScreenStream: !!hostPeer?.screenStream
      };
    });
    console.log('[E2E] Participant peer info:', participantPeerInfo);

    // Log captured console messages
    console.log('[E2E] Host console logs:', hostLogs);
    console.log('[E2E] Participant console logs:', participantLogs);

    // Assertions
    expect(hostHasLocalStream).toBe(true);
    expect(participantHasLocalStream).toBe(true);
    expect(hostPeerInfo.participantFound).toBe(true);
    expect(participantPeerInfo.hostFound).toBe(true);

    // Camera streams should be transmitted
    expect(hostPeerInfo.participantHasStream).toBe(true);
    expect(participantPeerInfo.hostHasStream).toBe(true);

    console.log('[E2E] Camera stream transmission test passed!');
  });
});
