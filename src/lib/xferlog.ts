// The file-transfer log: what each upload did, with speeds and connection
// stats, so a slow or failed transfer in the real app can be copied out of
// Recording details and looked at. Guests forward their lines to the director
// (room.ts), whose copy then covers both ends of every transfer.

const MAX_LINES = 3000;

export class TransferLog {
  readonly lines: string[] = [];
  /** Lines not yet forwarded to the director. */
  private unsent = 0;

  add(line: string) {
    const t = new Date();
    const stamp = `${t.toTimeString().slice(0, 8)}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    if (!this.lines.length) this.lines.push(`${stamp} ${navigator.userAgent}`), this.unsent++;
    this.lines.push(`${stamp} ${line}`);
    this.unsent++;
    if (this.lines.length > MAX_LINES) {
      const drop = this.lines.length - MAX_LINES + 500;
      this.lines.splice(1, drop, `… ${drop} older lines dropped`);
      this.unsent = Math.min(this.unsent, this.lines.length);
    }
  }

  /** Takes the lines added since the last call (to forward them). */
  takeUnsent() {
    const out = this.unsent ? this.lines.slice(-this.unsent) : [];
    this.unsent = 0;
    return out;
  }
}

export function fmtRate(bytesPerSec: number) {
  return `${(bytesPerSec / 1024 ** 2).toFixed(2)} MB/s`;
}

export const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

/** Background tabs get less CPU (on Windows, a lower process priority), which can slow a transfer. */
export const tabState = () => `tab ${document.visibilityState}`;

/** The connection as the transfer sees it: round trip, bandwidth estimate, route. */
export async function linkStats(pc: RTCPeerConnection) {
  try {
    const stats = await pc.getStats();
    const byId = new Map<string, any>();
    stats.forEach((s) => byId.set(s.id, s));
    for (const s of byId.values()) {
      if (s.type !== 'candidate-pair' || !s.nominated || s.state !== 'succeeded') continue;
      const l = byId.get(s.localCandidateId);
      const r = byId.get(s.remoteCandidateId);
      const parts = [`rtt ${s.currentRoundTripTime != null ? Math.round(s.currentRoundTripTime * 1000) : '?'} ms`];
      // Chrome's estimate for our audio/video sending; the file channel isn't held to it.
      if (s.availableOutgoingBitrate) parts.push(`media bw est. ${(s.availableOutgoingBitrate / 1e6).toFixed(1)} Mbps`);
      parts.push(`route ${l?.candidateType}->${r?.candidateType}/${l?.protocol ?? '?'}`);
      return parts.join(' · ');
    }
    return `no active route (${pc.connectionState})`;
  } catch (e) {
    return `stats unavailable (${e})`;
  }
}
