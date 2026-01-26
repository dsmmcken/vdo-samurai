import type { ConnectionRecord } from '../types';

const STORAGE_KEY = 'vdo-samurai-connections';
const MAX_HISTORY = 10;

export function saveConnection(record: ConnectionRecord): void {
  const history = getConnectionHistory();
  const filtered = history.filter((r) => r.sessionId !== record.sessionId);
  filtered.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
}

export function getConnectionHistory(): ConnectionRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function removeConnection(sessionId: string): void {
  const history = getConnectionHistory();
  const filtered = history.filter((r) => r.sessionId !== sessionId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function clearConnectionHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
