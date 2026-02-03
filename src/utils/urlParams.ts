/**
 * URL parameter utilities for browser-based session joining
 */

// GitHub Pages deployment URL
export const GITHUB_PAGES_URL = 'https://dsmmcken.github.io/vdo-samurai';

/**
 * Extract room code from URL query parameters
 * Supports format: ?room=roomId&p=password
 * Returns full room code in format: roomId?p=password
 */
export function getRoomCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  const password = params.get('p');

  if (!room) return null;
  if (!password) return room; // parseRoomCode will handle missing password

  return `${room}?p=${password}`;
}

/**
 * Parse a pasted value that could be either:
 * - A full URL (https://dsmmcken.github.io/vdo-samurai/?room=xxx&p=yyy)
 * - Just the room code (roomId?p=password)
 * Returns the room code in format: roomId?p=password
 */
export function parseRoomInput(input: string): string {
  const trimmed = input.trim();

  // Check if it looks like a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const room = url.searchParams.get('room');
      const password = url.searchParams.get('p');

      if (room) {
        return password ? `${room}?p=${password}` : room;
      }
    } catch {
      // Not a valid URL, return as-is
    }
  }

  // Return as-is (already a room code)
  return trimmed;
}

/**
 * Build a shareable URL for joining a session
 * @param baseUrl - The base URL of the app (e.g., https://dsmmcken.github.io/vdo-samurai)
 * @param roomCode - The full room code including password (roomId?p=password)
 */
export function buildJoinUrl(baseUrl: string, roomCode: string): string {
  const delimiterIndex = roomCode.lastIndexOf('?p=');
  if (delimiterIndex === -1) {
    return `${baseUrl}/?room=${encodeURIComponent(roomCode)}`;
  }

  const roomId = roomCode.substring(0, delimiterIndex);
  const password = roomCode.substring(delimiterIndex + 3);

  return `${baseUrl}/?room=${encodeURIComponent(roomId)}&p=${encodeURIComponent(password)}`;
}

/**
 * Clear room parameters from URL without page reload
 * Useful after joining a session to clean up the URL
 */
export function clearRoomFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('p');
  window.history.replaceState({}, '', url.toString());
}

// Auto-join intent storage key
const AUTO_JOIN_KEY = 'vdo-samurai-auto-join';

/**
 * Store an auto-join intent in sessionStorage
 * This survives the ProfileSetup → HomePage transition
 */
export function setAutoJoinIntent(roomCode: string): void {
  sessionStorage.setItem(AUTO_JOIN_KEY, roomCode);
}

/**
 * Get the stored auto-join intent
 */
export function getAutoJoinIntent(): string | null {
  return sessionStorage.getItem(AUTO_JOIN_KEY);
}

/**
 * Clear the auto-join intent
 */
export function clearAutoJoinIntent(): void {
  sessionStorage.removeItem(AUTO_JOIN_KEY);
}
