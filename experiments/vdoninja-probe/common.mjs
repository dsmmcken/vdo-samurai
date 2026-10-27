import { chromium } from 'playwright-core';
import os from 'node:os';
import crypto from 'node:crypto';

const CHROME = `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;

// One browser per peer so per-peer CPU can be read from that browser's processes.
export async function launchPeer(url, name) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  page.on('console', (m) => m.text().startsWith('[lab]') && console.log(`  ${name}:`, m.text().slice(6)));
  page.on('pageerror', (e) => console.log(`  ${name} PAGEERROR:`, e.message));
  await page.goto(url);
  await page.evaluate((n) => (window.lab.name = n), name);
  const cdp = await browser.newBrowserCDPSession();
  const cpuSeconds = async () => {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    return processInfo.reduce((sum, p) => sum + p.cpuTime, 0);
  };
  return { name, browser, page, cpuSeconds };
}

export const rand = (n = 8) => crypto.randomBytes(n).toString('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
