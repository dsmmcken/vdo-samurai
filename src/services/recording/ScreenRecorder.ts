import { getOptimalMimeType, RECORDING_OPTIONS, CHUNK_INTERVAL } from './config';
import { saveRecordingChunk, finalizeRecording } from '../storage/recordingStorage';

export class ScreenRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private recordingId: string | null = null;
  private startTime: number = 0;
  private chunkIndex: number = 0;
  private onStopCallback: ((blob: Blob) => void) | null = null;
  private pendingSaves: Promise<void>[] = [];

  async start(stream: MediaStream): Promise<string> {
    if (this.mediaRecorder) {
      throw new Error('Screen recording already in progress');
    }

    const mimeType = getOptimalMimeType();
    this.recordingId = `screen-recording-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.startTime = Date.now();
    this.chunkIndex = 0;
    this.pendingSaves = [];

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      ...RECORDING_OPTIONS
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.recordingId) {
        const chunkIdx = this.chunkIndex++;
        const recId = this.recordingId;

        // Track this save operation
        const savePromise = saveRecordingChunk(recId, event.data, chunkIdx)
          .then(() => {
            console.log(`[ScreenRecorder] Chunk ${chunkIdx} saved successfully`);
          })
          .catch((err) => {
            console.error(`[ScreenRecorder] Failed to save chunk ${chunkIdx}:`, err);
          });

        this.pendingSaves.push(savePromise);
      }
    };

    this.mediaRecorder.onstop = async () => {
      if (this.recordingId && this.onStopCallback) {
        try {
          // Wait for all pending chunk saves to complete
          console.log(`[ScreenRecorder] Waiting for ${this.pendingSaves.length} pending saves...`);
          await Promise.all(this.pendingSaves);
          console.log(`[ScreenRecorder] All chunks saved, finalizing...`);

          const blob = await finalizeRecording(this.recordingId);
          this.onStopCallback(blob);
        } catch (err) {
          console.error('Failed to finalize screen recording:', err);
        }
      }
    };

    // Request data at regular intervals for progressive saving
    this.mediaRecorder.start(CHUNK_INTERVAL);

    return this.recordingId;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error('No active screen recording'));
        return;
      }

      this.onStopCallback = resolve;
      this.mediaRecorder.stop();
    });
  }

  pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resume(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  getRecordingId(): string | null {
    return this.recordingId;
  }

  getStartTime(): number {
    return this.startTime;
  }

  getElapsedTime(): number {
    if (!this.isRecording() && !this.isPaused()) return 0;
    return Date.now() - this.startTime;
  }

  cleanup(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;
    this.recordingId = null;
    this.startTime = 0;
    this.chunkIndex = 0;
    this.onStopCallback = null;
    this.pendingSaves = [];
  }
}

export const screenRecorder = new ScreenRecorder();
