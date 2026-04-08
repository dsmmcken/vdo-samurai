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
import { sleep, waitForPeerScreenShareBadge } from '../helpers/wait-helpers';

test.describe('Tile Grid - Multiple Peers with Labels and Ordering', () => {
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

  test('solo host sees single tile labeled "You" with host badge', async () => {
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

    // Setup profile and create session
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await createSession(host.page);
    console.log('[E2E] Session created');

    // Wait for the tile grid to render
    await host.page.waitForSelector(selectors.session.participantList, { timeout: 15000 });

    // Verify exactly one tile is visible
    const tiles = host.page.locator(selectors.session.userTile);
    await expect(tiles).toHaveCount(1);
    console.log('[E2E] Exactly 1 tile visible');

    // Verify the tile is "You"
    const localTile = host.page.locator(selectors.session.userTileByName('You'));
    await expect(localTile).toBeVisible();
    console.log('[E2E] Local tile labeled "You"');

    // Verify the tile has the host badge
    const hostTile = host.page.locator(selectors.session.hostTile);
    await expect(hostTile).toBeVisible();
    console.log('[E2E] Host badge present on tile');

    // Verify the aria-label includes (Host)
    const ariaLabel = await localTile.getAttribute('aria-label');
    expect(ariaLabel).toContain('(Host)');
    console.log('[E2E] aria-label contains "(Host)":', ariaLabel);

    // Verify the tile is focused (aria-pressed="true") by default
    await expect(localTile).toHaveAttribute('aria-pressed', 'true');
    console.log('[E2E] Local tile is focused by default');

    // Verify participant list aria-label shows correct count
    const participantList = host.page.locator(selectors.session.participantList);
    const listAriaLabel = await participantList.getAttribute('aria-label');
    expect(listAriaLabel).toContain('1 participant');
    console.log('[E2E] Participant list label:', listAriaLabel);

    console.log('[E2E] Solo host tile test passed!');
  });

  test('host and participant see correct tiles with names, host badge, and ordering', async () => {
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

    // Setup profiles
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Joiner', 'Joiner Full Name');

    // Host creates session
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Participant joins
    await joinSession(participant.page, sessionId);

    // Wait for P2P connection
    await waitForP2PConnection(host.page, participant.page);
    await sleep(2000); // Let tile grid stabilize

    // ==========================================
    // Verify HOST sees 2 tiles
    // ==========================================
    console.log('[E2E] Verifying host tile grid...');
    const hostTiles = host.page.locator(selectors.session.userTile);
    await expect(hostTiles).toHaveCount(2);
    console.log('[E2E] Host sees 2 tiles');

    // Verify host's participant list label shows 2 participants
    const hostParticipantList = host.page.locator(selectors.session.participantList);
    const hostListLabel = await hostParticipantList.getAttribute('aria-label');
    expect(hostListLabel).toContain('2 participants');
    console.log('[E2E] Host participant list label:', hostListLabel);

    // Host should see "You" tile and "Joiner" tile
    const hostSelfTile = host.page.locator(selectors.session.userTileByName('You'));
    await expect(hostSelfTile).toBeVisible();
    console.log('[E2E] Host sees "You" tile');

    const hostPeerTile = host.page.locator(selectors.session.userTileByName('Joiner'));
    await expect(hostPeerTile).toBeVisible();
    console.log('[E2E] Host sees "Joiner" tile');

    // Verify host badge is on "You" tile (host's self tile)
    const hostBadgeTile = host.page.locator(selectors.session.hostTile);
    await expect(hostBadgeTile).toHaveCount(1);
    const hostBadgeNameAttr = await hostBadgeTile.getAttribute('data-tile-name');
    expect(hostBadgeNameAttr).toBe('You');
    console.log('[E2E] Host badge is on the "You" tile (host side)');

    // Verify host's self tile has "(Host)" in aria-label
    const hostSelfAriaLabel = await hostSelfTile.getAttribute('aria-label');
    expect(hostSelfAriaLabel).toContain('(Host)');
    console.log('[E2E] Host self tile aria-label:', hostSelfAriaLabel);

    // Verify "Joiner" tile does NOT have host badge
    const joinerTileOnHost = host.page.locator(
      `${selectors.session.userTileByName('Joiner')}[data-tile-host="true"]`
    );
    await expect(joinerTileOnHost).toHaveCount(0);
    console.log('[E2E] Joiner tile has no host badge (on host side)');

    // ==========================================
    // Verify tile ordering on host: "You" first, then "Joiner"
    // ==========================================
    const hostTileNames = await host.page.locator(selectors.session.userTile).evaluateAll(
      (elements) => elements.map((el) => el.getAttribute('data-tile-name'))
    );
    console.log('[E2E] Host tile order:', hostTileNames);
    expect(hostTileNames[0]).toBe('You');
    expect(hostTileNames[1]).toBe('Joiner');

    // ==========================================
    // Verify PARTICIPANT sees 2 tiles
    // ==========================================
    console.log('[E2E] Verifying participant tile grid...');
    const participantTiles = participant.page.locator(selectors.session.userTile);
    await expect(participantTiles).toHaveCount(2);
    console.log('[E2E] Participant sees 2 tiles');

    // Participant should see "You" tile and "Host User" tile
    const participantSelfTile = participant.page.locator(
      selectors.session.userTileByName('You')
    );
    await expect(participantSelfTile).toBeVisible();
    console.log('[E2E] Participant sees "You" tile');

    const participantHostTile = participant.page.locator(
      selectors.session.userTileByName('Host User')
    );
    await expect(participantHostTile).toBeVisible();
    console.log('[E2E] Participant sees "Host User" tile');

    // Verify participant list label shows 2
    const participantListEl = participant.page.locator(selectors.session.participantList);
    const participantListLabel = await participantListEl.getAttribute('aria-label');
    expect(participantListLabel).toContain('2 participants');
    console.log('[E2E] Participant list label:', participantListLabel);

    // Verify host badge is on "Host User" tile (not on participant's self)
    const participantHostBadgeTile = participant.page.locator(selectors.session.hostTile);
    await expect(participantHostBadgeTile).toHaveCount(1);
    const participantHostBadgeName = await participantHostBadgeTile.getAttribute('data-tile-name');
    expect(participantHostBadgeName).toBe('Host User');
    console.log('[E2E] Host badge is on "Host User" tile (participant side)');

    // Verify participant's "You" tile does NOT have "(Host)" in aria-label
    const participantSelfAriaLabel = await participantSelfTile.getAttribute('aria-label');
    expect(participantSelfAriaLabel).not.toContain('(Host)');
    console.log('[E2E] Participant self tile aria-label:', participantSelfAriaLabel);

    // Verify "Host User" tile has "(Host)" in aria-label
    const participantHostAriaLabel = await participantHostTile.getAttribute('aria-label');
    expect(participantHostAriaLabel).toContain('(Host)');
    console.log('[E2E] Host User tile aria-label on participant side:', participantHostAriaLabel);

    // ==========================================
    // Verify tile ordering on participant: "You" first, then "Host User"
    // ==========================================
    const participantTileNames = await participant.page.locator(
      selectors.session.userTile
    ).evaluateAll(
      (elements) => elements.map((el) => el.getAttribute('data-tile-name'))
    );
    console.log('[E2E] Participant tile order:', participantTileNames);
    expect(participantTileNames[0]).toBe('You');
    expect(participantTileNames[1]).toBe('Host User');

    console.log('[E2E] Multi-peer tile grid test passed!');
  });

  test('screen share badge appears on correct tile', async () => {
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

    // Setup profiles
    await setupProfile(host.page, 'Host User', 'Host Full Name');
    await setupProfile(participant.page, 'Joiner', 'Joiner Full Name');

    // Host creates session
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Participant joins
    await joinSession(participant.page, sessionId);
    await waitForP2PConnection(host.page, participant.page);
    await sleep(2000);

    // Host starts screen share
    console.log('[E2E] Host starting screen share...');
    await startScreenShare(host.page);

    // Participant should see the screen share badge on host's tile
    await waitForPeerScreenShareBadge(participant.page, 'Host User', 30000);
    console.log('[E2E] Participant sees screen share badge on Host User tile');

    // Verify Host User's tile aria-label contains "sharing screen" on participant side
    const hostTileOnParticipant = participant.page.locator(
      selectors.session.userTileByName('Host User')
    );
    const ariaLabel = await hostTileOnParticipant.getAttribute('aria-label');
    expect(ariaLabel).toContain('sharing screen');
    console.log('[E2E] Host User tile aria-label includes "sharing screen":', ariaLabel);

    // Verify participant's own tile does NOT have "sharing screen"
    const participantSelfTile = participant.page.locator(
      selectors.session.userTileByName('You')
    );
    const selfAriaLabel = await participantSelfTile.getAttribute('aria-label');
    expect(selfAriaLabel).not.toContain('sharing screen');
    console.log('[E2E] Participant self tile does not show sharing screen');

    // Verify tile count is still 2
    const tiles = participant.page.locator(selectors.session.userTile);
    await expect(tiles).toHaveCount(2);
    console.log('[E2E] Still 2 tiles after screen share');

    console.log('[E2E] Screen share badge test passed!');
  });
});
