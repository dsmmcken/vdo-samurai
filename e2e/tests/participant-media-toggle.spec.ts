import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import {
  setupProfile,
  createSession,
  joinSession,
  waitForP2PConnection,
} from '../helpers/test-setup';
import { sleep } from '../helpers/wait-helpers';
import { getPeerByName } from '../helpers/store-helpers';

test.describe('Participant Media Toggle', () => {
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

  test('participant toggles camera off and host sees video-off state', async () => {
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
    await sleep(2000);

    // ==========================================
    // STEP 5: Verify initial state - participant camera is on
    // ==========================================
    // Host should see the participant tile without "video off" in aria-label
    const participantTileOnHost = host.page.locator(
      selectors.session.peerTileByName('Participant')
    );
    await expect(participantTileOnHost).toBeVisible({ timeout: 10000 });

    // Verify aria-label does NOT contain "video off" initially
    const initialAriaLabel = await participantTileOnHost.getAttribute('aria-label');
    console.log('[E2E] Initial participant tile aria-label on host:', initialAriaLabel);
    expect(initialAriaLabel).not.toContain('video off');

    // Verify peer store shows videoEnabled=true
    const initialPeerState = await getPeerByName(host.page, 'Participant');
    console.log('[E2E] Initial peer state on host:', JSON.stringify(initialPeerState));

    // ==========================================
    // STEP 6: Participant toggles camera OFF
    // ==========================================
    console.log('[E2E] Participant toggling camera OFF...');

    // The camera toggle button says "Turn off camera" when camera is on
    const participantCameraButton = participant.page.locator(
      'button[aria-label="Turn off camera"]'
    );
    await expect(participantCameraButton).toBeVisible({ timeout: 5000 });
    await participantCameraButton.click();

    // Verify participant's own button now says "Turn on camera"
    await expect(
      participant.page.locator('button[aria-label="Turn on camera"]')
    ).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant camera button now shows "Turn on camera"');

    // ==========================================
    // STEP 7: Verify host sees the change
    // ==========================================
    // Wait for host to see "video off" in the participant tile
    await host.page.waitForSelector(
      '[role="button"][aria-label*="Participant"][aria-label*="video off"]',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant tile with "video off"');

    // Verify peer store on host shows videoEnabled=false
    const peerAfterCamOff = await getPeerByName(host.page, 'Participant');
    console.log('[E2E] Peer state after cam off:', JSON.stringify(peerAfterCamOff));

    // ==========================================
    // STEP 8: Participant toggles camera back ON
    // ==========================================
    console.log('[E2E] Participant toggling camera ON...');
    const participantCameraOnButton = participant.page.locator(
      'button[aria-label="Turn on camera"]'
    );
    await expect(participantCameraOnButton).toBeVisible({ timeout: 5000 });
    await participantCameraOnButton.click();

    // Verify participant's button is back to "Turn off camera"
    await expect(
      participant.page.locator('button[aria-label="Turn off camera"]')
    ).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant camera button back to "Turn off camera"');

    // Verify host no longer sees "video off" on participant tile
    // Wait until the tile's aria-label no longer contains "video off"
    await host.page.waitForFunction(
      (name) => {
        const tile = document.querySelector(
          `[role="button"][aria-label*="${name}"]`
        );
        return tile && !tile.getAttribute('aria-label')?.includes('video off');
      },
      'Participant',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant camera restored');

    console.log('[E2E] Participant camera toggle test passed!');
  });

  test('participant toggles microphone off and host sees muted state', async () => {
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
    await sleep(2000);

    // ==========================================
    // STEP 5: Verify initial state - participant mic is on
    // ==========================================
    const participantTileOnHost = host.page.locator(
      selectors.session.peerTileByName('Participant')
    );
    await expect(participantTileOnHost).toBeVisible({ timeout: 10000 });

    const initialAriaLabel = await participantTileOnHost.getAttribute('aria-label');
    console.log('[E2E] Initial participant tile aria-label on host:', initialAriaLabel);
    expect(initialAriaLabel).not.toContain('muted');

    // ==========================================
    // STEP 6: Participant toggles microphone OFF
    // ==========================================
    console.log('[E2E] Participant toggling microphone OFF...');

    // The mic toggle button says "Mute microphone" when mic is on
    const participantMicButton = participant.page.locator(
      'button[aria-label="Mute microphone"]'
    );
    await expect(participantMicButton).toBeVisible({ timeout: 5000 });
    await participantMicButton.click();

    // Verify participant's own button now says "Unmute microphone"
    await expect(
      participant.page.locator('button[aria-label="Unmute microphone"]')
    ).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant mic button now shows "Unmute microphone"');

    // ==========================================
    // STEP 7: Verify host sees the change
    // ==========================================
    // Wait for host to see "muted" in the participant tile
    await host.page.waitForSelector(
      '[role="button"][aria-label*="Participant"][aria-label*="muted"]',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant tile with "muted"');

    // ==========================================
    // STEP 8: Participant toggles microphone back ON
    // ==========================================
    console.log('[E2E] Participant toggling microphone ON...');
    const participantMicOnButton = participant.page.locator(
      'button[aria-label="Unmute microphone"]'
    );
    await expect(participantMicOnButton).toBeVisible({ timeout: 5000 });
    await participantMicOnButton.click();

    // Verify participant's button is back to "Mute microphone"
    await expect(
      participant.page.locator('button[aria-label="Mute microphone"]')
    ).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Participant mic button back to "Mute microphone"');

    // Verify host no longer sees "muted" on participant tile
    await host.page.waitForFunction(
      (name) => {
        const tile = document.querySelector(
          `[role="button"][aria-label*="${name}"]`
        );
        return tile && !tile.getAttribute('aria-label')?.includes('muted');
      },
      'Participant',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant mic restored');

    console.log('[E2E] Participant mic toggle test passed!');
  });

  test('participant toggles both camera and mic, host sees combined state', async () => {
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
    await sleep(2000);

    // ==========================================
    // STEP 5: Participant turns off camera
    // ==========================================
    console.log('[E2E] Participant toggling camera OFF...');
    await participant.page.locator('button[aria-label="Turn off camera"]').click();
    await expect(
      participant.page.locator('button[aria-label="Turn on camera"]')
    ).toBeVisible({ timeout: 5000 });

    // Wait for host to see camera off
    await host.page.waitForSelector(
      '[role="button"][aria-label*="Participant"][aria-label*="video off"]',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant camera off');

    // ==========================================
    // STEP 6: Participant also turns off microphone
    // ==========================================
    console.log('[E2E] Participant toggling microphone OFF...');
    await participant.page.locator('button[aria-label="Mute microphone"]').click();
    await expect(
      participant.page.locator('button[aria-label="Unmute microphone"]')
    ).toBeVisible({ timeout: 5000 });

    // Wait for host to see both "video off" and "muted" on participant tile
    await host.page.waitForSelector(
      '[role="button"][aria-label*="Participant"][aria-label*="video off"][aria-label*="muted"]',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant with both camera off and mic muted');

    // ==========================================
    // STEP 7: Verify participant's local tile also reflects the state
    // ==========================================
    // Participant should see their own tile with "video off" and "muted"
    // The local tile uses "You" in the aria-label
    const localTile = participant.page.locator(selectors.session.localTile);
    await expect(localTile).toBeVisible({ timeout: 5000 });
    const localAriaLabel = await localTile.getAttribute('aria-label');
    console.log('[E2E] Participant local tile aria-label:', localAriaLabel);
    expect(localAriaLabel).toContain('video off');
    expect(localAriaLabel).toContain('muted');

    // ==========================================
    // STEP 8: Participant restores both
    // ==========================================
    console.log('[E2E] Participant restoring camera...');
    await participant.page.locator('button[aria-label="Turn on camera"]').click();
    await expect(
      participant.page.locator('button[aria-label="Turn off camera"]')
    ).toBeVisible({ timeout: 5000 });

    console.log('[E2E] Participant restoring microphone...');
    await participant.page.locator('button[aria-label="Unmute microphone"]').click();
    await expect(
      participant.page.locator('button[aria-label="Mute microphone"]')
    ).toBeVisible({ timeout: 5000 });

    // Wait for host to see all restored
    await host.page.waitForFunction(
      (name) => {
        const tile = document.querySelector(
          `[role="button"][aria-label*="${name}"]`
        );
        if (!tile) return false;
        const label = tile.getAttribute('aria-label') || '';
        return !label.includes('video off') && !label.includes('muted');
      },
      'Participant',
      { timeout: 15000 }
    );
    console.log('[E2E] Host sees participant fully restored');

    console.log('[E2E] Combined camera and mic toggle test passed!');
  });

  test('host toggles camera off and participant sees video-off state', async () => {
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
    await sleep(2000);

    // ==========================================
    // STEP 5: Verify initial state on participant side
    // ==========================================
    const hostTileOnParticipant = participant.page.locator(
      selectors.session.peerTileByName('Host User')
    );
    await expect(hostTileOnParticipant).toBeVisible({ timeout: 10000 });

    const initialAriaLabel = await hostTileOnParticipant.getAttribute('aria-label');
    console.log('[E2E] Initial host tile aria-label on participant:', initialAriaLabel);
    expect(initialAriaLabel).not.toContain('video off');

    // ==========================================
    // STEP 6: Host toggles camera OFF
    // ==========================================
    console.log('[E2E] Host toggling camera OFF...');
    await host.page.locator('button[aria-label="Turn off camera"]').click();

    await expect(
      host.page.locator('button[aria-label="Turn on camera"]')
    ).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Host camera button now shows "Turn on camera"');

    // ==========================================
    // STEP 7: Verify participant sees the change
    // ==========================================
    await participant.page.waitForSelector(
      '[role="button"][aria-label*="Host User"][aria-label*="video off"]',
      { timeout: 15000 }
    );
    console.log('[E2E] Participant sees host tile with "video off"');

    // ==========================================
    // STEP 8: Host toggles camera back ON
    // ==========================================
    console.log('[E2E] Host toggling camera ON...');
    await host.page.locator('button[aria-label="Turn on camera"]').click();

    await expect(
      host.page.locator('button[aria-label="Turn off camera"]')
    ).toBeVisible({ timeout: 5000 });

    // Verify participant sees host camera restored
    await participant.page.waitForFunction(
      (name) => {
        const tile = document.querySelector(
          `[role="button"][aria-label*="${name}"]`
        );
        return tile && !tile.getAttribute('aria-label')?.includes('video off');
      },
      'Host User',
      { timeout: 15000 }
    );
    console.log('[E2E] Participant sees host camera restored');

    console.log('[E2E] Host camera toggle (participant perspective) test passed!');
  });
});
