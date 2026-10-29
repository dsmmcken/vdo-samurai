// A stable per-room identity, so a reload rejoins as the same person (and the
// director keeps the chair and any half-received files). A Web Lock stops two
// tabs of the same browser from sharing one identity.
import type { PeerId, Profile } from './types';
import { rid } from './util';

const held = new Map<string, () => void>();

/** Takes a Web Lock and keeps it until released (or the tab goes away). */
function hold(name: string): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      resolve(!!lock);
      return lock ? new Promise<void>((release) => held.set(name, release)) : undefined;
    });
  });
}

export function releaseIdentity(id: string) {
  held.get(`samurai:${id}`)?.();
  held.delete(`samurai:${id}`);
}

export async function claimIdentity(room: string): Promise<PeerId> {
  const key = `samurai:id:${room}`;
  const saved = localStorage.getItem(key);
  if (saved && (await hold(`samurai:${saved}`))) return saved;
  const id = rid(8);
  await hold(`samurai:${id}`);
  if (!saved) localStorage.setItem(key, id);
  return id;
}

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem('samurai:profile') || '{}');
    return { name: String(p.name ?? ''), subtitle: String(p.subtitle ?? '') };
  } catch {
    return { name: '', subtitle: '' };
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem('samurai:profile', JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/**
 * `#room=<name>`, plus `&hash=` (a check of the password, never the password
 * itself) on invites to a room with one, plus `&pw=` only on the link Create
 * room hands to its own lobby (stripped on arrival).
 */
export function parseRoomHash(hash = location.hash): { room: string; check: string | null; pw: string | null } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const room = q.get('room');
  // `pw=` (empty) is a deliberate "no password"; no `pw` at all means unknown.
  return room ? { room, check: q.get('hash') || null, pw: q.has('pw') ? q.get('pw')! : null } : null;
}

/** The link fragment for a room, with its password check when it has one. */
export function roomFragment(room: string, check?: string | null) {
  return new URLSearchParams(check ? { room, hash: check } : { room }).toString();
}

/** Invites never carry the password (share it separately), only its check. */
export function inviteLink(room: string, check?: string | null) {
  const u = new URL(location.href);
  u.hash = roomFragment(room, check);
  return u.toString();
}

/** The room password is kept for this tab only (so a reload can rejoin), never in the URL. */
export function rememberPassword(room: string, pw: string) {
  try {
    sessionStorage.setItem(`samurai:pw:${room}`, pw);
  } catch {
    /* storage unavailable */
  }
}
export function recallPassword(room: string) {
  try {
    return sessionStorage.getItem(`samurai:pw:${room}`);
  } catch {
    return null;
  }
}

export function browserGaps() {
  const gaps: string[] = [];
  if (typeof MediaRecorder === 'undefined') gaps.push('recording');
  if (!navigator.storage?.getDirectory) gaps.push('local storage of recordings');
  if (typeof VideoEncoder === 'undefined') gaps.push('rendering the final cut');
  return gaps;
}

const joinedKey = (room: string) => `samurai:joined:${room}`;
/** Remembers (per tab) that we're in a room, so a reload rejoins instead of stopping at the lobby. */
export function rememberJoined(room: string) {
  try {
    sessionStorage.setItem(joinedKey(room), '1');
  } catch {
    /* storage unavailable */
  }
}
export function forgetJoined(room: string) {
  try {
    sessionStorage.removeItem(joinedKey(room));
  } catch {
    /* storage unavailable */
  }
}
export function wasJoined(room: string) {
  try {
    return sessionStorage.getItem(joinedKey(room)) === '1';
  } catch {
    return false;
  }
}
