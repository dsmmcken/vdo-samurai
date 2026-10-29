// Writes arriving uploads straight into their OPFS files with sync access
// handles (see inplace.ts). Messages are handled strictly in order, so a file's
// writes land in sequence and a close finishes before the next open of it.
import { takeDir } from './opfs';

type Msg =
  | { t: 'open'; id: number; takeId: string; name: string; offset: number }
  | { t: 'write'; id: number; buf: ArrayBuffer }
  | { t: 'close'; id: number };

/** The parts of a sync access handle we use (worker-only, so not in the DOM types). */
interface SyncHandle {
  getSize(): number;
  truncate(size: number): void;
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

/** Flush to disk at least this often, so a crash loses little. */
const FLUSH_BYTES = 16 * 1024 * 1024;
const REPORT_BYTES = 1024 * 1024;
/** Report the rest once writes pause, so "not yet on disk" doesn't linger. */
const REPORT_IDLE_MS = 200;

const files = new Map<number, { h: SyncHandle | null; at: number; error: string | null; unflushed: number; unreported: number }>();
let chain: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  chain = chain.then(() => handle(m));
};

let idle: ReturnType<typeof setTimeout> | null = null;
function report(id: number, f: { at: number; unreported: number }) {
  self.postMessage({ t: 'progress', id, written: f.at });
  f.unreported = 0;
}
function reportSoon() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    for (const [id, f] of files) if (f.unreported) report(id, f);
  }, REPORT_IDLE_MS);
}

async function handle(m: Msg) {
  if (m.t === 'open') {
    const f = { h: null as SyncHandle | null, at: m.offset, error: null as string | null, unflushed: 0, unreported: 0 };
    files.set(m.id, f);
    try {
      const fh = await (await takeDir(m.takeId)).getFileHandle(m.name, { create: true });
      f.h = (await (fh as any).createSyncAccessHandle()) as SyncHandle;
      // Resume exactly where the director's count says: drop anything past it.
      if (f.h.getSize() !== m.offset) f.h.truncate(m.offset);
    } catch (err) {
      f.error = String(err);
    }
    return;
  }
  const f = files.get(m.id);
  if (!f) return;
  if (m.t === 'write') {
    if (f.error || !f.h) return;
    try {
      const n = f.h.write(new Uint8Array(m.buf), { at: f.at });
      f.at += n;
      f.unflushed += n;
      f.unreported += n;
      if (n !== m.buf.byteLength) throw new Error(`short write: ${n} of ${m.buf.byteLength} bytes`);
      if (f.unflushed >= FLUSH_BYTES) f.h.flush(), (f.unflushed = 0);
      if (f.unreported >= REPORT_BYTES) report(m.id, f);
      else reportSoon();
    } catch (err) {
      f.error = String(err);
    }
    return;
  }
  // close
  try {
    f.h?.flush();
    f.h?.close();
  } catch (err) {
    f.error ??= String(err);
  }
  files.delete(m.id);
  self.postMessage({ t: 'closed', id: m.id, written: f.at, error: f.error });
}
