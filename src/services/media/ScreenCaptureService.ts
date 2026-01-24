export class ScreenCaptureService {
  private screenStream: MediaStream | null = null;
  private onEndCallback: (() => void) | null = null;

  private isElectron(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI;
  }

  async startScreenShare(sourceId?: string): Promise<MediaStream> {
    if (this.screenStream) {
      this.stopScreenShare();
    }

    if (this.isElectron()) {
      if (!sourceId) {
        throw new Error('Source ID required for Electron screen share');
      }
      this.screenStream = await this.startElectronScreenShare(sourceId);
    } else {
      this.screenStream = await this.startBrowserScreenShare();
    }

    // Handle user stopping share via browser UI
    const videoTrack = this.screenStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        this.handleStreamEnded();
      });
    }

    return this.screenStream;
  }

  needsSourcePicker(): boolean {
    return this.isElectron();
  }

  private async startBrowserScreenShare(): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: true
    });
  }

  private async startElectronScreenShare(sourceId: string): Promise<MediaStream> {
    // In Electron, we use getUserMedia with Chromium-specific constraints
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          minFrameRate: 15,
          maxFrameRate: 30
        }
      } as MediaTrackConstraints
    });

    return stream;
  }

  private handleStreamEnded(): void {
    this.screenStream = null;
    this.onEndCallback?.();
  }

  stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  isSharing(): boolean {
    return this.screenStream !== null && this.screenStream.active;
  }

  onEnd(callback: () => void): void {
    this.onEndCallback = callback;
  }
}

export const screenCaptureService = new ScreenCaptureService();
