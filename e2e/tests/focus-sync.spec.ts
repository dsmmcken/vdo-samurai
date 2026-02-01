import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection,
  startScreenShare,
  getSelfId,
  getPeerIdByName,
} from '../helpers/test-setup';
import {
  waitForTileFocused,
  getFocusedPeerId,
  sleep,
  waitForPeerScreenShareBadge,
} from '../helpers/wait-helpers';
import { getPeerByName, getLocalStreamState } from '../helpers/store-helpers';

test.describe('VDO Samurai E2E - Focus Synchronization', () => {
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

  /**
   * Test 1: Focus selection syncs across all peers
   *
   * This comprehensive test covers:
   * - Initial focus sync when participant joins (from deleted initial-focus-sync.spec.ts)
   * - New peer joining syncs to existing focus state (from deleted test 2)
   * - Focus changes sync bidirectionally
   */
  test('focus selection syncs across all peers', async () => {
    // Launch instances
    console.log('[E2E] Launching host and participant instances...');
    host = await launchApp('host');
    participant = await launchApp('participant');

    // Setup profiles
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // Host creates session
    console.log('[E2E] Host creating session...');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Participant joins
    console.log('[E2E] Participant joining session...');
    await joinSession(participant.page, sessionId);

    // Wait for P2P connection
    await waitForP2PConnection(host.page, participant.page);

    // Get peer IDs
    await sleep(1000);
    const hostSelfId = await getSelfId(host.page);
    const participantSelfId = await getSelfId(participant.page);
    const hostPeerIdOnParticipant = await getPeerIdByName(participant.page, 'Host');
    const participantPeerIdOnHost = await getPeerIdByName(host.page, 'Participant');

    console.log('[E2E] Host selfId:', hostSelfId);
    console.log('[E2E] Participant selfId:', participantSelfId);
    expect(hostPeerIdOnParticipant).toBeTruthy();
    expect(participantPeerIdOnHost).toBeTruthy();
    expect(hostPeerIdOnParticipant).toBe(hostSelfId);
    expect(participantPeerIdOnHost).toBe(participantSelfId);

    // ==========================================
    // Verify initial focus sync (host focused)
    // ==========================================
    console.log('[E2E] Verifying initial focus state...');
    await sleep(3000); // Wait for sync

    const hostInitialFocus = await getFocusedPeerId(host.page);
    const participantInitialFocus = await getFocusedPeerId(participant.page);

    console.log('[E2E] Initial focus - Host:', hostInitialFocus, 'Participant:', participantInitialFocus);

    // Host should see self focused (null)
    expect(hostInitialFocus).toBe(null);
    // Participant should see host focused
    expect(participantInitialFocus).toBe(hostSelfId);

    // Verify via UI
    await waitForTileFocused(host.page, 'You', 5000);
    await waitForTileFocused(participant.page, 'Host', 5000);
    console.log('[E2E] Initial focus sync verified');

    // ==========================================
    // Test: Host clicks on Participant's tile
    // ==========================================
    console.log('[E2E] Host clicking on Participant tile...');
    await host.page.click('[role="button"][aria-label*="Participant"]');
    await sleep(2000);

    const hostFocusAfterClick1 = await getFocusedPeerId(host.page);
    const participantFocusAfterClick1 = await getFocusedPeerId(participant.page);

    await waitForTileFocused(host.page, 'Participant', 5000);
    expect(hostFocusAfterClick1).toBe(participantPeerIdOnHost);

    await waitForTileFocused(participant.page, 'You', 5000);
    expect(participantFocusAfterClick1).toBe(null);
    console.log('[E2E] Focus sync verified: Both showing Participant focused');

    // ==========================================
    // Test: Participant clicks on Host's tile
    // ==========================================
    console.log('[E2E] Participant clicking on Host tile...');
    await participant.page.click('[role="button"][aria-label*="Host"]');
    await sleep(2000);

    const participantFocusAfterClick2 = await getFocusedPeerId(participant.page);
    const hostFocusAfterClick2 = await getFocusedPeerId(host.page);

    await waitForTileFocused(participant.page, 'Host', 5000);
    expect(participantFocusAfterClick2).toBe(hostPeerIdOnParticipant);

    await waitForTileFocused(host.page, 'You', 5000);
    expect(hostFocusAfterClick2).toBe(null);
    console.log('[E2E] Focus sync verified: Both showing Host focused');

    // ==========================================
    // Test: Participant clicks on their own tile (You)
    // ==========================================
    console.log('[E2E] Participant clicking on their own (You) tile...');
    await participant.page.click('[role="button"][aria-label*="You"]');
    await sleep(2000);

    const participantFocusAfterClick3 = await getFocusedPeerId(participant.page);
    const hostFocusAfterClick3 = await getFocusedPeerId(host.page);

    await waitForTileFocused(participant.page, 'You', 5000);
    expect(participantFocusAfterClick3).toBe(null);

    await waitForTileFocused(host.page, 'Participant', 5000);
    expect(hostFocusAfterClick3).toBe(participantPeerIdOnHost);
    console.log('[E2E] Focus sync verified: Both showing Participant focused');

    // ==========================================
    // Test: Host clicks on their own tile (You)
    // ==========================================
    console.log('[E2E] Host clicking on their own (You) tile...');
    await host.page.click('[role="button"][aria-label*="You"]');
    await sleep(2000);

    const hostFocusAfterClick4 = await getFocusedPeerId(host.page);
    const participantFocusAfterClick4 = await getFocusedPeerId(participant.page);

    await waitForTileFocused(host.page, 'You', 5000);
    expect(hostFocusAfterClick4).toBe(null);

    await waitForTileFocused(participant.page, 'Host', 5000);
    expect(participantFocusAfterClick4).toBe(hostPeerIdOnParticipant);
    console.log('[E2E] Focus sync verified: Both showing Host focused');

    console.log('[E2E] All focus sync tests passed!');
  });

  /**
   * Test 2: Video streaming and MainDisplay work correctly
   *
   * This consolidated test covers:
   * - Screen share focus syncs correctly (from test 3)
   * - MainDisplay shows correct video when switching focus (from test 4)
   * - Camera streams are transmitted between peers (from test 5)
   */
  test('video streaming and MainDisplay work correctly', async () => {
    // Launch instances
    console.log('[E2E] Launching host and participant instances...');
    host = await launchApp('host');
    participant = await launchApp('participant');

    // Setup profiles
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // Host creates session
    console.log('[E2E] Host creating session...');
    const sessionId = await createSession(host.page);

    // Verify host has local camera stream
    const hostLocalStream = await getLocalStreamState(host.page);
    console.log('[E2E] Host has localStream:', hostLocalStream?.hasLocalStream);
    expect(hostLocalStream?.hasLocalStream).toBe(true);

    // Participant joins
    console.log('[E2E] Participant joining session...');
    await joinSession(participant.page, sessionId);

    // Verify participant has local camera stream
    const participantLocalStream = await getLocalStreamState(participant.page);
    console.log('[E2E] Participant has localStream:', participantLocalStream?.hasLocalStream);
    expect(participantLocalStream?.hasLocalStream).toBe(true);

    // Wait for P2P connection
    await waitForP2PConnection(host.page, participant.page);

    // Wait for streams to propagate
    await sleep(5000);

    // ==========================================
    // Verify camera streams are transmitted
    // ==========================================
    console.log('[E2E] Verifying camera stream transmission...');

    const participantOnHost = await getPeerByName(host.page, 'Participant');
    const hostOnParticipant = await getPeerByName(participant.page, 'Host');

    console.log('[E2E] Participant peer on host:', participantOnHost);
    console.log('[E2E] Host peer on participant:', hostOnParticipant);

    expect(participantOnHost?.hasStream).toBe(true);
    expect(hostOnParticipant?.hasStream).toBe(true);
    console.log('[E2E] Camera stream transmission verified');

    // ==========================================
    // Start screen share on both peers
    // ==========================================
    console.log('[E2E] Starting screen share on HOST...');
    await startScreenShare(host.page);
    console.log('[E2E] Host screen share started');

    console.log('[E2E] Starting screen share on PARTICIPANT...');
    await startScreenShare(participant.page);
    console.log('[E2E] Participant screen share started');

    // Wait for screen share badges
    await waitForPeerScreenShareBadge(host.page, 'Participant', 30000);
    await waitForPeerScreenShareBadge(participant.page, 'Host User', 30000);
    console.log('[E2E] Both peers see each other\'s screen share badges');

    // Wait for screen streams to propagate
    await sleep(15000);

    // ==========================================
    // Verify screen streams are transmitted
    // ==========================================
    const participantWithScreen = await getPeerByName(host.page, 'Participant');
    console.log('[E2E] Participant has screenStream on host:', participantWithScreen?.hasScreenStream);
    expect(participantWithScreen?.hasScreenStream).toBe(true);

    // ==========================================
    // Verify MainDisplay shows video
    // ==========================================
    console.log('[E2E] Checking MainDisplay shows local screen share...');

    const hostMainDisplayHasVideo = await host.page.evaluate(() => {
      const mainDisplay = document.querySelector('[role="region"][aria-label*="Main video display"]');
      const video = mainDisplay?.querySelector('video');
      return video?.srcObject !== null && video?.srcObject !== undefined;
    });
    expect(hostMainDisplayHasVideo).toBe(true);
    console.log('[E2E] Host MainDisplay has video');

    // ==========================================
    // Switch focus and verify MainDisplay updates
    // ==========================================
    const participantPeerIdOnHost = await getPeerIdByName(host.page, 'Participant');

    console.log('[E2E] Host clicking on Participant tile to switch focus...');
    await host.page.click('[role="button"][aria-label*="Participant"]');
    await sleep(2000);

    // Verify focus changed
    const hostFocus = await getFocusedPeerId(host.page);
    expect(hostFocus).toBe(participantPeerIdOnHost);

    // Verify MainDisplay shows participant's video
    const mainDisplayInfo = await host.page.evaluate(() => {
      const mainDisplay = document.querySelector('[role="region"][aria-label*="Main video display"]');
      const video = mainDisplay?.querySelector('video');

      const peerStore = (
        window as unknown as Record<
          string,
          { getState?: () => { peers?: Array<{ id: string; screenStream?: MediaStream | null; stream?: MediaStream | null }> } }
        >
      ).usePeerStore;
      const sessionStore = (
        window as unknown as Record<
          string,
          { getState?: () => { focusedPeerId?: string | null } }
        >
      ).useSessionStore;

      const focusedPeerId = sessionStore?.getState?.()?.focusedPeerId;
      const peers = peerStore?.getState?.()?.peers ?? [];
      const focusedPeer = peers.find((p) => p.id === focusedPeerId);

      return {
        hasVideo: !!video,
        hasVideoSrcObject: video?.srcObject !== null && video?.srcObject !== undefined,
        focusedPeerHasScreenStream: !!focusedPeer?.screenStream,
        focusedPeerHasStream: !!focusedPeer?.stream,
      };
    });

    console.log('[E2E] MainDisplay info after focus switch:', mainDisplayInfo);
    expect(mainDisplayInfo.hasVideo).toBe(true);
    expect(mainDisplayInfo.hasVideoSrcObject).toBe(true);
    expect(mainDisplayInfo.focusedPeerHasScreenStream).toBe(true);

    console.log('[E2E] Video streaming and MainDisplay test passed!');
  });
});
