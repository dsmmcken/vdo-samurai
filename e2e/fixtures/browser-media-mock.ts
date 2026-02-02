/**
 * Browser-compatible media mock script
 * Fetches test videos via HTTP and mocks getUserMedia/getDisplayMedia
 *
 * Unlike the Electron mock which uses IPC (window.electronAPI.mock.getVideoFile),
 * this mock fetches videos via HTTP from the test server
 */

/**
 * Generate the media mock script for browser participants
 * Videos are fetched from the test server at /test-videos/*.mp4
 */
export function getBrowserMediaMockScript(testServerBaseUrl: string): string {
  return `
(async function() {
  // Browser participant uses participant-camera and participant-screen videos
  const cameraVideoType = 'participant-camera';
  const screenVideoType = 'participant-screen';
  const testServerUrl = '${testServerBaseUrl}';

  console.log('[BROWSER-MOCK] Initializing browser media mock');
  console.log('[BROWSER-MOCK] Test server URL:', testServerUrl);

  // Cache for loaded videos
  const videoCache = {};

  /**
   * Load a video file via HTTP and create a looping video element
   */
  async function loadVideo(videoType) {
    if (videoCache[videoType]) {
      return videoCache[videoType];
    }

    console.log('[BROWSER-MOCK] Loading video:', videoType);

    try {
      // Fetch video file from test server
      const videoUrl = testServerUrl + '/test-videos/' + videoType + '.mp4';
      console.log('[BROWSER-MOCK] Fetching:', videoUrl);

      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch video: ' + response.status + ' ' + response.statusText);
      }

      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      // Create video element
      const video = document.createElement('video');
      video.src = blobUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.style.display = 'none';
      document.body.appendChild(video);

      // Wait for video to be ready
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('Failed to load video element: ' + videoType));
      });

      // Start playback
      await video.play();

      // Capture stream from video
      const stream = video.captureStream();

      console.log('[BROWSER-MOCK] Video loaded:', videoType, video.videoWidth + 'x' + video.videoHeight);

      const cached = { video, blobUrl, stream };
      videoCache[videoType] = cached;
      return cached;
    } catch (err) {
      console.error('[BROWSER-MOCK] Failed to load video:', videoType, err);
      throw err;
    }
  }

  /**
   * Pre-load videos for faster first use
   */
  async function preloadVideos() {
    try {
      await Promise.all([
        loadVideo(cameraVideoType),
        loadVideo(screenVideoType)
      ]);
      console.log('[BROWSER-MOCK] Videos preloaded successfully');
    } catch (err) {
      console.error('[BROWSER-MOCK] Failed to preload videos:', err);
      // Continue anyway - will fail on first getUserMedia call
    }
  }

  // Store original functions
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);

  /**
   * Mock getUserMedia (camera)
   * In browser, screen share uses getDisplayMedia instead of getUserMedia with chromeMediaSource
   */
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.log('[BROWSER-MOCK] getUserMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    if (constraints.video) {
      try {
        const cached = await loadVideo(cameraVideoType);

        // Clone tracks so each consumer gets independent track state
        cached.stream.getVideoTracks().forEach(track => {
          const clonedTrack = track.clone();
          Object.defineProperty(clonedTrack, 'label', { value: 'Mock Camera', writable: false });
          stream.addTrack(clonedTrack);
        });

        console.log('[BROWSER-MOCK] Created CAMERA stream from video');
      } catch (err) {
        console.error('[BROWSER-MOCK] Failed to create camera stream:', err);
        throw err;
      }
    }

    if (constraints.audio) {
      // No audio - mocks are silent
      console.log('[BROWSER-MOCK] Audio requested but mocks are silent');
    }

    console.log('[BROWSER-MOCK] getUserMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  /**
   * Mock getDisplayMedia (screen share)
   * This is the browser-standard API for screen sharing
   */
  navigator.mediaDevices.getDisplayMedia = async function(constraints) {
    console.log('[BROWSER-MOCK] getDisplayMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    try {
      const cached = await loadVideo(screenVideoType);

      // Clone tracks for independent lifecycle
      cached.stream.getVideoTracks().forEach(track => {
        const clonedTrack = track.clone();
        Object.defineProperty(clonedTrack, 'label', { value: 'Mock Screen', writable: false });
        stream.addTrack(clonedTrack);
      });

      console.log('[BROWSER-MOCK] Created SCREEN stream from video');
    } catch (err) {
      console.error('[BROWSER-MOCK] Failed to create screen stream:', err);
      throw err;
    }

    console.log('[BROWSER-MOCK] getDisplayMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  // Mark as mocked for debugging
  window.__MEDIA_MOCKED__ = true;
  window.__BROWSER_PARTICIPANT__ = true;

  // Preload videos in background
  preloadVideos();

  console.log('[BROWSER-MOCK] Media APIs mocked successfully');
})();
`;
}
