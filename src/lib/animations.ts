// A room's animation library, as this browser keeps it: the registers (animation-api.ts)
// in OPFS at animations/<room>/index.json, and each version's script next to it as
// <sha-256>.js. Every script is checked in the sandbox here before it counts as
// ready: received from someone else or added by us.
import { Clock, liveAnimations, mergeIndex, pinnedAnimations, ANIMATION_MAX_BYTES, type AnimationEntry, type AnimationIndex, type AnimationMeta } from './animation-api';
// The sandbox's host side loads with the first script to check: a room with
// no animations never fetches it.
const sandbox = () => import('./animation-sandbox').then((m) => m.AnimationSandbox);
/** Checking stored animations waits for a quiet moment, so it doesn't slow joining. */
const idle = () => new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 3000 }) : setTimeout(r, 1000)));
import type { PeerId } from './types';

export async function sha256(bytes: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AnimationInfo {
  name: string;
  hash: string;
  size: number;
  pinned: boolean;
  /** When this version was added, and by whom. */
  ts: number;
  by: PeerId;
  /** We have the script. */
  have: boolean;
  /** It loaded and drew in our sandbox. */
  meta: AnimationMeta | null;
  /** Why it didn't. */
  error: string | null;
}

export class AnimationLibrary {
  /** No prototype: names come from other people. */
  private idx: AnimationIndex = Object.create(null);
  private clock = new Clock();
  /** Versions whose script is on disk here. */
  private stored = new Set<string>();
  private metas = new Map<string, AnimationMeta>();
  private errors = new Map<string, string>();
  private checking: Promise<unknown> = Promise.resolve();
  private queued = new Set<string>();
  private dir: Promise<FileSystemDirectoryHandle>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    room: string,
    private readonly me: PeerId,
    private readonly onChange: () => void,
  ) {
    this.dir = (async () => {
      const root = await navigator.storage.getDirectory();
      const all = await root.getDirectoryHandle('animations', { create: true });
      return all.getDirectoryHandle(encodeURIComponent(room).slice(0, 200) || '_', { create: true });
    })();
  }

  /** Reads the library from disk, drops scripts nothing points at any more, and checks the rest. */
  async load() {
    try {
      const dir = await this.dir;
      try {
        const text = await (await (await dir.getFileHandle('index.json')).getFile()).text();
        mergeIndex(this.idx, JSON.parse(text), this.clock);
      } catch {
        /* a new room */
      }
      const wanted = new Set(Object.values(this.idx).map((e) => e.content.hash));
      for await (const [name] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        const m = name.match(/^([0-9a-f]{64})\.js$/);
        if (!m) continue;
        if (wanted.has(m[1])) this.stored.add(m[1]);
        else await dir.removeEntry(name).catch(() => {});
      }
    } catch (e) {
      console.warn('[animations] could not read the library', e);
    }
    for (const [, e] of liveAnimations(this.idx)) if (this.stored.has(e.content.hash)) this.check(e.content.hash);
    this.onChange();
  }

  /** The registers, to send to someone. */
  index(): AnimationIndex {
    return this.idx;
  }

  entry(name: string): AnimationEntry | undefined {
    return Object.hasOwn(this.idx, name) ? this.idx[name] : undefined;
  }

  list(): AnimationInfo[] {
    return liveAnimations(this.idx).map(([name, e]) => ({
      name,
      hash: e.content.hash,
      size: e.content.size,
      pinned: !!e.pin?.pinned,
      ts: e.content.ts,
      by: e.content.by,
      have: this.stored.has(e.content.hash),
      meta: this.metas.get(e.content.hash) ?? null,
      error: this.errors.get(e.content.hash) ?? null,
    }));
  }

  pinned() {
    return pinnedAnimations(this.idx);
  }

  /** Versions we can play: the script is here and it passed the sandbox. */
  ready(): string[] {
    return [...this.metas.keys()];
  }

  meta(hash: string) {
    return this.metas.get(hash) ?? null;
  }

  has(hash: string) {
    return this.stored.has(hash);
  }

  /** Merges someone's registers. Returns the entries that changed ours, and versions we still need. */
  merge(theirs: unknown): { delta: AnimationIndex; need: string[] } {
    const { content, changed } = mergeIndex(this.idx, theirs, this.clock);
    if (!changed.length) return { delta: {}, need: [] };
    const delta: AnimationIndex = {};
    for (const name of changed) delta[name] = this.idx[name];
    const need = content.map((n) => this.idx[n].content).filter((c) => !c.deleted && !this.stored.has(c.hash)).map((c) => c.hash);
    this.save();
    this.onChange();
    return { delta, need };
  }

  /**
   * Adds a script, or a new version of an animation of the same name. New animations
   * are pinned to the strip. Throws with a message for the script's author.
   */
  async add(code: string): Promise<{ name: string; delta: AnimationIndex }> {
    const bytes = new TextEncoder().encode(code);
    if (bytes.length > ANIMATION_MAX_BYTES) throw new Error(`The script is ${(bytes.length / 1048576).toFixed(1)} MB; animations can be at most ${ANIMATION_MAX_BYTES / 1048576} MB, assets included.`);
    const meta = await (await sandbox()).check(code);
    const hash = await sha256(bytes);
    await this.write(hash, bytes);
    this.metas.set(hash, meta);
    this.errors.delete(hash);
    const name = meta.name;
    const old = this.entry(name);
    const e: AnimationEntry = { content: { hash, size: bytes.length, deleted: false, ts: this.clock.next(), by: this.me }, pin: old?.pin };
    if (!old || old.content.deleted || !old.pin) e.pin = { pinned: true, ts: this.clock.next(), by: this.me };
    this.idx[name] = e;
    this.save();
    this.onChange();
    return { name, delta: { [name]: e } };
  }

  remove(name: string): AnimationIndex {
    const old = this.entry(name);
    if (!old) return {};
    this.idx[name] = { ...old, content: { hash: '', size: 0, deleted: true, ts: this.clock.next(), by: this.me } };
    this.save();
    this.onChange();
    return { [name]: this.idx[name] };
  }

  pin(name: string, pinned: boolean): AnimationIndex {
    const old = this.entry(name);
    if (!old) return {};
    this.idx[name] = { ...old, pin: { pinned, ts: this.clock.next(), by: this.me } };
    this.save();
    this.onChange();
    return { [name]: this.idx[name] };
  }

  /** A version's script, if it's here. */
  async code(hash: string): Promise<string | null> {
    if (!this.stored.has(hash)) return null;
    try {
      const dir = await this.dir;
      return await (await (await dir.getFileHandle(`${hash}.js`)).getFile()).text();
    } catch {
      return null;
    }
  }

  async bytes(hash: string): Promise<Uint8Array<ArrayBuffer> | null> {
    if (!this.stored.has(hash)) return null;
    try {
      const dir = await this.dir;
      return new Uint8Array(await (await (await dir.getFileHandle(`${hash}.js`)).getFile()).arrayBuffer());
    } catch {
      return null;
    }
  }

  /** A script someone sent: kept only if it is the version it claims to be. */
  async store(hash: string, bytes: Uint8Array) {
    if (this.stored.has(hash)) return true;
    if (bytes.length > ANIMATION_MAX_BYTES || (await sha256(bytes)) !== hash) return false;
    await this.write(hash, bytes);
    this.check(hash);
    this.onChange();
    return true;
  }

  private async write(hash: string, bytes: Uint8Array) {
    const dir = await this.dir;
    const w = await (await dir.getFileHandle(`${hash}.js`, { create: true })).createWritable();
    await w.write(bytes as BufferSource);
    await w.close();
    this.stored.add(hash);
  }

  /** Checks a stored version in the sandbox, one at a time. */
  private check(hash: string) {
    if (this.queued.has(hash) || this.metas.has(hash)) return;
    this.queued.add(hash);
    this.checking = this.checking.then(async () => {
      try {
        await idle();
        const code = await this.code(hash);
        if (code === null) throw new Error('script missing');
        this.metas.set(hash, await (await sandbox()).check(code));
        this.errors.delete(hash);
      } catch (e) {
        this.errors.set(hash, (e as Error)?.message ?? String(e));
      } finally {
        this.queued.delete(hash);
        this.onChange();
      }
    });
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        const dir = await this.dir;
        const w = await (await dir.getFileHandle('index.json', { create: true })).createWritable();
        await w.write(JSON.stringify(this.idx));
        await w.close();
      } catch (e) {
        console.warn('[animations] could not save the library', e);
      }
    }, 300);
  }
}
