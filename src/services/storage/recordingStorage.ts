/**
 * Recording storage service - uses Electron IPC for file system storage
 * Falls back to in-memory storage if Electron API is not available
 */

// In-memory fallback for non-Electron environments
const memoryStorage = new Map<string, Map<number, Blob>>();

function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
}

export async function saveRecordingChunk(
  recordingId: string,
  chunk: Blob,
  index: number
): Promise<void> {
  if (isElectron()) {
    const buffer = await chunk.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    console.log(`[RecordingStorage] Saving chunk ${index} for ${recordingId} (${uint8Array.length} bytes)`);
    const result = await window.electronAPI.storage.saveChunk(recordingId, uint8Array, index);
    if (!result.success) {
      console.error(`[RecordingStorage] Failed to save chunk:`, result.error);
      throw new Error(result.error || 'Failed to save chunk');
    }
  } else {
    // In-memory fallback
    console.log(`[RecordingStorage] Using memory fallback for chunk ${index}`);
    if (!memoryStorage.has(recordingId)) {
      memoryStorage.set(recordingId, new Map());
    }
    memoryStorage.get(recordingId)!.set(index, chunk);
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
    // In-memory fallback
    const chunks = memoryStorage.get(recordingId);
    if (!chunks) return [];

    const sortedChunks: Blob[] = [];
    const indices = Array.from(chunks.keys()).sort((a, b) => a - b);
    for (const index of indices) {
      sortedChunks.push(chunks.get(index)!);
    }
    return sortedChunks;
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
    // In-memory fallback
    const chunks = await getRecordingChunks(recordingId);
    if (chunks.length === 0) {
      throw new Error('No recording chunks found');
    }

    const mimeType = chunks[0].type || 'video/webm';
    return new Blob(chunks, { type: mimeType });
  }
}

export async function deleteRecording(recordingId: string): Promise<void> {
  if (isElectron()) {
    const result = await window.electronAPI.storage.deleteRecording(recordingId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete recording');
    }
  } else {
    // In-memory fallback
    memoryStorage.delete(recordingId);
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
    // In-memory fallback
    return Array.from(memoryStorage.keys());
  }
}
