import { app, dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Get app data directory for persistent storage
function getRecordingsDir(): string {
  return join(app.getPath('userData'), 'recordings');
}

function getTempDir(): string {
  return join(tmpdir(), 'vdo-samurai');
}

// Ensure directories exist
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// Recording chunk storage
export async function saveChunk(
  recordingId: string,
  chunk: ArrayBuffer | Buffer | Uint8Array,
  index: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const recordingDir = join(getRecordingsDir(), recordingId);
    await ensureDir(recordingDir);

    const chunkPath = join(recordingDir, `chunk_${String(index).padStart(6, '0')}.webm`);

    // Handle different data types that might come through IPC
    let buffer: Buffer;
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk;
    } else if (chunk instanceof Uint8Array) {
      buffer = Buffer.from(chunk);
    } else if (chunk instanceof ArrayBuffer) {
      buffer = Buffer.from(chunk);
    } else {
      // IPC might serialize as object with numeric keys
      buffer = Buffer.from(Object.values(chunk as Record<string, number>));
    }

    await fs.writeFile(chunkPath, buffer);
    console.log(`[Storage] Saved chunk ${index} for ${recordingId} (${buffer.length} bytes)`);

    return { success: true };
  } catch (err) {
    console.error('[Storage] Failed to save chunk:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save chunk'
    };
  }
}

export async function getChunks(
  recordingId: string
): Promise<{ success: boolean; chunks?: ArrayBuffer[]; error?: string }> {
  try {
    const recordingDir = join(getRecordingsDir(), recordingId);

    const files = await fs.readdir(recordingDir);
    const chunkFiles = files
      .filter((f) => f.startsWith('chunk_') && f.endsWith('.webm'))
      .sort();

    const chunks: ArrayBuffer[] = [];
    for (const file of chunkFiles) {
      const buffer = await fs.readFile(join(recordingDir, file));
      chunks.push(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    }

    return { success: true, chunks };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get chunks'
    };
  }
}

export async function finalizeRecording(
  recordingId: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const recordingDir = join(getRecordingsDir(), recordingId);
    console.log(`[Storage] Finalizing recording at: ${recordingDir}`);

    const files = await fs.readdir(recordingDir);
    const chunkFiles = files
      .filter((f) => f.startsWith('chunk_') && f.endsWith('.webm'))
      .sort();

    console.log(`[Storage] Found ${chunkFiles.length} chunks`);

    if (chunkFiles.length === 0) {
      return { success: false, error: 'No chunks found' };
    }

    // Combine chunks into a single file
    const finalPath = join(recordingDir, 'recording.webm');
    const writeStream = await fs.open(finalPath, 'w');

    try {
      for (const file of chunkFiles) {
        const buffer = await fs.readFile(join(recordingDir, file));
        await writeStream.write(buffer);
      }
    } finally {
      await writeStream.close();
    }

    // Clean up individual chunks
    for (const file of chunkFiles) {
      await fs.unlink(join(recordingDir, file));
    }

    return { success: true, path: finalPath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to finalize recording'
    };
  }
}

export async function deleteRecording(
  recordingId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const recordingDir = join(getRecordingsDir(), recordingId);
    await fs.rm(recordingDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete recording'
    };
  }
}

export async function listRecordings(): Promise<{
  success: boolean;
  recordings?: string[];
  error?: string;
}> {
  try {
    const recordingsDir = getRecordingsDir();
    await ensureDir(recordingsDir);

    const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
    const recordings = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    return { success: true, recordings };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list recordings'
    };
  }
}

// Temporary file storage for FFmpeg operations
export async function saveTempFile(
  filename: string,
  buffer: ArrayBuffer
): Promise<string> {
  const tempDir = join(getTempDir(), uuidv4());
  await ensureDir(tempDir);

  const filePath = join(tempDir, filename);
  await fs.writeFile(filePath, Buffer.from(buffer));

  return filePath;
}

export async function getTempPath(filename: string): Promise<string> {
  const tempDir = join(getTempDir(), uuidv4());
  await ensureDir(tempDir);
  return join(tempDir, filename);
}

export async function readFile(filePath: string): Promise<ArrayBuffer> {
  const buffer = await fs.readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export async function showSaveDialog(
  defaultName: string
): Promise<{ canceled: boolean; filePath?: string }> {
  const window = BrowserWindow.getFocusedWindow();
  const extension = defaultName.split('.').pop() || 'webm';

  const filters = [];
  if (extension === 'mp4') {
    filters.push({ name: 'MP4 Video', extensions: ['mp4'] });
  } else {
    filters.push({ name: 'WebM Video', extensions: ['webm'] });
  }
  filters.push({ name: 'All Files', extensions: ['*'] });

  const result = await dialog.showSaveDialog(window!, {
    defaultPath: join(app.getPath('downloads'), defaultName),
    filters
  });

  return {
    canceled: result.canceled,
    filePath: result.filePath
  };
}

export async function saveFile(
  filePath: string,
  buffer: ArrayBuffer
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureDir(dirname(filePath));
    await fs.writeFile(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save file'
    };
  }
}

// Cleanup temp files on startup
export async function cleanupTempFiles(): Promise<void> {
  try {
    const tempDir = getTempDir();
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
