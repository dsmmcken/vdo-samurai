/**
 * URL parameter utilities for browser-based session joining
 */

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
