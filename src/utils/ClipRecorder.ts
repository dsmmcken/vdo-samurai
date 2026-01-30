import { getOptimalMimeType, RECORDING_OPTIONS, CHUNK_INTERVAL } from './recordingConfig';
import { saveRecordingChunk, finalizeRecording } from './recordingStorage';

interface ActiveClip {
  mediaRecorder: MediaRecorder;
  recordingId: string;
  globalStartTime: number;
  sourceType: 'camera' | 'audio-only';
  chunkIndex: number;
  pendingSaves: Promise<void>[];
  onStopCallback: ((blob: Blob) => void) | null;
}

/**
 * ClipRecorder manages multiple concurrent clip recordings.
 * It can record video+audio clips and audio-only clips simultaneously.
 */
export class ClipRecorder {
  private activeClips: Map<string, ActiveClip> = new Map();
  private clockOffset: number = 0;
  private globalClockStart: number = 0;

  /**
   * Set the clock reference for calculating global timestamps
   */
  setClockReference(globalClockStart: number, clockOffset: number): void {
    this.globalClockStart = globalClockStart;
    this.clockOffset = clockOffset;
  }

  /**
   * Get current global time (ms since recording started)
   */
  getGlobalTime(): number {
    if (this.globalClockStart === 0) return 0;
    return Date.now() - this.clockOffset - this.globalClockStart;
  }

  /**
   * Start a video+audio clip
   * @returns clipId and globalStartTime
   */
  async startVideoClip(stream: MediaStream): Promise<{ clipId: string; globalStartTime: number }> {
    return this.startClip(stream, 'camera');
  }

  /**
   * Start an audio-only clip (used when video is toggled off)
   * @returns clipId and globalStartTime
   */
  async startAudioOnlyClip(audioStream: MediaStream): Promise<{ clipId: string; globalStartTime: number }> {
    return this.startClip(audioStream, 'audio-only');
  }

  /**
   * Start a clip recording
   */
  private async startClip(
    stream: MediaStream,
    sourceType: 'camera' | 'audio-only'
  ): Promise<{ clipId: string; globalStartTime: number }> {
    const mimeType = this.getMimeTypeForSourceType(sourceType);
    const recordingId = `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const globalStartTime = this.getGlobalTime();
    const clipId = recordingId;

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      ...RECORDING_OPTIONS
    });

    const clip: ActiveClip = {
      mediaRecorder,
      recordingId,
      globalStartTime,
      sourceType,
      chunkIndex: 0,
      pendingSaves: [],
      onStopCallback: null
    };

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const chunkIdx = clip.chunkIndex++;
        const recId = clip.recordingId;

        const savePromise = saveRecordingChunk(recId, event.data, chunkIdx)
          .then(() => {
            console.log(`[ClipRecorder] Chunk ${chunkIdx} saved for ${sourceType} clip`);
          })
          .catch((err) => {
            console.error(`[ClipRecorder] Failed to save chunk ${chunkIdx}:`, err);
          });

        clip.pendingSaves.push(savePromise);
      }
    };

    mediaRecorder.onstop = async () => {
      if (clip.onStopCallback) {
        try {
          console.log(`[ClipRecorder] Waiting for ${clip.pendingSaves.length} pending saves...`);
          await Promise.all(clip.pendingSaves);
          console.log(`[ClipRecorder] All chunks saved, finalizing ${sourceType} clip...`);

          const blob = await finalizeRecording(clip.recordingId);
          clip.onStopCallback(blob);
        } catch (err) {
          console.error('[ClipRecorder] Failed to finalize clip:', err);
        }
      }
    };

    this.activeClips.set(clipId, clip);
    mediaRecorder.start(CHUNK_INTERVAL);

    console.log(`[ClipRecorder] Started ${sourceType} clip: ${clipId} at global time ${globalStartTime}ms`);

    return { clipId, globalStartTime };
  }

  /**
   * Stop a specific clip
   * @returns globalEndTime and blob
   */
  async stopClip(clipId: string): Promise<{ globalEndTime: number; blob: Blob }> {
    const clip = this.activeClips.get(clipId);
    if (!clip) {
      throw new Error(`Clip not found: ${clipId}`);
    }

    const globalEndTime = this.getGlobalTime();

    return new Promise((resolve, reject) => {
      if (clip.mediaRecorder.state === 'inactive') {
        reject(new Error('Clip is not recording'));
        return;
      }

      clip.onStopCallback = (blob) => {
        this.activeClips.delete(clipId);
        console.log(`[ClipRecorder] Stopped clip: ${clipId} at global time ${globalEndTime}ms`);
        resolve({ globalEndTime, blob });
      };

      clip.mediaRecorder.stop();
    });
  }

  /**
   * Get active video clip ID (if any)
   */
  getActiveVideoClipId(): string | null {
    for (const [clipId, clip] of this.activeClips) {
      if (clip.sourceType === 'camera' && clip.mediaRecorder.state === 'recording') {
        return clipId;
      }
    }
    return null;
  }

  /**
   * Get active audio-only clip ID (if any)
   */
  getActiveAudioClipId(): string | null {
    for (const [clipId, clip] of this.activeClips) {
      if (clip.sourceType === 'audio-only' && clip.mediaRecorder.state === 'recording') {
        return clipId;
      }
    }
    return null;
  }

  /**
   * Check if there's an active recording of any type
   */
  isRecording(): boolean {
    for (const clip of this.activeClips.values()) {
      if (clip.mediaRecorder.state === 'recording') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active clip IDs
   */
  getActiveClipIds(): string[] {
    const ids: string[] = [];
    for (const [clipId, clip] of this.activeClips) {
      if (clip.mediaRecorder.state === 'recording') {
        ids.push(clipId);
      }
    }
    return ids;
  }

  /**
   * Stop all active clips
   */
  async stopAllClips(): Promise<Array<{ clipId: string; globalEndTime: number; blob: Blob }>> {
    const results: Array<{ clipId: string; globalEndTime: number; blob: Blob }> = [];
    const activeIds = this.getActiveClipIds();

    for (const clipId of activeIds) {
      try {
        const result = await this.stopClip(clipId);
        results.push({ clipId, ...result });
      } catch (err) {
        console.error(`[ClipRecorder] Failed to stop clip ${clipId}:`, err);
      }
    }

    return results;
  }

  /**
   * Cleanup all recorders
   */
  cleanup(): void {
    for (const clip of this.activeClips.values()) {
      if (clip.mediaRecorder.state !== 'inactive') {
        clip.mediaRecorder.stop();
      }
    }
    this.activeClips.clear();
    this.clockOffset = 0;
    this.globalClockStart = 0;
  }

  /**
   * Get the appropriate MIME type based on source type
   */
  private getMimeTypeForSourceType(sourceType: 'camera' | 'audio-only'): string {
    if (sourceType === 'audio-only') {
      // Try audio-only formats first
      const audioTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus'
      ];
      for (const type of audioTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          return type;
        }
      }
      // Fall back to video format (will just have audio)
      return getOptimalMimeType();
    }
    return getOptimalMimeType();
  }
}
