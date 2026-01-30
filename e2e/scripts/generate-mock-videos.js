#!/usr/bin/env node
/**
 * Generate mock video files for E2E testing and dev:dual mode.
 *
 * Usage: node e2e/scripts/generate-mock-videos.js [--duration <seconds>]
 *
 * Generates 4 video variants matching the existing canvas-based mocks:
 * - host-camera.mp4 (blue, 1280x720, diagonal stripes)
 * - host-screen.mp4 (purple, 1920x1080, grid pattern)
 * - participant-camera.mp4 (pink, 1280x720, diagonal stripes)
 * - participant-screen.mp4 (red, 1920x1080, grid pattern)
 */

import { createCanvas } from '@napi-rs/canvas';
import { spawn } from 'child_process';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../test-assets/videos');

// Parse command line arguments
const args = process.argv.slice(2);
const durationIndex = args.indexOf('--duration');
const DURATION_SECONDS =
  durationIndex !== -1 ? parseInt(args[durationIndex + 1], 10) : 10 * 60; // Default 10 minutes

// Video configurations matching the existing mock colors
const VIDEO_CONFIGS = [
  {
    name: 'host-camera',
    displayName: 'Host',
    streamType: 'camera',
    width: 1280,
    height: 720,
    bgColor: '#4a90e2', // Blue for host camera
    labelColor: '#74b9ff' // Light blue label
  },
  {
    name: 'host-screen',
    displayName: 'Host',
    streamType: 'screen',
    width: 1920,
    height: 1080,
    bgColor: '#6c5ce7', // Purple for host screen
    labelColor: '#ffeaa7' // Yellow label
  },
  {
    name: 'participant-camera',
    displayName: 'Participant',
    streamType: 'camera',
    width: 1280,
    height: 720,
    bgColor: '#e94e77', // Pink for participant camera
    labelColor: '#74b9ff' // Light blue label
  },
  {
    name: 'participant-screen',
    displayName: 'Participant',
    streamType: 'screen',
    width: 1920,
    height: 1080,
    bgColor: '#d63031', // Red for participant screen
    labelColor: '#ffeaa7' // Yellow label
  }
];

const FPS = 30;
const TOTAL_FRAMES = FPS * DURATION_SECONDS;

/**
 * Render a single frame to the canvas (matches the existing mock logic)
 */
function renderFrame(ctx, config, frameNumber) {
  const { width, height, bgColor, displayName, streamType, labelColor } = config;
  const isScreen = streamType === 'screen';
  const typeLabel = isScreen ? 'SCREEN SHARE' : 'CAMERA';

  // Background color
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  if (isScreen) {
    // Grid pattern for screen share (40px squares)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  } else {
    // Animated diagonal stripes for camera
    const stripeWidth = 60;
    const offset = (frameNumber * 3) % (stripeWidth * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    for (let x = -height + offset; x < width + height; x += stripeWidth * 2) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + height, height);
      ctx.lineTo(x + height + stripeWidth, height);
      ctx.lineTo(x + stripeWidth, 0);
      ctx.closePath();
    }
    ctx.fill();
  }

  // Semi-transparent overlay for text readability
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(width / 2 - 180, height / 2 - 70, 360, 140);

  // User name (large, prominent, at top)
  ctx.fillStyle = 'white';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(displayName, width / 2, height / 2 - 30);

  // Stream type label (medium, below name)
  ctx.fillStyle = labelColor;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(typeLabel, width / 2, height / 2 + 10);

  // Frame counter and timestamp
  const totalSeconds = Math.floor(frameNumber / FPS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timestamp = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`Frame: ${frameNumber} | ${timestamp}`, width / 2, height / 2 + 45);
}

/**
 * Generate a single video file by piping canvas frames to FFmpeg
 */
async function generateVideo(config) {
  const { name, width, height } = config;
  const outputPath = join(OUTPUT_DIR, `${name}.mp4`);

  console.log(
    `\nGenerating ${name}.mp4 (${width}x${height}, ${DURATION_SECONDS}s @ ${FPS}fps)...`
  );

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  return new Promise((resolve, reject) => {
    // FFmpeg command: read raw video from stdin, encode to H.264
    const ffmpeg = spawn(ffmpegPath, [
      '-y', // Overwrite output
      '-f',
      'rawvideo', // Input format
      '-pix_fmt',
      'rgba', // Input pixel format (canvas uses RGBA)
      '-s',
      `${width}x${height}`, // Input size
      '-r',
      String(FPS), // Input framerate
      '-i',
      '-', // Read from stdin
      '-c:v',
      'libx264', // H.264 codec
      '-pix_fmt',
      'yuv420p', // Output pixel format (for compatibility)
      '-preset',
      'ultrafast', // Fast encoding (acceptable quality for tests)
      '-crf',
      '23', // Quality level
      '-movflags',
      '+faststart', // Enable streaming
      outputPath
    ]);

    let lastProgress = '';
    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      // Extract frame progress from FFmpeg output
      const match = msg.match(/frame=\s*(\d+)/);
      if (match) {
        const currentFrame = parseInt(match[1], 10);
        const percent = ((currentFrame / TOTAL_FRAMES) * 100).toFixed(1);
        const progress = `  Encoding: ${percent}% (frame ${currentFrame}/${TOTAL_FRAMES})`;
        if (progress !== lastProgress) {
          process.stdout.write(`\r${progress.padEnd(60)}`);
          lastProgress = progress;
        }
      }
    });

    ffmpeg.on('close', (code) => {
      process.stdout.write('\n');
      if (code === 0) {
        console.log(`  Done: ${outputPath}`);
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);

    // Feed frames to FFmpeg
    let frame = 0;
    let lastLoggedPercent = -1;

    const writeFrame = () => {
      if (frame >= TOTAL_FRAMES) {
        ffmpeg.stdin.end();
        return;
      }

      renderFrame(ctx, config, frame);
      // Get raw RGBA pixel data from canvas
      const imageData = ctx.getImageData(0, 0, width, height);
      const buffer = Buffer.from(imageData.data.buffer);

      const canWrite = ffmpeg.stdin.write(buffer);
      frame++;

      // Log rendering progress every 10%
      const percent = Math.floor((frame / TOTAL_FRAMES) * 10) * 10;
      if (percent !== lastLoggedPercent && percent > 0) {
        console.log(`  Rendering: ${percent}% (${frame}/${TOTAL_FRAMES} frames)`);
        lastLoggedPercent = percent;
      }

      if (canWrite) {
        setImmediate(writeFrame);
      } else {
        ffmpeg.stdin.once('drain', writeFrame);
      }
    };

    writeFrame();
  });
}

/**
 * Main entry point
 */
async function main() {
  console.log('Mock Video Generator');
  console.log('====================');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Duration: ${DURATION_SECONDS}s (${TOTAL_FRAMES} frames @ ${FPS}fps)`);
  console.log(`FFmpeg: ${ffmpegPath}`);

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const startTime = Date.now();

  // Generate videos sequentially (to avoid memory issues)
  for (const config of VIDEO_CONFIGS) {
    await generateVideo(config);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll videos generated successfully in ${elapsed}s!`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
