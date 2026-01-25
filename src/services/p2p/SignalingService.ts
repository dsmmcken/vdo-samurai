import { joinRoom, type Room } from 'trystero/nostr';
import { P2P_CONFIG, RTC_CONFIG } from './config';

export class SignalingService {
  private room: Room | null = null;
  private sessionId: string | null = null;

  async joinSession(sessionId: string): Promise<Room> {
    if (this.room) {
      this.leaveSession();
    }

    this.sessionId = sessionId;
    console.log('[SignalingService] Joining room:', {
      appId: P2P_CONFIG.appId,
      sessionId,
      relayUrls: P2P_CONFIG.relayUrls
    });
    this.room = joinRoom(
      { appId: P2P_CONFIG.appId, relayUrls: P2P_CONFIG.relayUrls, rtcConfig: RTC_CONFIG },
      sessionId
    );

    return this.room;
  }

  leaveSession(): void {
    if (this.room) {
      this.room.leave();
      this.room = null;
      this.sessionId = null;
    }
  }

  getRoom(): Room | null {
    return this.room;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isConnected(): boolean {
    return this.room !== null;
  }
}

export const signalingService = new SignalingService();
