/**
 * Centralized selectors for E2E tests
 * Uses accessible selectors where available
 */

export const selectors = {
  // Home Page
  home: {
    roomCodeInput: '#room-code',
    createRoomButton: 'button:has-text("Create Room")',
    joinRoomButton: 'button:has-text("Join Room"), button:has-text("Rejoin Room")',
    title: 'h1:has-text("VDO Samurai")'
  },

  // Session Page
  session: {
    // Recording controls
    recordButton: 'button[aria-label="Record"]',
    stopButton: 'button[aria-label="Stop"]',
    startingButton: 'button[aria-label="Starting..."]',

    // Media controls
    cameraToggle: 'button[aria-label*="camera"]',
    micToggle: 'button[aria-label*="microphone"]',

    // Participant tiles
    participantList: '[role="list"][aria-label*="Participant"]',
    localTile: '[role="button"][aria-label*="You"]',
    peerTileByName: (name: string) => `[role="button"][aria-label*="${name}"]`,
    userTile: '[data-testid="user-tile"]',
    userTileByName: (name: string) => `[data-testid="user-tile"][data-tile-name="${name}"]`,
    hostTile: '[data-testid="user-tile"][data-tile-host="true"]',
    tileName: '[data-testid="tile-name"]',

    // Screen share
    screenShareButton: 'button[aria-label*="screen"]',

    // Leave session
    leaveButton: 'button[aria-label="Leave session"]',

    // Connection status
    connectionStatus: 'button[aria-label*="Connection status"]',

    // REC indicator (visible in title bar during recording)
    recIndicator: '[data-testid="rec-indicator"]',

    // Share Link
    shareLinkButton: '[data-testid="share-link-button"]',

    // Speed Dial
    speedDialButton: 'button[aria-label="Open Speed Dial"]'
  },

  // Speed Dial Panel
  speedDial: {
    panel: '[role="dialog"][aria-label="Speed Dial"]',
    closeButton: '[role="dialog"][aria-label="Speed Dial"] button[aria-label="Close panel"]',
    importButton: 'button:has-text("Import Clip")',
    emptyMessage: 'text=No clips yet',
    volumeSlider: 'input[type="range"]',
    clipItem: (name: string) => `[data-testid="speed-dial-clip"][data-name="${name}"]`
  },

  // Recording Complete Popover
  recordingComplete: {
    beginTransferButton: 'button:has-text("Begin Transfer & Edit")',
    discardButton: 'button:has-text("Discard Recording")',
    popoverTitle: 'h3:has-text("Recording Complete")'
  },

  // NLE Editor
  nle: {
    editor: 'h2:has-text("Video Editor")',
    exportButton: 'button:has-text("Export")',
    closeButton: 'button[title*="Close"]',

    // Toolbar
    splitButton: 'button:has-text("Split")',
    deleteButton: 'button:has-text("Delete")',
    playButton: 'button[title*="Play"]',
    pauseButton: 'button[title*="Pause"]',
    playPauseButton: '[data-testid="play-pause"]',
    skipBackwardButton: '[data-testid="skip-backward"]',
    skipForwardButton: '[data-testid="skip-forward"]',

    // Export states
    exportingHeader: 'h2:has-text("Exporting Video")',
    exportCompleteTitle: 'h3:has-text("Video Ready!")',
    exportFailedTitle: 'h3:has-text("Export Failed")',
    exportErrorMessage: '.text-red-400',
    exportRetryButton: 'button:has-text("Try Again")',
    backToEditorButton: '[data-testid="back-to-editor-button"]',

    // Export progress UI
    exportProgress: '[data-testid="export-progress"]',
    exportProgressPercent: '[data-testid="export-progress-percent"]',
    exportProgressBar: '[data-testid="export-progress-bar"]',
    exportProgressBarFill: '[data-testid="export-progress-bar-fill"]',
    exportCancelButton: '[data-testid="export-cancel-button"]',
    exportCompleteScreen: '[data-testid="export-complete-screen"]',

    // Transfer indicator
    transfersInProgress: 'text=Transfers in progress',

    // Timeline clips
    timelineClip: '[data-testid="timeline-clip"]',
    clipByPeerName: (name: string) => `[data-testid="timeline-clip"][data-peer-name="${name}"]`,
    clipById: (id: string) => `[data-testid="timeline-clip"][data-clip-id="${id}"]`,
    clipCount: '[data-testid="clip-count"]',

    // Discard
    discardButton: 'button:has-text("Discard")'
  },

  // Countdown Overlay
  countdown: {
    overlay: '[data-testid="countdown-overlay"]',
    text: '[data-testid="countdown-text"]',
    number: (n: number) => `[data-testid="countdown-number-${n}"]`
  },

  // User Popover
  userPopover: {
    container: '[data-testid="user-popover"]',
    displayName: '[data-testid="popover-display-name"]',
    fullName: '[data-testid="popover-full-name"]',
    subtitle: '[data-testid="popover-subtitle"]',
    editButton: '[data-testid="popover-edit-button"]',
    displayNameInput: '[data-testid="popover-display-name-input"]',
    fullNameInput: '[data-testid="popover-full-name-input"]',
    subtitleInput: '[data-testid="popover-subtitle-input"]',
    saveButton: '[data-testid="popover-save-button"]',
    cancelButton: '[data-testid="popover-cancel-button"]',
    userMenuButton: 'button[aria-label="User menu"]'
  },

  // General
  loading: {
    spinner: '.animate-spin',
    connectingText: 'text=Connecting to session',
    reconnectingText: 'text=Reconnecting to session'
  }
};

/**
 * Wait for navigation to session page
 */
export function sessionUrlPattern(sessionId: string): RegExp {
  return new RegExp(`/session/${sessionId}`);
}
