import { type Room } from 'trystero/torrent';

export interface RecordingMessage {
  type: 'countdown' | 'start' | 'stop';
  timestamp: number;
  countdown?: number;
}

type CountdownCallback = (count: number) => void;
type RecordingCallback = () => void;

export class RecordingCoordinator {
  private sendRecordingMessage: ((data: RecordingMessage) => void) | null = null;
  private countdownCallback: CountdownCallback | null = null;
  private startCallback: RecordingCallback | null = null;
  private stopCallback: RecordingCallback | null = null;

  initialize(room: Room): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendRecording, onRecording] = room.makeAction<any>('recording');
    this.sendRecordingMessage = sendRecording;

    onRecording((data: unknown) => {
      if (typeof data !== 'object' || data === null) return;

      const message = data as RecordingMessage;

      switch (message.type) {
        case 'countdown':
          if (typeof message.countdown === 'number') {
            this.countdownCallback?.(message.countdown);
          }
          break;
        case 'start':
          this.startCallback?.();
          break;
        case 'stop':
          this.stopCallback?.();
          break;
      }
    });
  }

  // Host triggers countdown sequence
  async triggerCountdown(): Promise<void> {
    for (let i = 3; i >= 1; i--) {
      const message: RecordingMessage = { type: 'countdown', countdown: i, timestamp: Date.now() };
      this.sendRecordingMessage?.(message);
      this.countdownCallback?.(i);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Host triggers start
  triggerStart(): void {
    const message: RecordingMessage = { type: 'start', timestamp: Date.now() };
    this.sendRecordingMessage?.(message);
    this.startCallback?.();
  }

  // Host triggers stop
  triggerStop(): void {
    const message: RecordingMessage = { type: 'stop', timestamp: Date.now() };
    this.sendRecordingMessage?.(message);
    this.stopCallback?.();
  }

  onCountdown(callback: CountdownCallback): void {
    this.countdownCallback = callback;
  }

  onStart(callback: RecordingCallback): void {
    this.startCallback = callback;
  }

  onStop(callback: RecordingCallback): void {
    this.stopCallback = callback;
  }

  clear(): void {
    this.sendRecordingMessage = null;
    this.countdownCallback = null;
    this.startCallback = null;
    this.stopCallback = null;
  }
}

export const recordingCoordinator = new RecordingCoordinator();
