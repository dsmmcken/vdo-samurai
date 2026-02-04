/**
 * Speed Dial file operations for Electron main process
 */
import { dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { getFFmpegPaths } from './ffmpeg-paths';

// Configure fluent-ffmpeg to use the platform-appropriate binaries
const { ffmpeg: ffmpegPath, ffprobe: ffprobePath } = getFFmpegPaths();
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export interface SpeedDialClipInfo {
  path: string;
  name: string;
  duration: number;
}

export interface SpeedDialImportResult {
  success: boolean;
  clip?: SpeedDialClipInfo;
  error?: string;
}

export interface SpeedDialThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  error?: string;
}

export interface SpeedDialVideoInfo {
  success: boolean;
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
}

function getThumbnailDir(): string {
  return join(tmpdir(), 'vdo-samurai', 'speeddial-thumbnails');
}

function getTranscodeDir(): string {
  return join(tmpdir(), 'vdo-samurai', 'speeddial-transcoded');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// Codecs that Chrome can decode
const CHROME_COMPATIBLE_CODECS = ['h264', 'avc1', 'vp8', 'vp9', 'av1'];

/**
 * Get the video codec from a file
 */
async function getVideoCodec(videoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error('[SpeedDial] ffprobe error:', err);
        resolve(null);
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const codec = videoStream?.codec_name?.toLowerCase() || null;
      console.log('[SpeedDial] Detected video codec:', codec);
      resolve(codec);
    });
  });
}

/**
 * Check if a codec needs transcoding for Chrome compatibility
 */
function needsTranscoding(codec: string | null): boolean {
  if (!codec) return true; // Unknown codec, transcode to be safe
  return !CHROME_COMPATIBLE_CODECS.includes(codec);
}

/**
 * Transcode a video to H.264 MP4 for Chrome compatibility
 */
async function transcodeToH264(
  inputPath: string,
  outputPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[SpeedDial] Transcoding to H.264:', inputPath, '→', outputPath);

    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264', // H.264 video codec
        '-preset fast', // Balance between speed and quality
        '-crf 23', // Constant rate factor (quality, lower = better)
        '-c:a aac', // AAC audio codec
        '-b:a 128k', // Audio bitrate
        '-movflags +faststart' // Enable fast start for web playback
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress && progress.percent) {
          onProgress(progress.percent);
        }
      })
      .on('end', () => {
        console.log('[SpeedDial] Transcoding complete:', outputPath);
        resolve();
      })
      .on('error', (err) => {
        console.error('[SpeedDial] Transcoding error:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Show file picker for importing video clips
 * Automatically transcodes to H.264 if the codec isn't Chrome-compatible
 */
export async function importClip(): Promise<SpeedDialImportResult> {
  const window = BrowserWindow.getFocusedWindow();

  const result = await dialog.showOpenDialog(window!, {
    title: 'Import Speed Dial Clip',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'cancelled' };
  }

  const originalPath = result.filePaths[0];

  try {
    // Check file exists
    await fs.access(originalPath);

    // Check video codec
    const codec = await getVideoCodec(originalPath);
    let finalPath = originalPath;

    if (needsTranscoding(codec)) {
      console.log('[SpeedDial] Codec', codec, 'needs transcoding for Chrome compatibility');

      // Create transcoded file path
      const transcodeDir = getTranscodeDir();
      await ensureDir(transcodeDir);

      const originalName = basename(originalPath, extname(originalPath));
      const transcodedPath = join(transcodeDir, `${originalName}_${randomUUID()}.mp4`);

      // Transcode to H.264
      await transcodeToH264(originalPath, transcodedPath);
      finalPath = transcodedPath;
    }

    // Get video info from the final file
    const info = await getVideoInfo(finalPath);
    if (!info.success || info.duration === undefined) {
      return { success: false, error: info.error || 'Could not read video info' };
    }

    const name = basename(originalPath, extname(originalPath));

    return {
      success: true,
      clip: {
        path: finalPath,
        name,
        duration: info.duration
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to import clip'
    };
  }
}

/**
 * Read a video file and return its contents as ArrayBuffer
 */
export async function readClip(filePath: string): Promise<ArrayBuffer> {
  // Validate path to prevent directory traversal
  const resolvedPath = join(dirname(filePath), basename(filePath));
  if (resolvedPath !== filePath && !filePath.includes('/') && !filePath.includes('\\')) {
    throw new Error('Invalid file path');
  }

  const buffer = await fs.readFile(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Generate a thumbnail for a video clip at a specific time
 */
export async function generateThumbnail(
  videoPath: string,
  outputFilename?: string
): Promise<SpeedDialThumbnailResult> {
  try {
    const thumbnailDir = getThumbnailDir();
    await ensureDir(thumbnailDir);

    const filename = outputFilename || `thumb_${randomUUID()}.jpg`;
    const thumbnailPath = join(thumbnailDir, filename);

    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['10%'], // Take screenshot at 10% of video duration
          filename,
          folder: thumbnailDir,
          size: '320x180'
        })
        .on('end', () => {
          resolve({ success: true, thumbnailPath });
        })
        .on('error', (err) => {
          console.error('[SpeedDial] Thumbnail generation error:', err);
          resolve({ success: false, error: err.message });
        });
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to generate thumbnail'
    };
  }
}

/**
 * Get video information (duration, dimensions)
 */
export async function getVideoInfo(videoPath: string): Promise<SpeedDialVideoInfo> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error('[SpeedDial] ffprobe error:', err);
        resolve({ success: false, error: err.message });
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const duration = metadata.format.duration || 0;
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;

      resolve({
        success: true,
        duration,
        width,
        height
      });
    });
  });
}

/**
 * Check if a file exists and is accessible
 */
export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
