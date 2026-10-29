// VDO.Ninja's password check (`&hash=` in its links). The room is reached by
// hashing the password into its name, so a wrong password doesn't fail: it
// quietly lands you alone in a different room. A few characters of the
// password's hash in the invite let the lobby say "wrong password" instead.
//
// Same recipe as VDO.Ninja (main.js, examples/changepass.html) and the SDK's
// stream-ID suffix: SHA-256 of the sanitized password + salt, as hex. Six hex
// characters is VDO.Ninja's maximum (a 1 in 16.7M false match); it stops there
// because a longer check makes the password easier to brute-force from the link.
// The SDK already puts these same six characters on every stream ID it announces.

/** Must match the salt the SDK hashes the room with (see mesh.ts). */
export const SALT = 'vdo.ninja';
const LENGTH = 6;

/** What VDO.Ninja and the SDK do to a password before hashing it. */
const sanitize = (pw: string) => encodeURIComponent(pw.trim());

/** The check for a password, or '' for no password (nothing to check). */
export async function passwordCheck(pw: string): Promise<string> {
  const clean = sanitize(pw);
  if (!clean) return '';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean + SALT)));
  return [...digest.slice(0, LENGTH / 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Like VDO.Ninja, a shorter check from a link is compared on its own length. */
export function checkMatches(mine: string, check: string) {
  return !!mine && mine.startsWith(check.trim().toLowerCase());
}
