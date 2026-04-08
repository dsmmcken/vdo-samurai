import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection,
  startScreenShare
} from '../helpers/test-setup';
import {
  sleep,
  waitForPeerScreenShareBadge,
  waitForLocalScreenShare
} from '../helpers/wait-helpers';
import { getPeerByName, getLocalStreamState } from '../helpers/store-helpers';

test.describe('Participant Screen Share', () => {
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

  test('participant shares screen and host sees it in tile badge and MainDisplay', async () => {
    // ==========================================
    // STEP 1: Launch both instances
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
    // STEP 2: Setup profiles
    // ==========================================
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // ==========================================
    // STEP 3: Host creates session, participant joins
    // ==========================================
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    await joinSession(participant.page, sessionId);
    console.log('[E2E] Participant joined session');

    // ==========================================
    // STEP 4: Wait for P2P connection
    // ==========================================
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    // Let streams stabilize
    await sleep(3000);

    // ==========================================
    // STEP 5: Verify initial state - no screen sharing
    // ==========================================
    const participantTileOnHost = host.page.locator(
      selectors.session.peerTileByName('Participant')
    );
    await expect(participantTileOnHost).toBeVisible({ timeout: 10000 });

    const initialAriaLabel = await participantTileOnHost.getAttribute('aria-label');
    console.log('[E2E] Initial participant tile aria-label on host:', initialAriaLabel);
    expect(initialAriaLabel).not.toContain('sharing screen');

    // Verify peer store shows no screen stream
    const initialPeerState = await getPeerByName(host.page, 'Participant');
    console.log('[E2E] Initial peer state on host:', JSON.stringify(initialPeerState));
    expect(initialPeerState?.hasScreenStream).toBe(false);

    // ==========================================
    // STEP 6: Participant starts screen share
    // ==========================================
    console.log('[E2E] Participant starting screen share...');
    await startScreenShare(participant.page);
    console.log('[E2E] Participant screen share started');

    // Verify participant's own local screen stream is set
    const participantStreamState = await getLocalStreamState(participant.page);
    console.log('[E2E] Participant local stream state:', JSON.stringify(participantStreamState));
    expect(participantStreamState?.hasLocalScreenStream).toBe(true);

    // Verify participant's screen share button shows active state
    const participantScreenButton = participant.page.locator(
      'button[aria-label="Stop sharing screen"]'
    );
    await expect(participantScreenButton).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant screen share button shows active state');

    // ==========================================
    // STEP 7: Verify host sees participant's screen share badge
    // ==========================================
    console.log('[E2E] Waiting for host to see participant screen share badge...');
    await waitForPeerScreenShareBadge(host.page, 'Participant', 30000);
    console.log('[E2E] Host sees participant screen share badge');

    // Verify aria-label contains "sharing screen"
    const sharingAriaLabel = await participantTileOnHost.getAttribute('aria-label');
    console.log('[E2E] Participant tile aria-label after screen share:', sharingAriaLabel);
    expect(sharingAriaLabel).toContain('sharing screen');

    // ==========================================
    // STEP 8: Verify host receives participant's screen stream
    // ==========================================
    // Wait for the screen stream to propagate through WebRTC
    await sleep(10000);

    const peerWithScreen = await getPeerByName(host.page, 'Participant');
    console.log('[E2E] Peer state after screen share:', JSON.stringify(peerWithScreen));
    expect(peerWithScreen?.hasScreenStream).toBe(true);
    console.log('[E2E] Host received participant screen stream');

    // ==========================================
    // STEP 9: Focus on participant and verify MainDisplay shows screen share
    // ==========================================
    console.log('[E2E] Host clicking on Participant tile to focus...');
    await host.page.click(selectors.session.peerTileByName('Participant'));
    await sleep(2000);

    // Verify MainDisplay shows participant's screen share
    const mainDisplayInfo = await host.page.evaluate(() => {
      const mainDisplay = document.querySelector(
        '[role="region"][aria-label*="Main video display"]'
      );
      const ariaLabel = mainDisplay?.getAttribute('aria-label') || '';
      const video = mainDisplay?.querySelector('video');
      return {
        ariaLabel,
        hasVideo: !!video,
        hasVideoSrcObject: video?.srcObject !== null && video?.srcObject !== undefined
      };
    });

    console.log('[E2E] MainDisplay info:', JSON.stringify(mainDisplayInfo));
    expect(mainDisplayInfo.hasVideo).toBe(true);
    expect(mainDisplayInfo.hasVideoSrcObject).toBe(true);
    expect(mainDisplayInfo.ariaLabel).toContain('Participant');
    expect(mainDisplayInfo.ariaLabel).toContain('screen share');
    console.log('[E2E] MainDisplay shows participant screen share correctly');

    // ==========================================
    // STEP 10: Participant stops screen share
    // ==========================================
    console.log('[E2E] Participant stopping screen share...');
    await participant.page.click('button[aria-label="Stop sharing screen"]');

    // Verify participant's screen share button reverts
    await expect(participant.page.locator('button[aria-label="Share screen"]')).toBeVisible({
      timeout: 5000
    });
    console.log('[E2E] Participant screen share button reverted to inactive');

    // Verify participant's local screen stream is cleared
    await participant.page.waitForFunction(
      () => {
        const store = (
          window as unknown as Record<
            string,
            { getState?: () => { localScreenStream?: MediaStream | null } }
          >
        ).useSessionStore;
        return store?.getState?.()?.localScreenStream === null;
      },
      undefined,
      { timeout: 10000 }
    );
    console.log('[E2E] Participant local screen stream cleared');

    // ==========================================
    // STEP 11: Verify host no longer sees screen share badge
    // ==========================================
    console.log('[E2E] Waiting for host to see screen share badge removed...');
    await host.page.waitForFunction(
      (name) => {
        const tile = document.querySelector(`[role="button"][aria-label*="${name}"]`);
        return tile && !tile.getAttribute('aria-label')?.includes('sharing screen');
      },
      'Participant',
      { timeout: 30000 }
    );
    console.log('[E2E] Host no longer sees participant screen share badge');

    console.log('[E2E] Participant screen share test passed!');
  });

  test('participant screen share auto-focuses on host side', async () => {
    // ==========================================
    // STEP 1: Launch both instances
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
    // STEP 2: Setup profiles
    // ==========================================
    console.log('[E2E] Setting up profiles...');
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Participant', 'Participant Full Name');

    // ==========================================
    // STEP 3: Host creates session, participant joins
    // ==========================================
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    await joinSession(participant.page, sessionId);
    console.log('[E2E] Participant joined session');

    // ==========================================
    // STEP 4: Wait for P2P connection
    // ==========================================
    await waitForP2PConnection(host.page, participant.page);
    console.log('[E2E] P2P connection established');

    await sleep(3000);

    // ==========================================
    // STEP 5: Verify host is initially focused on self
    // ==========================================
    const initialFocusedTile = host.page.locator('[role="button"][aria-pressed="true"]');
    const initialLabel = await initialFocusedTile.getAttribute('aria-label');
    console.log('[E2E] Initial focused tile on host:', initialLabel);
    expect(initialLabel).toContain('You');

    // ==========================================
    // STEP 6: Participant starts screen share
    // ==========================================
    console.log('[E2E] Participant starting screen share...');
    await startScreenShare(participant.page);

    // Verify participant's local screen stream is active
    await waitForLocalScreenShare(participant.page, 10000);
    console.log('[E2E] Participant screen share confirmed active');

    // ==========================================
    // STEP 7: Verify host sees the screen share badge on participant tile
    // ==========================================
    await waitForPeerScreenShareBadge(host.page, 'Participant', 30000);
    console.log('[E2E] Host sees participant screen share badge');

    // Wait for screen stream to propagate
    await sleep(10000);

    // ==========================================
    // STEP 8: Click participant tile to focus and verify screen share displays
    // ==========================================
    console.log('[E2E] Host clicking participant tile...');
    await host.page.click(selectors.session.peerTileByName('Participant'));
    await sleep(2000);

    // Verify participant tile is now focused
    const focusedTile = host.page.locator(
      '[role="button"][aria-label*="Participant"][aria-pressed="true"]'
    );
    await expect(focusedTile).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant tile is focused on host');

    // Verify MainDisplay now shows participant content
    const mainDisplayLabel = await host.page
      .locator('[role="region"][aria-label*="Main video display"]')
      .getAttribute('aria-label');
    console.log('[E2E] MainDisplay aria-label:', mainDisplayLabel);
    expect(mainDisplayLabel).toContain('Participant');

    // ==========================================
    // STEP 9: Host clicks back to self to verify focus returns
    // ==========================================
    console.log('[E2E] Host clicking back to own tile...');
    await host.page.click(selectors.session.localTile);
    await sleep(1000);

    const selfFocusedTile = host.page.locator(
      '[role="button"][aria-label*="You"][aria-pressed="true"]'
    );
    await expect(selfFocusedTile).toBeVisible({ timeout: 5000 });

    const selfMainDisplayLabel = await host.page
      .locator('[role="region"][aria-label*="Main video display"]')
      .getAttribute('aria-label');
    console.log('[E2E] MainDisplay after returning to self:', selfMainDisplayLabel);
    expect(selfMainDisplayLabel).toContain('You');
    console.log('[E2E] Focus returned to host self successfully');

    console.log('[E2E] Participant screen share auto-focus test passed!');
  });
});
