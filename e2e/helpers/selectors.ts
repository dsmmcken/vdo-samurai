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
    title: 'h1:has-text("VDO Samurai")',
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

    // Screen share
    screenShareButton: 'button[aria-label*="screen"]',
  },

  // Recording Complete Popover
  recordingComplete: {
    beginTransferButton: 'button:has-text("Begin Transfer & Edit")',
    discardButton: 'button:has-text("Discard Recording")',
    popoverTitle: 'h3:has-text("Recording Complete")',
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

    // Export states
    exportingHeader: 'h2:has-text("Exporting Video")',
    exportCompleteTitle: 'h3:has-text("Video Ready!")',
    backToEditorButton: 'button:has-text("Back to Editor")',

    // Transfer indicator
    transfersInProgress: 'text=Transfers in progress',
  },

  // General
  loading: {
    spinner: '.animate-spin',
    connectingText: 'text=Connecting to session',
    reconnectingText: 'text=Reconnecting to session',
  },
};

/**
 * Wait for navigation to session page
 */
export function sessionUrlPattern(sessionId: string): RegExp {
  return new RegExp(`/session/${sessionId}`);
}
