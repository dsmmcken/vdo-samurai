import ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Configure fluent-ffmpeg to use the bundled ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegPath);

// Configuration
const COMPOSITE_CONFIG = {
  OUTPUT_VIDEO_BITRATE: '6M',
  OUTPUT_AUDIO_BITRATE: '128k',
  OUTPUT_FRAMERATE: 30,
  GRID_BACKGROUND: '#1a1a2e',
  OUTPUT_FORMATS: {
    webm: {
      extension: 'webm',
      videoCodec: 'libvpx-vp9',
      audioCodec: 'libopus'
    },
    mp4: {
      extension: 'mp4',
      videoCodec: 'libx264',
      audioCodec: 'aac'
    }
  } as const
};

export interface CompositeOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  layout: 'grid' | 'focus' | 'pip';
}

export interface CompositeResult {
  success: boolean;
  path?: string;
  error?: string;
}

let currentProcess: ReturnType<typeof ffmpeg> | null = null;

function sendProgressToRenderer(progress: number): void {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('ffmpeg:progress-update', progress);
  });
}

export async function getTempDir(): Promise<string> {
  const dir = join(tmpdir(), 'vdo-samurai', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function compositeVideos(options: CompositeOptions): Promise<CompositeResult> {
  const { inputFiles, outputPath, format, layout } = options;
  const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

  return new Promise(async (resolve) => {
    try {
      if (inputFiles.length === 0) {
        resolve({ success: false, error: 'No input files provided' });
        return;
      }

      if (inputFiles.length === 1) {
        // Single file - probe first to check for audio
        const hasAudio = await new Promise<boolean>((res) => {
          ffmpeg.ffprobe(inputFiles[0], (err, metadata) => {
            if (err) {
              console.error('[FFmpeg] Probe error:', err);
              res(false);
              return;
            }
            res(metadata.streams.some((s) => s.codec_type === 'audio'));
          });
        });

        console.log('[FFmpeg] Single file, hasAudio:', hasAudio);

        let stderrLog = '';
        let cmd = ffmpeg(inputFiles[0]).videoCodec(formatConfig.videoCodec);

        if (hasAudio) {
          cmd = cmd.audioCodec(formatConfig.audioCodec).audioBitrate(COMPOSITE_CONFIG.OUTPUT_AUDIO_BITRATE);
        } else {
          // No audio - add silent audio track for compatibility
          cmd = cmd
            .input('anullsrc=r=48000:cl=stereo')
            .inputOptions(['-f', 'lavfi', '-t', '1'])
            .audioCodec(formatConfig.audioCodec)
            .outputOptions(['-shortest']);
        }

        currentProcess = cmd
          .videoBitrate(COMPOSITE_CONFIG.OUTPUT_VIDEO_BITRATE)
          .outputOptions(['-y'])
          .on('start', (cmdStr) => {
            console.log('[FFmpeg] Command:', cmdStr);
          })
          .on('stderr', (line) => {
            stderrLog += line + '\n';
            console.log('[FFmpeg]', line);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              sendProgressToRenderer(progress.percent / 100);
            }
          })
          .on('end', () => {
            currentProcess = null;
            resolve({ success: true, path: outputPath });
          })
          .on('error', (err) => {
            currentProcess = null;
            console.error('[FFmpeg] Error:', err.message);
            console.error('[FFmpeg] Full stderr:', stderrLog);
            resolve({ success: false, error: `${err.message}\n${stderrLog}` });
          })
          .save(outputPath);
      } else {
        // Multiple files - create layout
        // First, probe all files to check for audio streams
        const fileInfos = await Promise.all(
          inputFiles.map(async (file) => {
            try {
              return await new Promise<{ hasAudio: boolean; hasVideo: boolean }>((res, rej) => {
                ffmpeg.ffprobe(file, (err, metadata) => {
                  if (err) {
                    rej(err);
                    return;
                  }
                  const hasAudio = metadata.streams.some((s) => s.codec_type === 'audio');
                  const hasVideo = metadata.streams.some((s) => s.codec_type === 'video');
                  res({ hasAudio, hasVideo });
                });
              });
            } catch (e) {
              console.error(`[FFmpeg] Failed to probe ${file}:`, e);
              return { hasAudio: false, hasVideo: true };
            }
          })
        );

        console.log('[FFmpeg] File info:', fileInfos);

        const filterComplex = buildFilterComplex(inputFiles, layout, fileInfos);

        let command = ffmpeg();

        // Add all input files
        inputFiles.forEach((file) => {
          command = command.input(file);
        });

        // If no audio, add anullsrc as an input for the filter graph
        if (!fileInfos.some((f) => f.hasAudio)) {
          command = command.input('anullsrc=r=48000:cl=stereo').inputOptions(['-f', 'lavfi']);
        }

        let stderrLog = '';
        const outputOpts = ['-y'];
        if (filterComplex.needsShortest) {
          outputOpts.push('-shortest');
        }

        currentProcess = command
          .complexFilter(filterComplex.filter, filterComplex.outputs)
          .videoCodec(formatConfig.videoCodec)
          .audioCodec(formatConfig.audioCodec)
          .videoBitrate(COMPOSITE_CONFIG.OUTPUT_VIDEO_BITRATE)
          .audioBitrate(COMPOSITE_CONFIG.OUTPUT_AUDIO_BITRATE)
          .outputOptions(outputOpts)
          .on('start', (cmd) => {
            console.log('[FFmpeg] Command:', cmd);
          })
          .on('stderr', (line) => {
            stderrLog += line + '\n';
            console.log('[FFmpeg]', line);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              sendProgressToRenderer(progress.percent / 100);
            }
          })
          .on('end', () => {
            currentProcess = null;
            resolve({ success: true, path: outputPath });
          })
          .on('error', (err) => {
            currentProcess = null;
            console.error('[FFmpeg] Error:', err.message);
            console.error('[FFmpeg] Full stderr:', stderrLog);
            resolve({ success: false, error: `${err.message}\n${stderrLog}` });
          })
          .save(outputPath);
      }
    } catch (err) {
      currentProcess = null;
      resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });
}

interface FileInfo {
  hasAudio: boolean;
  hasVideo: boolean;
}

function buildFilterComplex(
  inputFiles: string[],
  layout: 'grid' | 'focus' | 'pip',
  fileInfos: FileInfo[]
): { filter: string; outputs: string[]; needsShortest: boolean } {
  const count = inputFiles.length;

  // Find which inputs have audio
  const audioIndices = fileInfos
    .map((info, i) => (info.hasAudio ? i : -1))
    .filter((i) => i >= 0);

  const hasAnyAudio = audioIndices.length > 0;
  console.log('[FFmpeg] Audio indices:', audioIndices, 'hasAnyAudio:', hasAnyAudio);

  // Build audio filter portion
  // If no audio, anullsrc is added as the last input (index = count)
  const buildAudioFilter = (): { filter: string; needsShortest: boolean } => {
    if (!hasAnyAudio) {
      // No audio - use anullsrc which was added as the last input
      // We'll use -shortest flag to match video duration
      return { filter: `[${count}:a]acopy[aout]`, needsShortest: true };
    }
    if (audioIndices.length === 1) {
      // Single audio source - just use it directly
      return { filter: `[${audioIndices[0]}:a]acopy[aout]`, needsShortest: false };
    }
    // Mix available audio streams
    const audioInputs = audioIndices.map((i) => `[${i}:a]`).join('');
    return { filter: `${audioInputs}amix=inputs=${audioIndices.length}:duration=longest[aout]`, needsShortest: false };
  };

  const audioResult = buildAudioFilter();

  if (layout === 'pip' && count >= 2) {
    // Picture-in-picture: main video with small overlay
    let filter =
      `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[main];` +
      `[1:v]scale=320:180[pip];` +
      `[main][pip]overlay=W-w-20:H-h-20[vout];`;
    filter += audioResult.filter;
    return { filter, outputs: ['vout', 'aout'], needsShortest: audioResult.needsShortest };
  }

  if (layout === 'focus' && count >= 2) {
    // Focus layout: one main video with thumbnails on the side
    let filter =
      `[0:v]scale=1440:1080:force_original_aspect_ratio=decrease,pad=1440:1080:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[main];`;

    // Scale other inputs as thumbnails
    const thumbHeight = Math.floor(1080 / Math.max(count - 1, 1));
    const thumbWidth = 480;

    for (let i = 1; i < count; i++) {
      filter += `[${i}:v]scale=${thumbWidth}:${thumbHeight}:force_original_aspect_ratio=decrease,pad=${thumbWidth}:${thumbHeight}:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[thumb${i}];`;
    }

    // Stack thumbnails vertically
    if (count === 2) {
      filter += `[main][thumb1]hstack=inputs=2[vout];`;
    } else {
      const thumbs = [];
      for (let i = 1; i < count; i++) {
        thumbs.push(`[thumb${i}]`);
      }
      filter += `${thumbs.join('')}vstack=inputs=${count - 1}[thumbstack];`;
      filter += `[main][thumbstack]hstack=inputs=2[vout];`;
    }

    // Mix audio
    filter += audioResult.filter;

    return { filter, outputs: ['vout', 'aout'], needsShortest: audioResult.needsShortest };
  }

  // Default: grid layout
  const gridSize = Math.ceil(Math.sqrt(count));
  const cellWidth = Math.floor(1920 / gridSize);
  const cellHeight = Math.floor(1080 / gridSize);

  let filter = '';

  // Scale each input to cell size
  for (let i = 0; i < count; i++) {
    filter += `[${i}:v]scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:color=${COMPOSITE_CONFIG.GRID_BACKGROUND}[v${i}];`;
  }

  // Build grid
  if (count === 2) {
    filter += `[v0][v1]hstack=inputs=2[vout];`;
  } else if (count <= 4) {
    // 2x2 grid
    filter += `[v0][v1]hstack=inputs=2[top];`;
    filter += `[v${count > 2 ? 2 : 0}][v${count > 3 ? 3 : 0}]hstack=inputs=2[bottom];`;
    filter += `[top][bottom]vstack=inputs=2[vout];`;
  } else {
    // 3x3 grid (for 5-9 inputs)
    for (let row = 0; row < 3; row++) {
      const rowInputs = [];
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        rowInputs.push(`[v${idx < count ? idx : 0}]`);
      }
      filter += `${rowInputs.join('')}hstack=inputs=3[row${row}];`;
    }
    filter += `[row0][row1][row2]vstack=inputs=3[vout];`;
  }

  // Mix audio from sources that have it
  filter += audioResult.filter;

  return { filter, outputs: ['vout', 'aout'], needsShortest: audioResult.needsShortest };
}

