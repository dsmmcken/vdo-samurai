import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_MAIN = path.join(__dirname, '../../out/main/index.js');

/**
 * Script injected into renderer to mock getUserMedia/getDisplayMedia
 * with canvas-generated streams that show user names and distinct colors
 */
const MEDIA_MOCK_SCRIPT = `
(function() {
  // Generate a color from a string (simple hash)
  function stringToColor(str) {
    // Predefined distinct colors for better visibility
    const colors = [
      '#4a90e2', // Blue (Host)
      '#e94e77', // Pink/Red (Participant 1)
      '#50c878', // Emerald Green
      '#9b59b6', // Purple
      '#f39c12', // Orange
      '#1abc9c', // Teal
    ];

    // Simple hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  // Get current user info from the app's store
  function getUserInfo() {
    try {
      const userStore = window.useUserStore;
      const sessionStore = window.useSessionStore;

      const profile = userStore?.getState?.()?.profile;
      const isHost = sessionStore?.getState?.()?.isHost;

      const displayName = profile?.displayName || 'Unknown User';
      const color = isHost ? '#4a90e2' : stringToColor(displayName);

      return { displayName, color, isHost };
    } catch (e) {
      return { displayName: 'Camera', color: '#4a90e2', isHost: false };
    }
  }

  // Create canvas with animated test pattern showing user name
  function createCanvasStream(label, color, width, height, fps) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    let frame = 0;
    const intervalId = setInterval(() => {
      // Background color
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);

      // Animated diagonal stripes for visual interest
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

      // Semi-transparent overlay for text readability
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(width/2 - 150, height/2 - 60, 300, 120);

      // User name (large, prominent)
      ctx.fillStyle = 'white';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, width / 2, height / 2 - 20);

      // Frame counter and timestamp (smaller)
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Frame: ' + frame + ' | ' + new Date().toISOString().slice(11, 19), width / 2, height / 2 + 25);

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

  // Mock getUserMedia (camera)
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.log('[MOCK] getUserMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    if (constraints.video) {
      // Get user info from the app's store
      const { displayName, color, isHost } = getUserInfo();
      console.log('[MOCK] Creating camera stream for:', displayName, 'isHost:', isHost, 'color:', color);

      // Get requested resolution or use defaults
      const videoConstraints = typeof constraints.video === 'object' ? constraints.video : {};
      const width = videoConstraints.width?.ideal || videoConstraints.width?.max || 1280;
      const height = videoConstraints.height?.ideal || videoConstraints.height?.max || 720;
      const fps = videoConstraints.frameRate?.ideal || videoConstraints.frameRate?.max || 30;

      const videoStream = createCanvasStream(displayName, color, width, height, fps);
      videoStream.getVideoTracks().forEach(track => {
        Object.defineProperty(track, 'label', { value: 'Mock Camera - ' + displayName, writable: false });
        stream.addTrack(track);
      });
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
    const { displayName } = getUserInfo();
    const screenLabel = displayName + "'s Screen";

    // Screen is always video - use a distinct purple/magenta color
    const videoStream = createCanvasStream(screenLabel, '#9b59b6', 1920, 1080, 30);
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

  // Mark as mocked for debugging
  window.__MEDIA_MOCKED__ = true;
  console.log('[MOCK] Media APIs mocked successfully');
})();
`;

export interface AppInstance {
  app: ElectronApplication;
  page: Page;
  instanceId: string;
  userDataDir: string;
}

/**
 * Launch an Electron app instance with mocked media
 */
export async function launchApp(instanceId: string): Promise<AppInstance> {
  // Verify app is built
  if (!fs.existsSync(ELECTRON_MAIN)) {
    throw new Error(`App not built. Run: npm run build\nExpected: ${ELECTRON_MAIN}`);
  }

  // Create unique userData directory for this instance
  const userDataDir = path.join(os.tmpdir(), 'vdo-samurai-e2e', instanceId, Date.now().toString());
  fs.mkdirSync(userDataDir, { recursive: true });

  // Check for headless mode via environment variable
  const headless = process.env.HEADLESS === 'true' || process.env.CI === 'true';

  const app = await electron.launch({
    args: [
      ELECTRON_MAIN,
      `--user-data-dir=${userDataDir}`,
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Pass headless flag to main process to hide window
      ...(headless && { HEADLESS: 'true' }),
    },
  });

  const page = await app.firstWindow();

  // Inject media mocks - this runs on page navigation
  await page.addInitScript(MEDIA_MOCK_SCRIPT);

  // Force a page reload so the init script runs before React initializes
  // This ensures __MEDIA_MOCKED__ is set before main.tsx checks it
  await page.reload();

  // Wait for app to be ready
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    instanceId,
    userDataDir,
  };
}

/**
 * Clean up an app instance
 */
export async function closeApp(instance: AppInstance): Promise<void> {
  try {
    await instance.app.close();
  } catch (e) {
    console.error(`[E2E] Failed to close app ${instance.instanceId}:`, e);
  }

  // Clean up userData directory
  try {
    fs.rmSync(instance.userDataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
