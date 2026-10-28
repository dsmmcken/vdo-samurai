// Origin Private File System helpers. Everything for one take lives in takes/<takeId>/.

export async function takeDir(takeId: string, create = true) {
  const root = await navigator.storage.getDirectory();
  const takes = await root.getDirectoryHandle('takes', { create: true });
  return takes.getDirectoryHandle(takeId, { create });
}

export async function listTakes(): Promise<string[]> {
  const root = await navigator.storage.getDirectory();
  const takes = await root.getDirectoryHandle('takes', { create: true });
  const ids: string[] = [];
  for await (const [name, handle] of (takes as any).entries() as AsyncIterable<[string, FileSystemHandle]>) if (handle.kind === 'directory') ids.push(name);
  return ids;
}

export async function removeTake(takeId: string) {
  const root = await navigator.storage.getDirectory();
  const takes = await root.getDirectoryHandle('takes', { create: true });
  await takes.removeEntry(takeId, { recursive: true }).catch(() => {});
}

export async function removeFile(takeId: string, name: string) {
  await (await takeDir(takeId)).removeEntry(name).catch(() => {});
}

export async function fileSize(takeId: string, name: string) {
  try {
    const h = await (await takeDir(takeId, false)).getFileHandle(name);
    return (await h.getFile()).size;
  } catch {
    return 0;
  }
}

export async function readJson<T>(takeId: string, name: string): Promise<T | null> {
  try {
    const h = await (await takeDir(takeId, false)).getFileHandle(name);
    return JSON.parse(await (await h.getFile()).text()) as T;
  } catch {
    return null;
  }
}

/** Writes are serialized per file so overlapping saves can't interleave. */
const writeQueues = new Map<string, Promise<void>>();
export function writeText(takeId: string, name: string, body: string) {
  const key = `${takeId}/${name}`;
  const next = (writeQueues.get(key) ?? Promise.resolve()).then(async () => {
    const h = await (await takeDir(takeId)).getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(body);
    await w.close();
  });
  writeQueues.set(key, next.catch(() => {}));
  return next;
}

export function writeJson(takeId: string, name: string, value: unknown) {
  return writeText(takeId, name, JSON.stringify(value));
}

/** Appends chunks in order; `close()` resolves once everything is on disk. */
export class SequentialWriter {
  private chain: Promise<unknown>;
  private writable: Promise<FileSystemWritableFileStream>;
  written = 0;
  failed: unknown = null;

  constructor(takeId: string, name: string, offset = 0) {
    this.written = offset;
    this.writable = (async () => {
      const h = await (await takeDir(takeId)).getFileHandle(name, { create: true });
      const w = await h.createWritable({ keepExistingData: offset > 0 });
      if (offset > 0) {
        await w.truncate(offset);
        await w.seek(offset);
      }
      return w;
    })();
    this.chain = this.writable;
  }

  write(data: Blob | ArrayBuffer) {
    const n = data instanceof Blob ? data.size : data.byteLength;
    this.chain = this.chain.then(async () => {
      if (this.failed) return;
      try {
        await (await this.writable).write(data);
        this.written += n;
      } catch (e) {
        this.failed = e;
      }
    });
    return this.chain;
  }

  async close() {
    await this.chain;
    await (await this.writable).close();
    if (this.failed) throw this.failed;
  }
}
