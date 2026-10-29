// Writes an upload into OPFS in place, on a worker (inplace-worker.ts).
//
// Sync access handles write straight into the file: resuming at an offset
// doesn't first copy the whole partial file to a swap file (as createWritable
// does), and what's written stays put if the director's tab reloads mid-file.
// Chunks are transferred to the worker, not copied.

let worker: Worker | null = null;
let nextId = 1;
const live = new Map<number, InPlaceWriter>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./inplace-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => live.get(e.data.id)?.onWorker(e.data);
  worker.onerror = (e) => {
    // A dead worker fails every open file; the next writer starts a new one.
    for (const w of live.values()) w.onWorker({ t: 'closed', written: w.written, error: `writer worker failed: ${e.message}` });
    worker = null;
  };
  return worker;
}

export class InPlaceWriter {
  private readonly id = nextId++;
  /** Bytes confirmed on disk (updated every few MB, exact after close). */
  written: number;
  /** Bytes handed to the worker so far. */
  queued: number;
  failed: string | null = null;
  private closing: Promise<void> | null = null;
  private resolveClose: (() => void) | null = null;

  constructor(takeId: string, name: string, offset: number) {
    this.written = this.queued = offset;
    live.set(this.id, this);
    getWorker().postMessage({ t: 'open', id: this.id, takeId, name, offset });
  }

  /** Bytes received but not yet confirmed on disk. */
  get backlog() {
    return this.queued - this.written;
  }

  /** Takes ownership of `buf` (it's transferred to the worker). */
  write(buf: ArrayBuffer) {
    if (this.closing) return;
    this.queued += buf.byteLength;
    getWorker().postMessage({ t: 'write', id: this.id, buf }, [buf]);
  }

  /** Resolves once everything is on disk; `written` and `failed` are then final. */
  close() {
    return (this.closing ??= new Promise<void>((res) => {
      this.resolveClose = res;
      getWorker().postMessage({ t: 'close', id: this.id });
    }));
  }

  onWorker(m: { t: string; written: number; error?: string | null }) {
    this.written = m.written;
    if (m.t !== 'closed') return;
    this.failed = m.error ?? null;
    live.delete(this.id);
    this.closing ??= Promise.resolve();
    this.resolveClose?.();
  }
}
