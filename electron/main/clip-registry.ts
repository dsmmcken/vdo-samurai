/**
 * Clip Registry - Maps clip IDs to file paths
 *
 * This allows the renderer to request clips by ID without knowing the actual
 * file path, avoiding URL parsing issues with Windows paths and keeping
 * file system access contained in the main process.
 */

import { randomUUID } from 'crypto';

// Map of clipId → filePath
const registry = new Map<string, string>();

/**
 * Register a clip and get back an ID
 */
export function registerClip(filePath: string): string {
  const id = randomUUID();
  registry.set(id, filePath);
  console.log('[ClipRegistry] Registered clip:', id, '→', filePath);
  return id;
}

/**
 * Get the file path for a clip ID
 */
export function getClipPath(id: string): string | undefined {
  return registry.get(id);
}

/**
 * Unregister a clip when done
 */
export function unregisterClip(id: string): void {
  const path = registry.get(id);
  if (path) {
    console.log('[ClipRegistry] Unregistered clip:', id);
    registry.delete(id);
  }
}

/**
 * Clear all registered clips
 */
export function clearRegistry(): void {
  console.log('[ClipRegistry] Clearing all clips:', registry.size);
  registry.clear();
}
