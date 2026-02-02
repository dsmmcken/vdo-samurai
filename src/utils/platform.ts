/**
 * Platform detection utilities for browser vs Electron environments
 */

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
}

export function isBrowser(): boolean {
  return !isElectron();
}

export type Platform = 'electron' | 'browser';

export function getPlatform(): Platform {
  return isElectron() ? 'electron' : 'browser';
}
