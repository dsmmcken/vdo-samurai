/**
 * SpeedDialPlayer - Converts video files to MediaStreams for P2P streaming
 *
 * Uses HTMLVideoElement.captureStream() to create a MediaStream from video files,
 * allowing speed dial clips to be transmitted via WebRTC like screen shares.
 */

export type PlaybackEndCallback = () => void;

export class SpeedDialPlayer {
  private videoElement: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private mediaStream: MediaStream | null = null;
  private onPlaybackEndCallback: PlaybackEndCallback | null = null;
  private isDestroyed = false;
  private currentClipId: string | null = null;

  /**
   * Load a video clip from a file path using localhost HTTP server
   *
   * Chromium only allows captureStream() on videos from "secure" origins.
   * Custom protocols (media://), file://, and blob: URLs are all considered
   * "tainted" sources. Only localhost (127.0.0.1) is treated as secure.
   *
   * The localhost server only binds to 127.0.0.1, so it's not accessible
   * from other machines on the network.
   */
  async loadClip(filePath: string): Promise<void> {
    this.cleanup();

    if (!window.electronAPI?.speedDial) {
      throw new Error('Speed Dial requires Electron');
    }

    // Get the localhost media server port and token
    const port = await window.electronAPI.speedDial.getMediaServerPort();
    const token = await window.electronAPI.speedDial.getMediaServerToken();
    if (!port || !token) {
      throw new Error('Media server not running');
    }

    // Register the clip to track it (for cleanup)
    const clipId = await window.electronAPI.speedDial.registerClip(filePath);
    this.currentClipId = clipId;
    console.log('[SpeedDialPlayer] Registered clip:', clipId);

    // Create video element and add to DOM (required for captureStream to work properly)
    // IMPORTANT: For WebRTC transmission, the element must be:
    // 1. Within the viewport (not off-screen) - browsers deprioritize rendering off-screen elements
    // 2. Have meaningful dimensions (640x360) - tiny elements cause black frames
    // 3. Actually rendered (not display:none or visibility:hidden)
    //
    // Position at bottom-right corner, behind everything with z-index, and nearly invisible.
    // This ensures the browser allocates proper rendering buffers for WebRTC encoding.
    this.videoElement = document.createElement('video');
    this.videoElement.playsInline = true;
    this.videoElement.crossOrigin = 'anonymous'; // Required for captureStream with localhost
    this.videoElement.muted = false; // We'll control audio via GainNode
    this.videoElement.style.position = 'fixed';
    this.videoElement.style.bottom = '0';
    this.videoElement.style.right = '0';
    this.videoElement.style.width = '640px';
    this.videoElement.style.height = '360px';
    this.videoElement.style.zIndex = '-9999'; // Behind everything
    this.videoElement.style.opacity = '0.01'; // Nearly invisible but still rendered
    this.videoElement.style.pointerEvents = 'none';
    document.body.appendChild(this.videoElement);

    // Handle end of playback
    this.videoElement.addEventListener('ended', this.handlePlaybackEnd);
    this.videoElement.addEventListener('error', this.handleVideoError);

    // Use localhost HTTP server - the only way to get captureStream() working
    // Server only binds to 127.0.0.1, not accessible from network
    // Token prevents other local apps from accessing the server
    const mediaUrl = `http://127.0.0.1:${port}/video?path=${encodeURIComponent(filePath)}&token=${token}`;
    console.log('[SpeedDialPlayer] Loading via localhost (port:', port, ')');
    this.videoElement.src = mediaUrl;

    // Wait for video to be loadable
    await new Promise<void>((resolve, reject) => {
      if (!this.videoElement) {
        reject(new Error('Video element not created'));
        return;
      }

      const onCanPlay = () => {
        this.videoElement?.removeEventListener('canplay', onCanPlay);
        this.videoElement?.removeEventListener('error', onError);
        resolve();
      };

      const onError = (e: Event) => {
        this.videoElement?.removeEventListener('canplay', onCanPlay);
        this.videoElement?.removeEventListener('error', onError);
        console.error('[SpeedDialPlayer] Load error:', e);
        reject(new Error('Failed to load video'));
      };

      this.videoElement.addEventListener('canplay', onCanPlay);
      this.videoElement.addEventListener('error', onError);
      this.videoElement.load();
    });
  }

