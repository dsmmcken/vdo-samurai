/**
 * Timeline-aware video export using FFmpeg
 *
 * Generates filter_complex for:
 * - Time-based switching between active users
 * - Screen + camera PiP compositing with squircle mask
 * - Cross-fade transitions between segments
 * - Audio switching with crossfade
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { BrowserWindow } from 'electron';

// Configure fluent-ffmpeg to use the bundled ffmpeg binary
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// Configuration
const CONFIG = {
  OUTPUT_WIDTH: 1920,
  OUTPUT_HEIGHT: 1080,
  PIP_SIZE: 160, // Square PiP size (cropped from camera)
  PIP_PADDING: 20,
  PIP_CORNER_RADIUS: 32, // Corner radius for squircle corners (~20% of size)
  PIP_SQUIRCLE_EXPONENT: 4, // Superellipse exponent (4 = squircle, 2 = circular)
  TRANSITION_DURATION_S: 0.3,
  BACKGROUND_COLOR: 'black',
  VIDEO_BITRATE: '6M',
  AUDIO_BITRATE: '128k',
  FRAMERATE: 30,
  OUTPUT_FORMATS: {
    webm: { videoCodec: 'libvpx-vp9', audioCodec: 'libopus' },
    mp4: { videoCodec: 'libx264', audioCodec: 'aac' }
  }
} as const;

// Calculate PiP position (square dimensions from CONFIG.PIP_SIZE)
const PIP_X = CONFIG.OUTPUT_WIDTH - CONFIG.PIP_SIZE - CONFIG.PIP_PADDING;
const PIP_Y = CONFIG.OUTPUT_HEIGHT - CONFIG.PIP_SIZE - CONFIG.PIP_PADDING;

export type ExportLayout = 'screen-pip' | 'camera-only' | 'screen-only';

export interface ExportSourceRef {
  sourceIndex: number;
  trimStartMs: number;
  trimEndMs: number;
}

export interface ExportSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  peerId: string | null;
  peerName: string;
  layout: ExportLayout;
  camera?: ExportSourceRef;
  screen?: ExportSourceRef;
}

export interface TimelineExportOptions {
  inputFiles: string[];
  outputPath: string;
  format: 'mp4' | 'webm';
  segments: ExportSegment[];
  sourceCount: number;
  transitionDurationMs: number;
}

export interface TimelineExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

let currentProcess: ReturnType<typeof ffmpeg> | null = null;

/**
 * Send progress updates to all renderer windows
 */
function sendProgressToRenderer(progress: number): void {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return;
  }
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send('ffmpeg:progress-update', clampedProgress);
  });
}

/**
 * Parse timemark string (HH:MM:SS.ms) to seconds
 */
function parseTimemark(timemark: string): number {
  const parts = timemark.split(':');
  if (parts.length !== 3) return 0;
  const [h, m, s] = parts.map(parseFloat);
  return h * 3600 + m * 60 + s;
}

/**
 * Build the alpha expression for squircle corners using geq
 * Uses superellipse formula in corner regions: (dx/r)^n + (dy/r)^n <= 1
 * Sides remain straight, only corners are curved (like iOS app icons)
 * Returns just the expression string, not the full filter
 */
function buildSquircleAlphaExpr(
  width: number,
  height: number,
  radius: number,
  exponent: number = 4
): string {
  const r = radius;
  const n = exponent;
  // Precompute r^n for the boundary check
  const rn = Math.pow(r, n);

  // The geq filter applies per-pixel logic
  // We check if a pixel is in a corner region and if so, apply superellipse cutoff
  // Corner regions: (0,0), (W-r,0), (0,H-r), (W-r,H-r)
  // Inside corner curve: pow(dx,n) + pow(dy,n) <= pow(r,n)
  // Outside (transparent): pow(dx,n) + pow(dy,n) > pow(r,n)

  return [
    // Top-left corner
    `if(lt(X,${r})*lt(Y,${r})*gt(pow(${r}-X,${n})+pow(${r}-Y,${n}),${rn}),0,`,
    // Top-right corner
    `if(gt(X,${width - r})*lt(Y,${r})*gt(pow(X-${width - r},${n})+pow(${r}-Y,${n}),${rn}),0,`,
    // Bottom-left corner
    `if(lt(X,${r})*gt(Y,${height - r})*gt(pow(${r}-X,${n})+pow(Y-${height - r},${n}),${rn}),0,`,
    // Bottom-right corner
    `if(gt(X,${width - r})*gt(Y,${height - r})*gt(pow(X-${width - r},${n})+pow(Y-${height - r},${n}),${rn}),0,`,
    // Default: fully opaque
    `255))))`
  ].join('');
}

/**
 * Build the filter_complex string for timeline export
 *
 * Note: FFmpeg filter labels can only be consumed once. When multiple segments
 * use the same source, we inline the scaling/processing for each segment rather
 * than trying to share prepared streams.
 */
