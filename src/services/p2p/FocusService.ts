import { type Room } from 'trystero/torrent';

interface FocusChangeData {
  peerId: string | null;
  timestamp: number;
}

type FocusChangeCallback = (peerId: string | null) => void;

export class FocusService {
  private sendFocusChange: ((data: FocusChangeData, peerId?: string) => void) | null = null;
  private onFocusChangeCallback: FocusChangeCallback | null = null;

  initialize(room: Room): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sendFocus, onFocus] = room.makeAction<any>('focus-change');
    this.sendFocusChange = sendFocus;

    onFocus((data: unknown) => {
      if (typeof data === 'object' && data !== null) {
        const focusData = data as FocusChangeData;
        this.onFocusChangeCallback?.(focusData.peerId);
      }
    });
  }

  broadcastFocusChange(peerId: string | null): void {
    if (this.sendFocusChange) {
      const data: FocusChangeData = { peerId, timestamp: Date.now() };
      this.sendFocusChange(data);
    }
  }

  onFocusChange(callback: FocusChangeCallback): void {
    this.onFocusChangeCallback = callback;
  }

  clear(): void {
    this.sendFocusChange = null;
    this.onFocusChangeCallback = null;
  }
}

export const focusService = new FocusService();
