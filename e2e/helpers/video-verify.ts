import * as fs from 'fs';
import type { Page } from '@playwright/test';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

/**
 * Verify a video file exists
 */
export function verifyFileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Get file size in bytes
 */
export function getFileSize(filePath: string): number {
  const stats = fs.statSync(filePath);
  return stats.size;
}

/**
 * Get video info using the app's FFmpeg IPC
 * This reuses the existing FFmpeg integration
 */
export async function getVideoInfo(page: Page, filePath: string): Promise<VideoInfo> {
  const info = await page.evaluate(async (path) => {
    type ElectronAPI = { ffmpeg?: { getVideoInfo?: (path: string) => Promise<VideoInfo> } };
    const win = window as unknown as { electronAPI?: ElectronAPI };
    if (!win.electronAPI?.ffmpeg?.getVideoInfo) {
      throw new Error('FFmpeg API not available');
    }
    return win.electronAPI.ffmpeg.getVideoInfo(path);
  }, filePath);

  return info as VideoInfo;
}

/**
 * Verify video duration is within expected range
 */
export async function verifyVideoDuration(
  page: Page,
  filePath: string,
  expectedSeconds: number,
  toleranceSeconds = 1
): Promise<{ valid: boolean; actual: number; expected: number; tolerance: number }> {
  const info = await getVideoInfo(page, filePath);
  const valid =
    info.duration >= expectedSeconds - toleranceSeconds &&
    info.duration <= expectedSeconds + toleranceSeconds;

  return {
    valid,
    actual: info.duration,
    expected: expectedSeconds,
    tolerance: toleranceSeconds,
  };
}

/**
 * Delete a file (for cleanup)
 */
export function deleteFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
