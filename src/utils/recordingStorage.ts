/**
 * Recording storage service - uses Electron IPC for file system storage
 * Falls back to IndexedDB storage in browser environments
 */

import { isElectron } from './platform';
import * as browserStorage from './browserStorage';

export async function saveRecordingChunk(
  recordingId: string,
  chunk: Blob,
  index: number
): Promise<void> {
  if (isElectron()) {
    const buffer = await chunk.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    console.log(
      `[RecordingStorage] Saving chunk ${index} for ${recordingId} (${uint8Array.length} bytes)`
    );
    const result = await window.electronAPI.storage.saveChunk(recordingId, uint8Array, index);
    if (!result.success) {
      console.error(`[RecordingStorage] Failed to save chunk:`, result.error);
      throw new Error(result.error || 'Failed to save chunk');
    }
  } else {
    // IndexedDB fallback for browser
    console.log(`[RecordingStorage] Using IndexedDB for chunk ${index}`);
    await browserStorage.saveChunk(recordingId, chunk, index);
  }
}

export async function getRecordingChunks(recordingId: string): Promise<Blob[]> {
  if (isElectron()) {
    const result = await window.electronAPI.storage.getChunks(recordingId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to get chunks');
    }

    // Convert ArrayBuffers back to Blobs
    return (result.chunks || []).map(
      (buffer: ArrayBuffer) => new Blob([buffer], { type: 'video/webm' })
    );
  } else {
    // IndexedDB fallback for browser
    return browserStorage.getChunks(recordingId);
  }
}

export async function finalizeRecording(recordingId: string): Promise<Blob> {
  if (isElectron()) {
    const result = await window.electronAPI.storage.finalizeRecording(recordingId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to finalize recording');
    }

    // Read the finalized file and return as Blob
    const buffer = await window.electronAPI.storage.readFile(result.path!);
    return new Blob([buffer], { type: 'video/webm' });
  } else {
    // IndexedDB fallback for browser
    return browserStorage.finalizeRecording(recordingId);
  }
}

export async function deleteRecording(recordingId: string): Promise<void> {
  if (isElectron()) {
    const result = await window.electronAPI.storage.deleteRecording(recordingId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete recording');
    }
  } else {
    // IndexedDB fallback for browser
    await browserStorage.deleteChunks(recordingId);
  }
}

export async function listRecordings(): Promise<string[]> {
  if (isElectron()) {
    const result = await window.electronAPI.storage.listRecordings();
    if (!result.success) {
      throw new Error(result.error || 'Failed to list recordings');
    }
    return result.recordings || [];
  } else {
    // Not implemented for browser - would need to track recording IDs separately
    console.warn('[RecordingStorage] listRecordings not fully implemented for browser');
    return [];
  }
}
