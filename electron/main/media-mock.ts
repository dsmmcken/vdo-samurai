/**
 * Media mock script for simulating video feeds
 * Used by both E2E tests and manual dual-instance testing
 *
 * This script is injected into the renderer to mock getUserMedia/getDisplayMedia
 * with canvas-generated streams that show user names and distinct colors
 */

export function getMediaMockScript(): string {
  // Profile seeding is now done via URL query parameter in main.tsx (before React mounts)
  // This script only handles media mocking (getUserMedia, getDisplayMedia)

  return `
(function() {
  // Get current user info from the app's store
  function getUserInfo() {
    try {
      const userStore = window.useUserStore;
      const sessionStore = window.useSessionStore;

      const profile = userStore?.getState?.()?.profile;
      const isHost = sessionStore?.getState?.()?.isHost ?? false;

      const displayName = profile?.displayName || 'Unknown User';

      return { displayName, isHost };
    } catch (e) {
      return { displayName: 'Unknown', isHost: false };
    }
  }

  // Create canvas with animated test pattern showing user name and stream type
  // streamType: 'camera' | 'screen'
  // Note: isHost is read dynamically on each frame to handle late session establishment
  function createCanvasStream(userName, width, height, fps, streamType) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const isScreen = streamType === 'screen';
    const typeLabel = isScreen ? 'SCREEN SHARE' : 'CAMERA';

    let frame = 0;
    const intervalId = setInterval(() => {
      // Read isHost dynamically on each frame (session may be established after stream creation)
      const sessionStore = window.useSessionStore;
      const isHost = sessionStore?.getState?.()?.isHost ?? false;

      // Color scheme: Host=Blue/Purple, Participant=Pink/Magenta
      // Camera and Screen have different shades
      let bgColor;
      if (isHost) {
        bgColor = isScreen ? '#6c5ce7' : '#4a90e2';  // Purple for screen, Blue for camera
      } else {
        bgColor = isScreen ? '#d63031' : '#e94e77';  // Red for screen, Pink for camera
      }

      // Background color
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      if (isScreen) {
        // Grid pattern for screen share (40px squares)
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        for (let x = 0; x <= width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 0; y <= height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
      } else {
        // Animated diagonal stripes for camera
        const stripeWidth = 60;
        const offset = (frame * 3) % (stripeWidth * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.save();
        ctx.beginPath();
        for (let x = -height + offset; x < width + height; x += stripeWidth * 2) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x + height, height);
          ctx.lineTo(x + height + stripeWidth, height);
          ctx.lineTo(x + stripeWidth, 0);
          ctx.closePath();
        }
        ctx.fill();
        ctx.restore();
      }

      // Semi-transparent overlay for text readability
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(width/2 - 180, height/2 - 70, 360, 140);

      // User name (large, prominent, at top)
      ctx.fillStyle = 'white';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(userName, width / 2, height / 2 - 30);

      // Stream type label (medium, below name)
      ctx.fillStyle = isScreen ? '#ffeaa7' : '#74b9ff';  // Yellow for screen, Light blue for camera
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(typeLabel, width / 2, height / 2 + 10);

      // Frame counter and timestamp (smaller)
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Frame: ' + frame + ' | ' + new Date().toISOString().slice(11, 19), width / 2, height / 2 + 45);

      frame++;
    }, 1000 / fps);

    // Store interval ID for cleanup
    canvas._intervalId = intervalId;

    return canvas.captureStream(fps);
  }

  // Create silent audio track (with optional tone for debugging)
  function createAudioTrack(frequency = 0) {
    try {
      const audioContext = new AudioContext();
      const dest = audioContext.createMediaStreamDestination();

      if (frequency > 0) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.1; // Low volume
        oscillator.connect(gain);
        gain.connect(dest);
        oscillator.start();
      } else {
        // Silent audio
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(dest);
        oscillator.start();
      }

      return dest.stream.getAudioTracks()[0];
    } catch (e) {
      console.error('[MOCK] Failed to create audio track:', e);
      return null;
    }
  }

  // Store original functions
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);

  // Mock getUserMedia (camera or Electron screen share)
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.log('[MOCK] getUserMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    if (constraints.video) {
      // Get user info from the app's store
      const { displayName } = getUserInfo();

      // Check if this is an Electron screen share request (uses chromeMediaSource: 'desktop')
      const videoConstraints = typeof constraints.video === 'object' ? constraints.video : {};
      const isElectronScreenShare = videoConstraints.mandatory?.chromeMediaSource === 'desktop';

      if (isElectronScreenShare) {
        // Electron screen share - create screen stream
        console.log('[MOCK] Creating SCREEN stream for:', displayName, '(Electron desktop capture)');

        const width = videoConstraints.mandatory?.maxWidth || 1920;
        const height = videoConstraints.mandatory?.maxHeight || 1080;
        const fps = videoConstraints.mandatory?.maxFrameRate || 30;

        const videoStream = createCanvasStream(displayName, width, height, fps, 'screen');
        videoStream.getVideoTracks().forEach(track => {
          Object.defineProperty(track, 'label', { value: 'Mock Screen - ' + displayName, writable: false });
          stream.addTrack(track);
        });
      } else {
        // Regular camera request
        console.log('[MOCK] Creating CAMERA stream for:', displayName);

        const width = videoConstraints.width?.ideal || videoConstraints.width?.max || 1280;
        const height = videoConstraints.height?.ideal || videoConstraints.height?.max || 720;
        const fps = videoConstraints.frameRate?.ideal || videoConstraints.frameRate?.max || 30;

        const videoStream = createCanvasStream(displayName, width, height, fps, 'camera');
        videoStream.getVideoTracks().forEach(track => {
          Object.defineProperty(track, 'label', { value: 'Mock Camera - ' + displayName, writable: false });
          stream.addTrack(track);
        });
      }
    }

    if (constraints.audio) {
      const audioTrack = createAudioTrack(440); // A4 note for camera
      if (audioTrack) {
        Object.defineProperty(audioTrack, 'label', { value: 'Mock Microphone', writable: false });
        stream.addTrack(audioTrack);
      }
    }

    console.log('[MOCK] getUserMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  // Mock getDisplayMedia (screen share)
  navigator.mediaDevices.getDisplayMedia = async function(constraints) {
    console.log('[MOCK] getDisplayMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();
    const { displayName, isHost } = getUserInfo();

    // Screen share with user name - isHost read dynamically for color
    const videoStream = createCanvasStream(displayName, 1920, 1080, 30, 'screen');
    videoStream.getVideoTracks().forEach(track => {
      Object.defineProperty(track, 'label', { value: 'Mock Screen - ' + displayName, writable: false });
      stream.addTrack(track);
    });

    // Add audio if requested
    if (constraints?.audio) {
      const audioTrack = createAudioTrack(880); // A5 note for screen
      if (audioTrack) {
        Object.defineProperty(audioTrack, 'label', { value: 'Mock System Audio', writable: false });
        stream.addTrack(audioTrack);
      }
    }

    console.log('[MOCK] getDisplayMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  // Mock Electron IPC for screen capture sources
  // This is needed because in Electron, screen share uses a source picker
  if (window.electronAPI && window.electronAPI.screenCapture) {
    const originalGetSources = window.electronAPI.screenCapture.getSources;
    window.electronAPI.screenCapture.getSources = async function() {
      console.log('[MOCK] electronAPI.screenCapture.getSources called');
      const { displayName } = getUserInfo();

      // Return mock screen sources
      return {
        success: true,
        sources: [
          {
            id: 'screen:0:0',
            name: 'Entire Screen',
            thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            displayId: '0'
          },
          {
            id: 'window:1:0',
            name: 'Mock Application Window',
            thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            displayId: '1'
          }
        ]
      };
    };
    console.log('[MOCK] Electron screenCapture.getSources mocked');
  }

  // Mark as mocked for debugging
  window.__MEDIA_MOCKED__ = true;
  console.log('[MOCK] Media APIs mocked successfully');
})();
`;
}
