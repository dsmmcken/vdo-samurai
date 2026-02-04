#!/usr/bin/env node
/**
 * Downloads ffmpeg and ffprobe binaries for all target platforms.
 * Runs as a postinstall script to ensure cross-platform development works.
 */

import { createWriteStream, existsSync, chmodSync, createReadStream } from 'fs';
import { mkdir, rm, readdir, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const BINARIES_DIR = join(PROJECT_ROOT, 'resources', 'ffmpeg');
const TEMP_DIR = join(PROJECT_ROOT, 'resources', '.tmp');

// Target platforms to download
const PLATFORMS = [
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'darwin', arch: 'arm64' },
];

// FFmpeg binary naming
const getFFmpegFilename = (platform, arch) => {
  if (platform === 'win32') return 'ffmpeg.exe';
  return `ffmpeg-${platform}-${arch}`;
};

// FFprobe binary naming
const getFFprobeFilename = (platform, arch) => {
  if (platform === 'win32') return 'ffprobe.exe';
  return `ffprobe-${platform}-${arch}`;
};

async function getLatestFFmpegRelease() {
  console.log('Fetching latest ffmpeg-static release...');
  const response = await fetch('https://api.github.com/repos/eugeneware/ffmpeg-static/releases/latest');
  if (!response.ok) {
    throw new Error(`Failed to fetch ffmpeg release info: ${response.status}`);
  }
  const data = await response.json();
  return data.tag_name;
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  const fileStream = createWriteStream(targetPath);
  await pipeline(response.body, fileStream);
}

async function downloadFFmpegBinary(version, platform, arch, targetPath) {
  const assetName = `ffmpeg-${platform}-${arch}`;
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${version}/${assetName}`;

  console.log(`  Downloading ffmpeg for ${platform}-${arch}...`);
  await downloadFile(url, targetPath);

  if (platform !== 'win32') {
    chmodSync(targetPath, 0o755);
  }
}

async function downloadFFprobeBinary(platform, arch, targetPath) {
  // FFprobe is distributed via npm packages
  const packageName = `@ffprobe-installer/${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

  console.log(`  Downloading ffprobe for ${platform}-${arch}...`);

  // Get the tarball URL from npm registry
  const registryUrl = `https://registry.npmjs.org/${packageName}`;
  const registryResponse = await fetch(registryUrl);
  if (!registryResponse.ok) {
    throw new Error(`Failed to fetch ${packageName} info: ${registryResponse.status}`);
  }
  const packageInfo = await registryResponse.json();
  const latestVersion = packageInfo['dist-tags'].latest;
  const tarballUrl = packageInfo.versions[latestVersion].dist.tarball;

  // Download and extract the tarball
  const tarballPath = join(TEMP_DIR, `ffprobe-${platform}-${arch}.tgz`);
  const extractDir = join(TEMP_DIR, `ffprobe-${platform}-${arch}`);

  await mkdir(TEMP_DIR, { recursive: true });
  await downloadFile(tarballUrl, tarballPath);

  // Extract tarball
  await mkdir(extractDir, { recursive: true });
  await extract({
    file: tarballPath,
    cwd: extractDir,
  });

  // Find and move the binary
  const extractedBinaryPath = join(extractDir, 'package', binaryName);
  if (!existsSync(extractedBinaryPath)) {
    throw new Error(`Binary not found in package: ${extractedBinaryPath}`);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await rename(extractedBinaryPath, targetPath);

  if (platform !== 'win32') {
    chmodSync(targetPath, 0o755);
  }

  // Cleanup
  await rm(tarballPath, { force: true });
  await rm(extractDir, { recursive: true, force: true });
}

async function main() {
  const force = process.argv.includes('--force');

  try {
    const ffmpegVersion = await getLatestFFmpegRelease();
    console.log(`FFmpeg version: ${ffmpegVersion}\n`);

    await mkdir(BINARIES_DIR, { recursive: true });

    for (const { platform, arch } of PLATFORMS) {
      console.log(`\n[${platform}-${arch}]`);

      // FFmpeg
      const ffmpegFilename = getFFmpegFilename(platform, arch);
      const ffmpegPath = join(BINARIES_DIR, ffmpegFilename);

      if (existsSync(ffmpegPath) && !force) {
        console.log(`  Skipping ffmpeg (exists)`);
      } else {
        await downloadFFmpegBinary(ffmpegVersion, platform, arch, ffmpegPath);
      }

      // FFprobe
      const ffprobeFilename = getFFprobeFilename(platform, arch);
      const ffprobePath = join(BINARIES_DIR, ffprobeFilename);

      if (existsSync(ffprobePath) && !force) {
        console.log(`  Skipping ffprobe (exists)`);
      } else {
        await downloadFFprobeBinary(platform, arch, ffprobePath);
      }
    }

    // Cleanup temp directory
    await rm(TEMP_DIR, { recursive: true, force: true });

    console.log('\n✓ All ffmpeg/ffprobe binaries ready!');
    console.log(`  Location: ${BINARIES_DIR}`);
  } catch (error) {
    console.error('\nError downloading binaries:', error.message);
    // Cleanup on error
    await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }
}

main();
