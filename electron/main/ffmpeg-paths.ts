/**
 * Platform-aware ffmpeg/ffprobe binary path resolution.
 * Supports cross-platform development (e.g., WSL running Windows Electron).
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import ffmpegStaticPath from 'ffmpeg-static';

interface BinaryPaths {
  ffmpeg: string;
  ffprobe: string;
}

// Binary filenames per platform (development mode uses full names)
const BINARIES_DEV: Record<string, Record<string, { ffmpeg: string; ffprobe: string }>> = {
  win32: {
    x64: { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' },
  },
  linux: {
    x64: { ffmpeg: 'ffmpeg-linux-x64', ffprobe: 'ffprobe-linux-x64' },
  },
  darwin: {
    x64: { ffmpeg: 'ffmpeg-darwin-x64', ffprobe: 'ffprobe-darwin-x64' },
    arm64: { ffmpeg: 'ffmpeg-darwin-arm64', ffprobe: 'ffprobe-darwin-arm64' },
  },
};

// In packaged builds, electron-builder renames to consistent names
const BINARIES_PROD: Record<string, { ffmpeg: string; ffprobe: string }> = {
  win32: { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' },
  linux: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
  darwin: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
};

function getResourcesPath(): string {
  // In production, use app resources path
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg');
  }
  // Development: resources/ffmpeg relative to project root
  // __dirname is electron/main (out/main in built), so navigate to project root
  return join(__dirname, '..', '..', 'resources', 'ffmpeg');
}

function resolveBinaryPaths(): BinaryPaths {
  const platform = process.platform;
  const arch = process.arch;
  const resourcesPath = getResourcesPath();

  // In packaged mode, use consistent binary names
  if (app.isPackaged) {
    const binaries = BINARIES_PROD[platform];
    if (binaries) {
      const ffmpegPath = join(resourcesPath, binaries.ffmpeg);
      const ffprobePath = join(resourcesPath, binaries.ffprobe);

      if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
        console.log(`[ffmpeg-paths] Using packaged binaries from: ${resourcesPath}`);
        return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
      }
    }
  }

  // In development, use platform-specific names from resources/ffmpeg
  const devBinaries = BINARIES_DEV[platform]?.[arch];
  if (devBinaries) {
    const ffmpegPath = join(resourcesPath, devBinaries.ffmpeg);
    const ffprobePath = join(resourcesPath, devBinaries.ffprobe);

    if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
      console.log(`[ffmpeg-paths] Using dev binaries from: ${resourcesPath}`);
      return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
    }

    // Check if only ffmpeg exists (ffprobe might not be downloaded yet)
    if (existsSync(ffmpegPath)) {
      console.log(`[ffmpeg-paths] FFmpeg found, but ffprobe missing at: ${ffprobePath}`);
    }
  }

  // Fall back to ffmpeg-static for ffmpeg (handles edge cases)
  if (ffmpegStaticPath && existsSync(ffmpegStaticPath)) {
    console.warn(`[ffmpeg-paths] Falling back to ffmpeg-static. Cross-platform dev may not work.`);
    console.warn(`[ffmpeg-paths] Run 'npm run download:ffmpeg' to download all platform binaries.`);

    // Try to find ffprobe from @ffprobe-installer
    try {
      // Dynamic import to avoid the require.resolve error at module load time
      const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
      if (ffprobeInstaller.path && existsSync(ffprobeInstaller.path)) {
        return { ffmpeg: ffmpegStaticPath, ffprobe: ffprobeInstaller.path };
      }
    } catch {
      // ffprobe-installer failed, which is expected in cross-platform scenarios
    }

    throw new Error(
      `FFprobe binary not found for ${platform}-${arch}. ` +
        `Run 'npm run download:ffmpeg' to download binaries.`
    );
  }

  throw new Error(
    `FFmpeg/FFprobe binaries not found for ${platform}-${arch}. ` +
      `Run 'npm run download:ffmpeg' to download binaries.`
  );
}

let cachedPaths: BinaryPaths | null = null;

export function getFFmpegPaths(): BinaryPaths {
  if (cachedPaths) {
    return cachedPaths;
  }

  cachedPaths = resolveBinaryPaths();

  console.log(`[ffmpeg-paths] FFmpeg: ${cachedPaths.ffmpeg}`);
  console.log(`[ffmpeg-paths] FFprobe: ${cachedPaths.ffprobe}`);

  return cachedPaths;
}

export function getFFmpegPath(): string {
  return getFFmpegPaths().ffmpeg;
}

export function getFFprobePath(): string {
  return getFFmpegPaths().ffprobe;
}
