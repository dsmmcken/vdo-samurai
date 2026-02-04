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
    this.videoElement = document.createElement('video');
    this.videoElement.playsInline = true;
    this.videoElement.crossOrigin = 'anonymous'; // Required for captureStream with localhost
    this.videoElement.muted = false; // We'll control audio via GainNode
    this.videoElement.style.position = 'fixed';
    this.videoElement.style.top = '-9999px';
    this.videoElement.style.left = '-9999px';
    this.videoElement.style.width = '1px';
    this.videoElement.style.height = '1px';
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

    // Start playback first - captureStream works better after play starts
    await this.videoElement.play();

    // Wait for actual frame to be rendered
    await new Promise<void>((resolve) => {
      const video = this.videoElement!;
      const checkFrame = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve();
        } else {
          requestAnimationFrame(checkFrame);
        }
      };
      // Also set a timeout fallback
      setTimeout(resolve, 500);
      checkFrame();
    });

    console.log('[SpeedDialPlayer] Video state after play:', {
      readyState: this.videoElement.readyState,
      videoWidth: this.videoElement.videoWidth,
      videoHeight: this.videoElement.videoHeight,
      currentTime: this.videoElement.currentTime
    });

    // Get video stream using captureStream
    // Note: captureStream() requires user gesture for autoplay policy
    const capturedStream = this.videoElement.captureStream();

    console.log('[SpeedDialPlayer] captureStream tracks:', {
      video: capturedStream.getVideoTracks().length,
      audio: capturedStream.getAudioTracks().length
    });

    // Set up audio processing for volume control
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();

    // Create destination for the processed audio
    const audioDestination = this.audioContext.createMediaStreamDestination();

    // Connect video element audio to gain node
    const sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
    sourceNode.connect(this.gainNode);
    this.gainNode.connect(audioDestination);

    // Also connect to speakers so the host can hear it
    this.gainNode.connect(this.audioContext.destination);

    // Combine video track from captureStream with audio track from AudioContext
    const videoTrack = capturedStream.getVideoTracks()[0];
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
