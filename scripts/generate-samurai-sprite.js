#!/usr/bin/env node
/**
 * Generate a combined sprite sheet for samurai animations.
 *
 * Combines 8 run frames (mirrored to face right) + 10 idle frames
 * into a single horizontal sprite strip at 30px height.
 */

import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '../public');

// Configuration
const SOURCE_WIDTH = 595;
const SOURCE_HEIGHT = 483;
const TARGET_HEIGHT = 30;
const SCALE = TARGET_HEIGHT / SOURCE_HEIGHT;
const FRAME_WIDTH = Math.round(SOURCE_WIDTH * SCALE); // ~37px

const RUN_FRAMES = 8;
const IDLE_FRAMES = 1; // Just first frame for static idle
const TOTAL_FRAMES = RUN_FRAMES + IDLE_FRAMES;

async function generateSpriteSheet() {
  console.log('Generating samurai sprite sheet...');
  console.log(`Scale factor: ${SCALE.toFixed(4)}`);
  console.log(`Frame size: ${FRAME_WIDTH}x${TARGET_HEIGHT}`);
  console.log(`Total frames: ${TOTAL_FRAMES} (${RUN_FRAMES} run + ${IDLE_FRAMES} idle)`);

  const totalWidth = FRAME_WIDTH * TOTAL_FRAMES;
  const canvas = createCanvas(totalWidth, TARGET_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Disable image smoothing for crisp pixel art scaling (nearest-neighbor)
  ctx.imageSmoothingEnabled = false;

  // Load and draw run frames (mirrored to face right)
  console.log('\nProcessing run frames (mirrored)...');
  for (let i = 0; i < RUN_FRAMES; i++) {
    const filename = `__Samurai1_Run_${String(i).padStart(3, '0')}.png`;
    const filepath = join(PUBLIC_DIR, '02-Run', filename);
    const img = await loadImage(filepath);

    const x = i * FRAME_WIDTH;

    ctx.save();
    // Move to frame position, flip horizontally
    ctx.translate(x + FRAME_WIDTH, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, SOURCE_WIDTH, SOURCE_HEIGHT, 0, 0, FRAME_WIDTH, TARGET_HEIGHT);
    ctx.restore();

    console.log(`  Frame ${i}: ${filename} -> position ${x}px (mirrored)`);
  }

  // Load and draw idle frames (not mirrored - already facing right)
  console.log('\nProcessing idle frames...');
  for (let i = 0; i < IDLE_FRAMES; i++) {
    const filename = `__Samurai1_Idle_${String(i).padStart(3, '0')}.png`;
    const filepath = join(PUBLIC_DIR, '01-Idle', filename);
    const img = await loadImage(filepath);

    const x = (RUN_FRAMES + i) * FRAME_WIDTH;
    ctx.drawImage(img, 0, 0, SOURCE_WIDTH, SOURCE_HEIGHT, x, 0, FRAME_WIDTH, TARGET_HEIGHT);

    console.log(`  Frame ${RUN_FRAMES + i}: ${filename} -> position ${x}px`);
  }

  // Export as PNG
  const buffer = canvas.toBuffer('image/png');
  const outputPath = join(PUBLIC_DIR, 'samurai-sprite.png');
  writeFileSync(outputPath, buffer);

  console.log(`\nGenerated: ${outputPath}`);
  console.log(`Dimensions: ${canvas.width}x${canvas.height}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB`);

  // Output useful CSS values
  console.log('\nCSS values for animation:');
  console.log(`  Frame width: ${FRAME_WIDTH}px`);
  console.log(`  Run animation end: -${RUN_FRAMES * FRAME_WIDTH}px`);
  console.log(`  Idle animation start: -${RUN_FRAMES * FRAME_WIDTH}px`);
  console.log(`  Idle animation end: -${TOTAL_FRAMES * FRAME_WIDTH}px`);
}

generateSpriteSheet().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