  /**
   * Start playback and return a MediaStream containing video and audio
   */
  async play(): Promise<MediaStream> {
    if (!this.videoElement) {
      throw new Error('No video loaded');
    }

    // Log video element state before play
    console.log('[SpeedDialPlayer] Video state before play:', {
      readyState: this.videoElement.readyState,
      videoWidth: this.videoElement.videoWidth,
      videoHeight: this.videoElement.videoHeight,
      duration: this.videoElement.duration,
      src: this.videoElement.src.substring(0, 50) + '...',
      crossOrigin: this.videoElement.crossOrigin,
      error: this.videoElement.error
    });

    // Start playback and wait for the 'playing' event which indicates frames are being rendered
    await new Promise<void>((resolve, reject) => {
      const video = this.videoElement!;
      const timeoutId = setTimeout(() => {
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        // Still resolve - video might be playing but event didn't fire
        console.log('[SpeedDialPlayer] Playing event timeout, proceeding anyway');
        resolve();
      }, 2000);

      const onPlaying = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        resolve();
      };

      const onError = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('error', onError);
        reject(new Error('Video playback error'));
      };

      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      video.play().catch(reject);
    });

    // Wait for actual video frame dimensions to be available
    // This ensures the decoder has processed at least one frame
    await new Promise<void>((resolve) => {
      const video = this.videoElement!;
      let attempts = 0;
      const maxAttempts = 60; // 1 second at ~60fps

      const checkFrame = () => {
        attempts++;
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.currentTime > 0) {
          console.log('[SpeedDialPlayer] Frame ready after', attempts, 'attempts');
          resolve();
        } else if (attempts >= maxAttempts) {
          console.log('[SpeedDialPlayer] Frame check timeout, proceeding anyway');
          resolve();
        } else {
          requestAnimationFrame(checkFrame);
        }
      };
      checkFrame();
    });

    // Log video element position and rendering state for debugging WebRTC issues
    const rect = this.videoElement.getBoundingClientRect();
    const inViewport =
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0;
    console.log('[SpeedDialPlayer] Video state after play:', {
      readyState: this.videoElement.readyState,
      videoWidth: this.videoElement.videoWidth,
      videoHeight: this.videoElement.videoHeight,
      currentTime: this.videoElement.currentTime,
      elementPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      inViewport,
      windowSize: { width: window.innerWidth, height: window.innerHeight }
    });

    // Get video stream using captureStream
    // Note: captureStream() requires user gesture for autoplay policy
    const capturedStream = this.videoElement.captureStream();

    // Log captured video track settings for WebRTC debugging
    const videoTrack = capturedStream.getVideoTracks()[0];
    const trackSettings = videoTrack?.getSettings();
    console.log('[SpeedDialPlayer] captureStream tracks:', {
      video: capturedStream.getVideoTracks().length,
      audio: capturedStream.getAudioTracks().length,
      videoTrackSettings: trackSettings
        ? {
            width: trackSettings.width,
            height: trackSettings.height,
            frameRate: trackSettings.frameRate
          }
        : 'no video track'
    });

    // Set up audio processing for volume control
    // Disconnect any existing source node to prevent InvalidStateError
    // when play() is called multiple times without stop() in between
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }

    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();

    // Create destination for the processed audio
    const audioDestination = this.audioContext.createMediaStreamDestination();

    // Connect video element audio to gain node
    // Note: createMediaElementSource() can only be called once per element per AudioContext.
    // We store the node so cleanup() can disconnect it properly.
    this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(audioDestination);

    // Also connect to speakers so the host can hear it
    this.gainNode.connect(this.audioContext.destination);

    // Combine video track from captureStream with audio track from AudioContext
    // Note: videoTrack was already retrieved above for logging
    const audioTrack = audioDestination.stream.getAudioTracks()[0];

    console.log(
      '[SpeedDialPlayer] Video track:',
      videoTrack
        ? {
            enabled: videoTrack.enabled,
            readyState: videoTrack.readyState,
            muted: videoTrack.muted
          }
        : 'MISSING'
    );

    this.mediaStream = new MediaStream();
    if (videoTrack) {
      this.mediaStream.addTrack(videoTrack);
    }
    if (audioTrack) {
      this.mediaStream.addTrack(audioTrack);
    }

    console.log('[SpeedDialPlayer] Final MediaStream tracks:', {
      video: this.mediaStream.getVideoTracks().length,
      audio: this.mediaStream.getAudioTracks().length
    });

    return this.mediaStream;
  }

  /**
   * Stop playback and clean up resources
   */
  stop(): void {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
    }
    this.cleanup();
  }

  /**
   * Set playback volume (0-1)
   */
  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Set callback for when playback naturally ends
   */
  setOnPlaybackEnd(callback: PlaybackEndCallback | null): void {
    this.onPlaybackEndCallback = callback;
  }

  /**
   * Get current playback time in seconds
   */
  getCurrentTime(): number {
    return this.videoElement?.currentTime ?? 0;
  }

  /**
   * Get total duration in seconds
   */
  getDuration(): number {
    return this.videoElement?.duration ?? 0;
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.videoElement ? !this.videoElement.paused && !this.videoElement.ended : false;
  }

  /**
   * Get the current media stream (for adding to peer connections)
   */
  getMediaStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Destroy the player and release all resources
   */
  destroy(): void {
    this.isDestroyed = true;
    this.cleanup();
  }

  private handlePlaybackEnd = (): void => {
    if (!this.isDestroyed && this.onPlaybackEndCallback) {
      this.onPlaybackEndCallback();
    }
  };

  private handleVideoError = (event: Event): void => {
    console.error('[SpeedDialPlayer] Video error:', event);
  };

  private cleanup(): void {
    // Stop all tracks in the media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Disconnect source node before closing audio context
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.gainNode = null;
    }

    // Unregister clip from the main process
    if (this.currentClipId && window.electronAPI?.speedDial) {
      window.electronAPI.speedDial.unregisterClip(this.currentClipId);
      console.log('[SpeedDialPlayer] Unregistered clip:', this.currentClipId);
      this.currentClipId = null;
    }

    // Clean up video element
    if (this.videoElement) {
      this.videoElement.removeEventListener('ended', this.handlePlaybackEnd);
      this.videoElement.removeEventListener('error', this.handleVideoError);
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();
      // Remove from DOM
      if (this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }
  }
}