function buildTimelineFilterComplex(
  segments: ExportSegment[],
  _sourceCount: number,
  transitionDurationS: number
): { filter: string; outputs: string[] } {
  const filters: string[] = [];
  const W = CONFIG.OUTPUT_WIDTH;
  const H = CONFIG.OUTPUT_HEIGHT;

  // Build each segment's composite - inline all processing per segment
  // This avoids the issue of trying to reuse filter labels
  const segmentVideoLabels: string[] = [];
  const segmentAudioFilters: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDurationS = (seg.endTimeMs - seg.startTimeMs) / 1000;
    const segLabel = `seg${i}`;

    // Get trim start times (convert ms to seconds)
    const screenTrimStartS = seg.screen ? seg.screen.trimStartMs / 1000 : 0;
    const camTrimStartS = seg.camera ? seg.camera.trimStartMs / 1000 : 0;

    if (seg.layout === 'screen-pip' && seg.screen && seg.camera) {
      // Screen fullscreen + camera PiP with rounded corners
      const screenIdx = seg.screen.sourceIndex;
      const camIdx = seg.camera.sourceIndex;

      // Scale and trim screen source inline
      // fps filter at END ensures constant frame rate output for xfade
      filters.push(
        `[${screenIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${CONFIG.BACKGROUND_COLOR},` +
          `setsar=1,trim=start=${screenTrimStartS}:duration=${segDurationS},setpts=PTS-STARTPTS,fps=${CONFIG.FRAMERATE}[screen${i}]`
      );

      // Scale camera to square PiP size (center crop), apply squircle mask, and trim - inline
      const pipSize = CONFIG.PIP_SIZE;
      const pipAlphaExpr = buildSquircleAlphaExpr(
        pipSize,
        pipSize,
        CONFIG.PIP_CORNER_RADIUS,
        CONFIG.PIP_SQUIRCLE_EXPONENT
      );
      filters.push(
        `[${camIdx}:v]scale=${pipSize}:${pipSize}:force_original_aspect_ratio=increase,` +
          `crop=${pipSize}:${pipSize},` +
          `setsar=1,format=rgba,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${pipAlphaExpr}',` +
          `trim=start=${camTrimStartS}:duration=${segDurationS},setpts=PTS-STARTPTS,fps=${CONFIG.FRAMERATE}[pip${i}]`
      );

      // Overlay PiP camera on screen - both inputs already have CFR from fps filter
      filters.push(`[screen${i}][pip${i}]overlay=${PIP_X}:${PIP_Y}:format=auto[${segLabel}]`);

      // Audio from camera source (typically has the mic audio)
      segmentAudioFilters.push(
        `[${camIdx}:a]atrim=start=${camTrimStartS}:duration=${segDurationS},asetpts=PTS-STARTPTS[${segLabel}_a]`
      );
    } else if (seg.layout === 'camera-only' && seg.camera) {
      // Camera fullscreen with trim - inline all processing
      // fps filter at END ensures constant frame rate output for xfade
      const camIdx = seg.camera.sourceIndex;
      filters.push(
        `[${camIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${CONFIG.BACKGROUND_COLOR},` +
          `setsar=1,trim=start=${camTrimStartS}:duration=${segDurationS},setpts=PTS-STARTPTS,fps=${CONFIG.FRAMERATE}[${segLabel}]`
      );
      segmentAudioFilters.push(
        `[${camIdx}:a]atrim=start=${camTrimStartS}:duration=${segDurationS},asetpts=PTS-STARTPTS[${segLabel}_a]`
      );
    } else if (seg.layout === 'screen-only' && seg.screen) {
      // Screen fullscreen with trim - inline all processing
      // fps filter at END ensures constant frame rate output for xfade
      const screenIdx = seg.screen.sourceIndex;
      filters.push(
        `[${screenIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${CONFIG.BACKGROUND_COLOR},` +
          `setsar=1,trim=start=${screenTrimStartS}:duration=${segDurationS},setpts=PTS-STARTPTS,fps=${CONFIG.FRAMERATE}[${segLabel}]`
      );
      segmentAudioFilters.push(
        `[${screenIdx}:a]atrim=start=${screenTrimStartS}:duration=${segDurationS},asetpts=PTS-STARTPTS[${segLabel}_a]`
      );
    } else {
      // Fallback: black frame with silent audio (shouldn't happen normally)
      filters.push(
        `color=c=${CONFIG.BACKGROUND_COLOR}:s=${W}x${H}:d=${segDurationS},format=yuv420p[${segLabel}]`
      );
      segmentAudioFilters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${segDurationS}[${segLabel}_a]`
      );
    }

    segmentVideoLabels.push(segLabel);
  }

  // Add all audio filters
  filters.push(...segmentAudioFilters);

  // Handle single segment case
  if (segments.length === 1) {
    filters.push(`[${segmentVideoLabels[0]}]format=yuv420p[vout]`);
    filters.push(`[${segmentVideoLabels[0]}_a]aresample=48000[aout]`);
    return { filter: filters.join(';'), outputs: ['vout', 'aout'] };
  }

  // Chain segments with xfade transitions
  let currentVideoLabel = segmentVideoLabels[0];
  let currentAudioLabel = `${segmentVideoLabels[0]}_a`;

  // Track cumulative duration for xfade offset calculation
  // xfade offset is relative to the START of the combined output, not each segment
  let cumulativeDurationS = (segments[0].endTimeMs - segments[0].startTimeMs) / 1000;

  for (let i = 1; i < segments.length; i++) {
    const nextVideoLabel = segmentVideoLabels[i];
    const nextAudioLabel = `${segmentVideoLabels[i]}_a`;
    const nextSegDurationS = (segments[i].endTimeMs - segments[i].startTimeMs) / 1000;

    if (transitionDurationS > 0) {
      // Video crossfade
      // Offset is when the transition starts (relative to start of combined output)
      const xfadeOffset = Math.max(0, cumulativeDurationS - transitionDurationS);
      const xfadeRawLabel = `xfade${i}_raw`;
      const xfadeLabel = `xfade${i}`;

      // xfade outputs lose frame rate info, so we need to add fps after each xfade
      filters.push(
        `[${currentVideoLabel}][${nextVideoLabel}]xfade=transition=fade:duration=${transitionDurationS}:offset=${xfadeOffset}[${xfadeRawLabel}]`
      );
      // Re-apply fps to ensure constant frame rate for next xfade in chain
      filters.push(`[${xfadeRawLabel}]fps=${CONFIG.FRAMERATE}[${xfadeLabel}]`);
      currentVideoLabel = xfadeLabel;

      // Update cumulative duration: add new segment minus the overlap
      cumulativeDurationS = cumulativeDurationS + nextSegDurationS - transitionDurationS;

      // Audio: use concat instead of acrossfade to avoid timing complexity
      const aconcatLabel = `aconcat${i}`;
      filters.push(`[${currentAudioLabel}][${nextAudioLabel}]concat=n=2:v=0:a=1[${aconcatLabel}]`);
      currentAudioLabel = aconcatLabel;
    } else {
      // Concatenate without transition
      const concatLabel = `concat${i}`;
      filters.push(`[${currentVideoLabel}][${nextVideoLabel}]concat=n=2:v=1:a=0[${concatLabel}]`);
      currentVideoLabel = concatLabel;
      cumulativeDurationS += nextSegDurationS;

      const aconcatLabel = `aconcat${i}`;
      filters.push(`[${currentAudioLabel}][${nextAudioLabel}]concat=n=2:v=0:a=1[${aconcatLabel}]`);
      currentAudioLabel = aconcatLabel;
    }
  }

  // Final output formatting
  filters.push(`[${currentVideoLabel}]format=yuv420p[vout]`);
  filters.push(`[${currentAudioLabel}]aresample=48000[aout]`);

  return {
    filter: filters.join(';'),
    outputs: ['vout', 'aout']
  };
}

/**
 * Probe input files to check for audio streams
 */
async function probeInputFiles(
  inputFiles: string[]
): Promise<Map<number, { hasAudio: boolean; hasVideo: boolean; duration: number }>> {
  const results = new Map<number, { hasAudio: boolean; hasVideo: boolean; duration: number }>();

  await Promise.all(
    inputFiles.map(async (file, index) => {
      try {
        const info = await new Promise<{ hasAudio: boolean; hasVideo: boolean; duration: number }>(
          (resolve, reject) => {
            ffmpeg.ffprobe(file, (err, metadata) => {
              if (err) {
                reject(err);
                return;
              }
              const hasAudio = metadata.streams.some((s) => s.codec_type === 'audio');
              const hasVideo = metadata.streams.some((s) => s.codec_type === 'video');
              const duration = metadata.format.duration || 0;
              resolve({ hasAudio, hasVideo, duration });
            });
          }
        );
        results.set(index, info);
      } catch (e) {
        console.error(`[FFmpeg Timeline] Failed to probe ${file}:`, e);
        results.set(index, { hasAudio: false, hasVideo: true, duration: 0 });
      }
    })
  );

  return results;
}

/**
 * Build filter with silent audio fallback for sources without audio
 */
function buildFilterWithAudioFallback(
  baseFilter: string,
  segments: ExportSegment[],
  fileInfos: Map<number, { hasAudio: boolean; hasVideo: boolean; duration: number }>
): string {
  let filter = baseFilter;

  // Check each segment's audio source
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let audioSourceIdx: number | null = null;
    let trimStartS = 0;

    // Determine which source provides audio for this segment
    // screen-pip uses camera audio (for mic), others use their primary source
    if (seg.layout === 'screen-pip' && seg.camera) {
      audioSourceIdx = seg.camera.sourceIndex;
      trimStartS = seg.camera.trimStartMs / 1000;
    } else if (seg.layout === 'camera-only' && seg.camera) {
      audioSourceIdx = seg.camera.sourceIndex;
      trimStartS = seg.camera.trimStartMs / 1000;
    } else if (seg.layout === 'screen-only' && seg.screen) {
      audioSourceIdx = seg.screen.sourceIndex;
      trimStartS = seg.screen.trimStartMs / 1000;
    }

    // If the source has no audio, we need to add silent audio
    if (audioSourceIdx !== null) {
      const info = fileInfos.get(audioSourceIdx);
      if (info && !info.hasAudio) {
        const segDurationS = (seg.endTimeMs - seg.startTimeMs) / 1000;
        // Replace the audio filter for this segment with anullsrc
        // Match the exact pattern generated by buildTimelineFilterComplex
        const oldFilter = `[${audioSourceIdx}:a]atrim=start=${trimStartS}:duration=${segDurationS},asetpts=PTS-STARTPTS[seg${i}_a]`;
        const newFilter = `anullsrc=r=48000:cl=stereo,atrim=duration=${segDurationS}[seg${i}_a]`;
        filter = filter.replace(oldFilter, newFilter);
      }
    }
  }

  return filter;
}

/**
 * Export video using timeline-aware compositing
 */
export async function compositeTimeline(
  options: TimelineExportOptions
): Promise<TimelineExportResult> {
  const { inputFiles, outputPath, format, segments, sourceCount, transitionDurationMs } = options;

  const formatConfig = CONFIG.OUTPUT_FORMATS[format];
  const transitionDurationS = transitionDurationMs / 1000;

  try {
    // Validate inputs
    if (segments.length === 0) {
      return { success: false, error: 'No segments to export' };
    }

    if (inputFiles.length === 0) {
      return { success: false, error: 'No input files provided' };
    }

    // Probe input files
    sendProgressToRenderer(0.05);
    const fileInfos = await probeInputFiles(inputFiles);

    // Calculate total duration for progress tracking
    const totalDurationS = segments.reduce(
      (sum, seg) => sum + (seg.endTimeMs - seg.startTimeMs) / 1000,
      0
    );

    // Build filter complex
    sendProgressToRenderer(0.1);
    const { filter: baseFilter, outputs } = buildTimelineFilterComplex(
      segments,
      sourceCount,
      transitionDurationS
    );

    // Add audio fallback for sources without audio
    const filter = buildFilterWithAudioFallback(baseFilter, segments, fileInfos);

    console.log('[FFmpeg Timeline] Filter complex:', filter);
    console.log('[FFmpeg Timeline] File info:', Object.fromEntries(fileInfos));

    // Build FFmpeg command
    let command = ffmpeg();

    // Add all video/audio inputs
    for (const file of inputFiles) {
      command = command.input(file);
    }

    return new Promise((resolve) => {
      let stderrLog = '';

      currentProcess = command
        .complexFilter(filter, outputs)
        .videoCodec(formatConfig.videoCodec)
        .audioCodec(formatConfig.audioCodec)
        .outputOptions([
          '-b:v',
          CONFIG.VIDEO_BITRATE,
          '-b:a',
          CONFIG.AUDIO_BITRATE,
          '-r',
          String(CONFIG.FRAMERATE),
          '-y'
        ])
        .on('start', (cmd) => {
          console.log('[FFmpeg Timeline] Command:', cmd);
        })
        .on('stderr', (line) => {
          stderrLog += line + '\n';
        })
        .on('progress', (progress) => {
          // Calculate progress from timemark
          if (progress.timemark) {
            const currentS = parseTimemark(progress.timemark);
            if (totalDurationS > 0) {
              const percent = Math.min(currentS / totalDurationS, 1);
              sendProgressToRenderer(0.1 + percent * 0.85);
            }
          }
        })
        .on('end', () => {
          currentProcess = null;
          sendProgressToRenderer(1);
          resolve({ success: true, path: outputPath });
        })
        .on('error', (err) => {
          currentProcess = null;
          console.error('[FFmpeg Timeline] Error:', err.message);
          console.error('[FFmpeg Timeline] Stderr:', stderrLog);
          resolve({
            success: false,
            error: `${err.message}\n\nFilter:\n${filter}\n\nStderr:\n${stderrLog}`
          });
        })
        .save(outputPath);
    });
  } catch (err) {
    currentProcess = null;
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

/**
 * Cancel any running timeline export
 */
export function cancelTimelineExport(): boolean {
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