export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: number,
  duration: number,
  format: 'mp4' | 'webm'
): Promise<CompositeResult> {
  const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

  return new Promise((resolve) => {
    let stderrLog = '';
    currentProcess = ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(duration)
      .videoCodec(formatConfig.videoCodec)
      .audioCodec(formatConfig.audioCodec)
      .videoBitrate(COMPOSITE_CONFIG.OUTPUT_VIDEO_BITRATE)
      .audioBitrate(COMPOSITE_CONFIG.OUTPUT_AUDIO_BITRATE)
      .outputOptions(['-y'])
      .on('start', (cmd) => {
        console.log('[FFmpeg Trim] Command:', cmd);
      })
      .on('stderr', (line) => {
        stderrLog += line + '\n';
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          sendProgressToRenderer(progress.percent / 100);
        }
      })
      .on('end', () => {
        currentProcess = null;
        resolve({ success: true, path: outputPath });
      })
      .on('error', (err) => {
        currentProcess = null;
        console.error('[FFmpeg Trim] Error:', err.message);
        console.error('[FFmpeg Trim] Stderr:', stderrLog);
        resolve({ success: false, error: `${err.message}\n${stderrLog}` });
      })
      .save(outputPath);
  });
}

export async function concatenateVideos(
  inputFiles: string[],
  outputPath: string,
  format: 'mp4' | 'webm'
): Promise<CompositeResult> {
  const formatConfig = COMPOSITE_CONFIG.OUTPUT_FORMATS[format];

  return new Promise(async (resolve) => {
    try {
      // Create concat file list
      const tempDir = await getTempDir();
      const concatFile = join(tempDir, 'concat.txt');
      const concatContent = inputFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(concatFile, concatContent);

      let stderrLog = '';
      currentProcess = ffmpeg()
        .input(concatFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec(formatConfig.videoCodec)
        .audioCodec(formatConfig.audioCodec)
        .videoBitrate(COMPOSITE_CONFIG.OUTPUT_VIDEO_BITRATE)
        .audioBitrate(COMPOSITE_CONFIG.OUTPUT_AUDIO_BITRATE)
        .outputOptions(['-y'])
        .on('start', (cmd) => {
          console.log('[FFmpeg Concat] Command:', cmd);
        })
        .on('stderr', (line) => {
          stderrLog += line + '\n';
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            sendProgressToRenderer(progress.percent / 100);
          }
        })
        .on('end', async () => {
          currentProcess = null;
          // Cleanup temp concat file
          try {
            await fs.unlink(concatFile);
            await fs.rmdir(tempDir);
          } catch {
            // Ignore cleanup errors
          }
          resolve({ success: true, path: outputPath });
        })
        .on('error', async (err) => {
          currentProcess = null;
          console.error('[FFmpeg Concat] Error:', err.message);
          console.error('[FFmpeg Concat] Stderr:', stderrLog);
          // Cleanup temp concat file
          try {
            await fs.unlink(concatFile);
            await fs.rmdir(tempDir);
          } catch {
            // Ignore cleanup errors
          }
          resolve({ success: false, error: `${err.message}\n${stderrLog}` });
        })
        .save(outputPath);
    } catch (err) {
      resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });
}

export function cancelCurrentProcess(): boolean {
  if (currentProcess) {
    try {
      currentProcess.kill('SIGKILL');
      currentProcess = null;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function getVideoInfo(
  inputPath: string
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const duration = metadata.format.duration || 0;
      const width = videoStream?.width || 1920;
      const height = videoStream?.height || 1080;

      resolve({ duration, width, height });
    });
  });
}
