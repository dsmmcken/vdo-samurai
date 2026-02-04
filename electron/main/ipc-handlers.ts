import { ipcMain, desktopCapturer, app } from 'electron';
import { join } from 'path';
import { readFile as fsReadFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  compositeVideos,
  cancelCurrentProcess,
  trimVideo,
  concatenateVideos,
  getVideoInfo,
  type CompositeOptions
} from './ffmpeg';
import {
  compositeTimeline,
  cancelTimelineExport,
  type TimelineExportOptions
} from './ffmpeg-timeline';
import {
  saveChunk,
  getChunks,
  finalizeRecording,
  deleteRecording,
  listRecordings,
  saveTempFile,
  getTempPath,
  readFile,
  showSaveDialog,
  saveFile
} from './storage';
import {
  importClip,
  readClip,
  generateThumbnail,
  getVideoInfo as getSpeedDialVideoInfo,
  checkFileExists
} from './speeddial';
import { getMediaServerPort, getMediaServerToken } from './media-server';
import { registerClip, unregisterClip } from './clip-registry';

export function registerIpcHandlers(): void {
  // Mock video file handler (for E2E tests and dev:dual mode)
  ipcMain.handle('mock:getVideoFile', async (_event, videoType: string) => {
    // Validate videoType to prevent path traversal
    const validTypes = ['host-camera', 'host-screen', 'participant-camera', 'participant-screen'];
    if (!validTypes.includes(videoType)) {
      throw new Error(`Invalid video type: ${videoType}`);
    }

    // In development, load from e2e/test-assets/videos
    // In production, load from app resources
    let videoDir: string;
    if (app.isPackaged) {
      videoDir = join(process.resourcesPath, 'test-videos');
    } else {
      // Development: relative to electron main directory
      videoDir = join(__dirname, '../../e2e/test-assets/videos');
    }

    const filePath = join(videoDir, `${videoType}.mp4`);

    if (!existsSync(filePath)) {
      throw new Error(`Mock video not found: ${filePath}\nRun: npm run generate:test-videos`);
    }

    const buffer = await fsReadFile(filePath);
    return buffer;
  });

  // Screen capture handlers
  ipcMain.handle('screen-capture:getSources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 }
      });
      return {
        success: true,
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail.toDataURL(),
          displayId: source.display_id
        }))
      };
    } catch (err) {
      console.error('[IPC] screen-capture:getSources error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to get screen sources'
      };
    }
  });
  // FFmpeg handlers
  ipcMain.handle('ffmpeg:composite', async (_event, options: CompositeOptions) => {
    return compositeVideos(options);
  });

  ipcMain.handle('ffmpeg:cancel', () => {
    return cancelCurrentProcess();
  });

  ipcMain.handle(
    'ffmpeg:trim',
    async (
      _event,
      inputPath: string,
      outputPath: string,
      startTime: number,
      duration: number,
      format: 'mp4' | 'webm'
    ) => {
      return trimVideo(inputPath, outputPath, startTime, duration, format);
    }
  );

  ipcMain.handle(
    'ffmpeg:concatenate',
    async (_event, inputFiles: string[], outputPath: string, format: 'mp4' | 'webm') => {
      return concatenateVideos(inputFiles, outputPath, format);
    }
  );

  ipcMain.handle('ffmpeg:getVideoInfo', async (_event, inputPath: string) => {
    return getVideoInfo(inputPath);
  });

  // Timeline-aware export handler
  ipcMain.handle('ffmpeg:compositeTimeline', async (_event, options: TimelineExportOptions) => {
    return compositeTimeline(options);
  });

  ipcMain.handle('ffmpeg:cancelTimeline', () => {
    return cancelTimelineExport();
  });

  // Storage handlers
  ipcMain.handle(
    'storage:saveChunk',
    async (_event, recordingId: string, chunk: unknown, index: number) => {
      console.log(`[IPC] storage:saveChunk called for ${recordingId}, chunk ${index}`);
      try {
        const result = await saveChunk(recordingId, chunk as ArrayBuffer, index);
        return result;
      } catch (err) {
        console.error('[IPC] storage:saveChunk error:', err);
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }
  );

  ipcMain.handle('storage:getChunks', async (_event, recordingId: string) => {
    return getChunks(recordingId);
  });

  ipcMain.handle('storage:finalize', async (_event, recordingId: string) => {
    return finalizeRecording(recordingId);
  });

  ipcMain.handle('storage:deleteRecording', async (_event, recordingId: string) => {
    return deleteRecording(recordingId);
  });

  ipcMain.handle('storage:listRecordings', async () => {
    return listRecordings();
  });

  ipcMain.handle('storage:saveTempFile', async (_event, filename: string, buffer: ArrayBuffer) => {
    return saveTempFile(filename, buffer);
  });

  ipcMain.handle('storage:getTempPath', async (_event, filename: string) => {
    return getTempPath(filename);
  });

  ipcMain.handle('storage:readFile', async (_event, filePath: string) => {
    return readFile(filePath);
  });

  ipcMain.handle('storage:showSaveDialog', async (_event, defaultName: string) => {
    return showSaveDialog(defaultName);
  });

  ipcMain.handle('storage:saveFile', async (_event, filePath: string, buffer: ArrayBuffer) => {
    return saveFile(filePath, buffer);
  });

  // App handlers
  ipcMain.handle('app:getVersion', () => {
    return process.env.npm_package_version || '1.0.0';
  });

  // Speed Dial handlers
  ipcMain.handle('speeddial:importClip', async () => {
    return importClip();
  });

  ipcMain.handle('speeddial:readClip', async (_event, filePath: string) => {
    return readClip(filePath);
  });

  ipcMain.handle('speeddial:generateThumbnail', async (_event, videoPath: string) => {
    return generateThumbnail(videoPath);
  });

  ipcMain.handle('speeddial:getVideoInfo', async (_event, videoPath: string) => {
    return getSpeedDialVideoInfo(videoPath);
  });

  ipcMain.handle('speeddial:checkFileExists', async (_event, filePath: string) => {
    return checkFileExists(filePath);
  });

  ipcMain.handle('speeddial:getMediaServerPort', () => {
    return getMediaServerPort();
  });

  ipcMain.handle('speeddial:getMediaServerToken', () => {
    return getMediaServerToken();
  });

  // Clip registry handlers for media:// protocol
  ipcMain.handle('speeddial:registerClip', (_event, filePath: string) => {
    return registerClip(filePath);
  });

  ipcMain.handle('speeddial:unregisterClip', (_event, clipId: string) => {
    unregisterClip(clipId);
  });
}
