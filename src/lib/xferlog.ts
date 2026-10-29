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

// ------------------------------------------------------------------ stall probe

/**
 * How late timers fire: the longest delay in the last second, so a busy (or
 * background) tab shows up next to a stall. Runs only while a probe does.
 */
const lag = { worst: 0, users: 0, timer: 0 as ReturnType<typeof setInterval> | 0, last: 0 };
function watchLag() {
  if (lag.users++ > 0) return;
  lag.last = performance.now();
  lag.timer = setInterval(() => {
    const t = performance.now();
    lag.worst = Math.max(lag.worst, t - lag.last - 100);
    lag.last = t;
  }, 100);
}
function unwatchLag() {
  if (--lag.users > 0 || !lag.timer) return;
  clearInterval(lag.timer);
  lag.timer = 0;
}
function takeLag() {
  const w = Math.max(0, Math.round(lag.worst));
  lag.worst = 0;
  return w;
}

interface Counters {
  at: number;
  chBytes: number;
  chMsgs: number;
  out: { bytes: number; packets: number; dropped: number };
  in: { bytes: number; packets: number };
  consent: { sent: number; answered: number };
  rtt: number | null;
  lastIn: number | null;
}

async function counters(pc: RTCPeerConnection, ch: RTCDataChannel, dir: 'send' | 'receive'): Promise<Counters> {
  const stats = await pc.getStats();
  const all = new Map<string, any>();
  stats.forEach((s) => all.set(s.id, s));
  let chan: any = null;
  let pair: any = null;
  for (const s of all.values()) {
    if (s.type === 'data-channel' && s.dataChannelIdentifier === ch.id) chan = s;
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = all.get(s.selectedCandidatePairId);
  }
  pair ??= [...all.values()].find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
  return {
    at: performance.now(),
    chBytes: (dir === 'send' ? chan?.bytesSent : chan?.bytesReceived) ?? 0,
    chMsgs: (dir === 'send' ? chan?.messagesSent : chan?.messagesReceived) ?? 0,
    out: { bytes: pair?.bytesSent ?? 0, packets: pair?.packetsSent ?? 0, dropped: pair?.packetsDiscardedOnSend ?? 0 },
    in: { bytes: pair?.bytesReceived ?? 0, packets: pair?.packetsReceived ?? 0 },
    consent: { sent: pair?.consentRequestsSent ?? pair?.requestsSent ?? 0, answered: pair?.responsesReceived ?? 0 },
    rtt: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    lastIn: pair?.lastPacketReceivedTimestamp ?? null,
  };
}

const kb = (n: number) => (n >= 1024 * 1024 ? mb(n) : `${Math.round(n / 1024)} KB`);

/**
 * Samples one transfer's channel and connection every second, keeping the
 * last dozen samples. Nothing is logged unless the transfer goes wrong; then
 * `dump()` gives the run-up, second by second, to show where it got stuck:
 * the channel not handing bytes to the network, the network not carrying
 * them (or dropping them), the other end not taking them, or the page busy.
 */
export class StallProbe {
  private lines: string[] = [];
  private prev: Counters | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private pc: RTCPeerConnection,
    private ch: RTCDataChannel,
    private dir: 'send' | 'receive',
    /** Anything else worth a column (queued bytes on our other channels, unsaved backlog). */
    private extra: () => string,
  ) {
    watchLag();
    this.timer = setInterval(() => void this.sample(), 1000);
  }

  private async sample() {
    if (this.busy) return;
    this.busy = true;
    try {
      const c = await counters(this.pc, this.ch, this.dir);
      const p = this.prev;
      this.prev = c;
      if (!p) return;
      const s = (c.at - p.at) / 1000;
      const quietIn = c.lastIn ? `, last packet in ${Math.round(performance.timeOrigin + performance.now() - c.lastIn)} ms ago` : '';
      const line = [
        `${new Date().toTimeString().slice(0, 8)}`,
        `channel ${this.dir === 'send' ? 'out' : 'in'} +${kb(c.chBytes - p.chBytes)}/${c.chMsgs - p.chMsgs} msgs${this.dir === 'send' ? `, queued ${kb(this.ch.bufferedAmount)}` : ''}`,
        `path out +${kb(c.out.bytes - p.out.bytes)}/${c.out.packets - p.out.packets} pkts${c.out.dropped - p.out.dropped ? ` (${c.out.dropped - p.out.dropped} DROPPED)` : ''}, in +${kb(c.in.bytes - p.in.bytes)}/${c.in.packets - p.in.packets} pkts${quietIn}`,
        `rtt ${c.rtt ?? '?'} ms, checks ${c.consent.sent - p.consent.sent}→${c.consent.answered - p.consent.answered}`,
        this.extra(),
        `${this.pc.connectionState}/${this.pc.iceConnectionState}, sctp ${this.pc.sctp?.state ?? '?'}, ch ${this.ch.readyState}`,
        `timers late ${takeLag()} ms${s > 1.5 ? ` (sample ${s.toFixed(1)} s apart)` : ''}`,
      ].join(' · ');
      this.lines.push(line);
      if (this.lines.length > 12) this.lines.shift();
    } catch {
      /* stats unavailable (closed): nothing to add */
    } finally {
      this.busy = false;
    }
  }

  /** The last dozen seconds, oldest first, indented under the line that explains why. */
  dump() {
    return this.lines.map((l) => `    ${l}`);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    unwatchLag();
  }
}
