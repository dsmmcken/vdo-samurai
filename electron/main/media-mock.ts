/**
 * Media mock script for simulating video feeds using pre-generated video files.
 * Used by both E2E tests and manual dual-instance testing.
 *
 * This script is injected into the renderer to mock getUserMedia/getDisplayMedia
 * with streams from pre-generated video files (much lower CPU usage than canvas rendering).
 */

export function getMediaMockScript(instanceId?: string): string {
  // Determine if this is the host instance
  const isHost = instanceId === 'host';

  return `
(async function() {
  const isHost = ${isHost};

  // Video type mapping based on role
  const cameraVideoType = isHost ? 'host-camera' : 'participant-camera';
  const screenVideoType = isHost ? 'host-screen' : 'participant-screen';

  console.log('[MOCK] Initializing video-based media mock (isHost:', isHost, ')');

  // Cache for loaded videos
  const videoCache = {};

  /**
   * Load a video file via IPC and create a looping video element
   */
  async function loadVideo(videoType) {
    if (videoCache[videoType]) {
      return videoCache[videoType];
    }

    console.log('[MOCK] Loading video:', videoType);

    try {
      // Load video file via Electron IPC
      const buffer = await window.electronAPI.mock.getVideoFile(videoType);
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
        video.onerror = () => reject(new Error('Failed to load video: ' + videoType));
      });

      // Start playback
      await video.play();

      // Capture stream from video
      const stream = video.captureStream();

      console.log('[MOCK] Video loaded:', videoType, video.videoWidth + 'x' + video.videoHeight);

      const cached = { video, blobUrl, stream };
      videoCache[videoType] = cached;
      return cached;
    } catch (err) {
      console.error('[MOCK] Failed to load video:', videoType, err);
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
      console.log('[MOCK] Videos preloaded successfully');
    } catch (err) {
      console.error('[MOCK] Failed to preload videos:', err);
      // Continue anyway - will fail on first getUserMedia call
    }
  }

  // Store original functions
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);

  /**
   * Mock getUserMedia (camera or Electron screen share)
   */
  navigator.mediaDevices.getUserMedia = async function(constraints) {
    console.log('[MOCK] getUserMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    if (constraints.video) {
      // Check if this is an Electron screen share request (uses chromeMediaSource: 'desktop')
      const videoConstraints = typeof constraints.video === 'object' ? constraints.video : {};
      const isElectronScreenShare = videoConstraints.mandatory?.chromeMediaSource === 'desktop';

      const videoType = isElectronScreenShare ? screenVideoType : cameraVideoType;

      try {
        const cached = await loadVideo(videoType);

        // Clone tracks so each consumer gets independent track state
        cached.stream.getVideoTracks().forEach(track => {
          const clonedTrack = track.clone();
          const label = isElectronScreenShare ? 'Mock Screen' : 'Mock Camera';
          Object.defineProperty(clonedTrack, 'label', { value: label, writable: false });
          stream.addTrack(clonedTrack);
        });

        console.log('[MOCK] Created', isElectronScreenShare ? 'SCREEN' : 'CAMERA', 'stream from video');
      } catch (err) {
        console.error('[MOCK] Failed to create video stream, falling back to original:', err);
        return originalGetUserMedia(constraints);
      }
    }

    if (constraints.audio) {
      // No audio - user requested silent mocks
      console.log('[MOCK] Audio requested but mocks are silent');
    }

    console.log('[MOCK] getUserMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  /**
   * Mock getDisplayMedia (screen share)
   */
  navigator.mediaDevices.getDisplayMedia = async function(constraints) {
    console.log('[MOCK] getDisplayMedia called:', JSON.stringify(constraints));

    const stream = new MediaStream();

    try {
      const cached = await loadVideo(screenVideoType);

      // Clone tracks for independent lifecycle
      cached.stream.getVideoTracks().forEach(track => {
        const clonedTrack = track.clone();
        Object.defineProperty(clonedTrack, 'label', { value: 'Mock Screen', writable: false });
        stream.addTrack(clonedTrack);
      });

      console.log('[MOCK] Created SCREEN stream from video');
    } catch (err) {
      console.error('[MOCK] Failed to create screen stream, falling back to original:', err);
      return originalGetDisplayMedia(constraints);
    }

    // No audio - user requested silent mocks

    console.log('[MOCK] getDisplayMedia returning stream with', stream.getTracks().length, 'tracks');
    return stream;
  };

  // Mock Electron IPC for screen capture sources
  // This is needed because in Electron, screen share uses a source picker
  if (window.electronAPI && window.electronAPI.screenCapture) {
    const originalGetSources = window.electronAPI.screenCapture.getSources;
    window.electronAPI.screenCapture.getSources = async function() {
      console.log('[MOCK] electronAPI.screenCapture.getSources called');

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

  // Preload videos in background
  preloadVideos();

  console.log('[MOCK] Media APIs mocked successfully (video-based)');
})();
`;
}
