import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type AppInstance } from '../fixtures/electron-app';
import { selectors } from '../helpers/selectors';
import { setupProfile, createSession } from '../helpers/test-setup';

/**
 * Helper to read profile from the user store via page.evaluate
 */
async function getUserProfile(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const store = (
      window as unknown as Record<
        string,
        {
          getState?: () => {
            profile?: { displayName: string; fullName: string; subtitle: string } | null;
          };
        }
      >
    ).useUserStore;
    return store?.getState?.()?.profile ?? null;
  });
}

test.describe('Profile Editing via UserPopover', () => {
  let host: AppInstance;

  test.afterEach(async () => {
    if (host) {
      await closeApp(host);
    }
  });

  test('open popover on home page, view profile info, and edit all fields', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Setup profile with initial values
    await setupProfile(host.page, 'OriginalName', 'Original Full Name');
    console.log('[E2E] Profile setup complete');

    // Verify on home page
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Click user menu button to open popover
    const userMenuButton = host.page.locator(selectors.userPopover.userMenuButton);
    await expect(userMenuButton).toBeVisible({ timeout: 5000 });
    await userMenuButton.click();
    console.log('[E2E] Clicked user menu button');

    // Verify popover is visible
    const popover = host.page.locator(selectors.userPopover.container);
    await expect(popover).toBeVisible({ timeout: 5000 });
    console.log('[E2E] User popover is visible');

    // Verify display mode shows current profile info
    const displayName = host.page.locator(selectors.userPopover.displayName);
    await expect(displayName).toHaveText('OriginalName');
    console.log('[E2E] Display name shows "OriginalName"');

    const fullName = host.page.locator(selectors.userPopover.fullName);
    await expect(fullName).toHaveText('Original Full Name');
    console.log('[E2E] Full name shows "Original Full Name"');

    // Subtitle should not be visible (not set during profile setup)
    const subtitle = host.page.locator(selectors.userPopover.subtitle);
    await expect(subtitle).not.toBeVisible();
    console.log('[E2E] Subtitle not visible (not set)');

    // Click Edit Profile button
    const editButton = host.page.locator(selectors.userPopover.editButton);
    await expect(editButton).toBeVisible();
    await editButton.click();
    console.log('[E2E] Clicked Edit Profile button');

    // Verify edit mode is active - inputs should be visible
    const displayNameInput = host.page.locator(selectors.userPopover.displayNameInput);
    const fullNameInput = host.page.locator(selectors.userPopover.fullNameInput);
    const subtitleInput = host.page.locator(selectors.userPopover.subtitleInput);
    await expect(displayNameInput).toBeVisible({ timeout: 5000 });
    await expect(fullNameInput).toBeVisible();
    await expect(subtitleInput).toBeVisible();
    console.log('[E2E] Edit mode active - all input fields visible');

    // Verify inputs are pre-filled with current values
    await expect(displayNameInput).toHaveValue('OriginalName');
    await expect(fullNameInput).toHaveValue('Original Full Name');
    await expect(subtitleInput).toHaveValue('');
    console.log('[E2E] Inputs pre-filled with current profile values');

    // Edit all fields
    await displayNameInput.fill('UpdatedName');
    await fullNameInput.fill('Updated Full Name');
    await subtitleInput.fill('Lead Engineer');
    console.log('[E2E] Filled in new values');

    // Save the changes
    const saveButton = host.page.locator(selectors.userPopover.saveButton);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    console.log('[E2E] Clicked Save');

    // Verify popover switches back to display mode with updated values
    await expect(host.page.locator(selectors.userPopover.displayName)).toHaveText('UpdatedName', {
      timeout: 5000
    });
    await expect(host.page.locator(selectors.userPopover.fullName)).toHaveText(
      'Updated Full Name'
    );
    await expect(host.page.locator(selectors.userPopover.subtitle)).toHaveText('Lead Engineer');
    console.log('[E2E] Popover shows updated values in display mode');

    // Verify store was updated
    const profile = await getUserProfile(host.page);
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('UpdatedName');
    expect(profile!.fullName).toBe('Updated Full Name');
    expect(profile!.subtitle).toBe('Lead Engineer');
    console.log('[E2E] User store reflects updated profile');

    console.log('[E2E] Profile edit on home page test passed!');
  });

  test('cancel edit reverts changes to original values', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Setup profile
    await setupProfile(host.page, 'StableName', 'Stable Full Name');
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Open popover and enter edit mode
    await host.page.click(selectors.userPopover.userMenuButton);
    await host.page.waitForSelector(selectors.userPopover.container, { timeout: 5000 });
    await host.page.click(selectors.userPopover.editButton);
    console.log('[E2E] Entered edit mode');

    // Change the display name
    const displayNameInput = host.page.locator(selectors.userPopover.displayNameInput);
    await displayNameInput.fill('ChangedButNotSaved');
    console.log('[E2E] Changed display name to "ChangedButNotSaved"');

    // Click Cancel
    const cancelButton = host.page.locator(selectors.userPopover.cancelButton);
    await cancelButton.click();
    console.log('[E2E] Clicked Cancel');

    // Verify display mode shows the ORIGINAL values (not the changed ones)
    await expect(host.page.locator(selectors.userPopover.displayName)).toHaveText('StableName', {
      timeout: 5000
    });
    await expect(host.page.locator(selectors.userPopover.fullName)).toHaveText('Stable Full Name');
    console.log('[E2E] Display mode shows original values after cancel');

    // Verify store was NOT changed
    const profile = await getUserProfile(host.page);
    expect(profile!.displayName).toBe('StableName');
    expect(profile!.fullName).toBe('Stable Full Name');
    console.log('[E2E] User store still has original values');

    console.log('[E2E] Cancel edit test passed!');
  });

  test('save button is disabled when required fields are empty', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Setup profile
    await setupProfile(host.page, 'TestUser', 'Test Full Name');
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    // Open popover and enter edit mode
    await host.page.click(selectors.userPopover.userMenuButton);
    await host.page.waitForSelector(selectors.userPopover.container, { timeout: 5000 });
    await host.page.click(selectors.userPopover.editButton);
    console.log('[E2E] Entered edit mode');

    const saveButton = host.page.locator(selectors.userPopover.saveButton);
    const displayNameInput = host.page.locator(selectors.userPopover.displayNameInput);
    const fullNameInput = host.page.locator(selectors.userPopover.fullNameInput);

    // Save should be enabled initially (both fields filled)
    await expect(saveButton).toBeEnabled();
    console.log('[E2E] Save button enabled with both fields filled');

    // Clear display name - Save should become disabled
    await displayNameInput.fill('');
    await expect(saveButton).toBeDisabled();
    console.log('[E2E] Save button disabled when display name is empty');

    // Restore display name, clear full name - Save should be disabled
    await displayNameInput.fill('TestUser');
    await fullNameInput.fill('');
    await expect(saveButton).toBeDisabled();
    console.log('[E2E] Save button disabled when full name is empty');

    // Clear both - Save should still be disabled
    await displayNameInput.fill('');
    await expect(saveButton).toBeDisabled();
    console.log('[E2E] Save button disabled when both fields are empty');

    // Fill both - Save should become enabled
    await displayNameInput.fill('Valid');
    await fullNameInput.fill('Valid Name');
    await expect(saveButton).toBeEnabled();
    console.log('[E2E] Save button re-enabled with both fields filled');

    // Whitespace-only should also disable Save
    await displayNameInput.fill('   ');
    await expect(saveButton).toBeDisabled();
    console.log('[E2E] Save button disabled with whitespace-only display name');

    console.log('[E2E] Save button validation test passed!');
  });

  test('edit profile during active session updates store and persists', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    // Handle dialogs
    host.page.on('dialog', async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // Dialog may already be handled
      }
    });

    // Setup profile and create session
    await setupProfile(host.page, 'SessionHost', 'Session Host Full');
    const sessionId = await createSession(host.page);
    console.log('[E2E] Session created:', sessionId);

    // Verify record button visible (confirms we're on session page)
    await host.page.waitForSelector(selectors.session.recordButton, { timeout: 10000 });

    // Open popover on the session page
    const userMenuButton = host.page.locator(selectors.userPopover.userMenuButton);
    await expect(userMenuButton).toBeVisible({ timeout: 5000 });
    await userMenuButton.click();

    const popover = host.page.locator(selectors.userPopover.container);
    await expect(popover).toBeVisible({ timeout: 5000 });
    console.log('[E2E] User popover visible on session page');

    // Verify current values in display mode
    await expect(host.page.locator(selectors.userPopover.displayName)).toHaveText('SessionHost');
    await expect(host.page.locator(selectors.userPopover.fullName)).toHaveText(
      'Session Host Full'
    );
    console.log('[E2E] Popover shows correct profile on session page');

    // Enter edit mode
    await host.page.click(selectors.userPopover.editButton);
    console.log('[E2E] Entered edit mode on session page');

    // Edit display name and add subtitle
    const displayNameInput = host.page.locator(selectors.userPopover.displayNameInput);
    const subtitleInput = host.page.locator(selectors.userPopover.subtitleInput);
    await displayNameInput.fill('RenamedHost');
    await subtitleInput.fill('Director');
    console.log('[E2E] Changed display name and added subtitle');

    // Save
    await host.page.click(selectors.userPopover.saveButton);
    console.log('[E2E] Saved changes');

    // Verify popover shows updated values
    await expect(host.page.locator(selectors.userPopover.displayName)).toHaveText('RenamedHost', {
      timeout: 5000
    });
    await expect(host.page.locator(selectors.userPopover.subtitle)).toHaveText('Director');
    console.log('[E2E] Popover reflects updated values on session page');

    // Verify the user store was updated
    const profile = await getUserProfile(host.page);
    expect(profile!.displayName).toBe('RenamedHost');
    expect(profile!.subtitle).toBe('Director');
    console.log('[E2E] User store updated during active session');

    // Close popover by clicking the user menu button again (toggle)
    await userMenuButton.click();
    await expect(popover).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Popover closed');

    // Re-open popover to verify state persisted
    await userMenuButton.click();
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(host.page.locator(selectors.userPopover.displayName)).toHaveText('RenamedHost');
    await expect(host.page.locator(selectors.userPopover.subtitle)).toHaveText('Director');
    console.log('[E2E] Profile changes persisted after popover close/reopen');

    console.log('[E2E] Profile edit during session test passed!');
  });

  test('popover toggles open and closed via user menu button', async () => {
    console.log('[E2E] Launching host instance...');
    host = await launchApp('host');

    await setupProfile(host.page, 'ToggleUser', 'Toggle Full Name');
    await host.page.waitForSelector(selectors.home.title, { timeout: 10000 });

    const userMenuButton = host.page.locator(selectors.userPopover.userMenuButton);
    const popover = host.page.locator(selectors.userPopover.container);

    // Initially popover should not be visible
    await expect(popover).not.toBeVisible();
    console.log('[E2E] Popover not visible initially');

    // Open
    await userMenuButton.click();
    await expect(popover).toBeVisible({ timeout: 5000 });
    console.log('[E2E] Popover opened');

    // Verify aria-expanded attribute on button
    await expect(userMenuButton).toHaveAttribute('aria-expanded', 'true');
    console.log('[E2E] User menu button aria-expanded is true');

    // Close by clicking button again
    await userMenuButton.click();
    await expect(popover).not.toBeVisible({ timeout: 5000 });
    console.log('[E2E] Popover closed');

    // Verify aria-expanded changed
    await expect(userMenuButton).toHaveAttribute('aria-expanded', 'false');
    console.log('[E2E] User menu button aria-expanded is false');

    console.log('[E2E] Popover toggle test passed!');
  });
});
