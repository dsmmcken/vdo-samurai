// Can headless Chromium here use the GPU for WebCodecs encode/decode?
import { chromium } from 'playwright-core';
import os from 'node:os';
import { startServer } from './server.mjs';

const { server, url } = await startServer();

const CHROME = `${os.homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const variants = {
  default: [],
  gpu: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan,VaapiVideoDecoder,VaapiVideoEncoder,AcceleratedVideoDecodeLinuxGL,AcceleratedVideoEncoder'],
};

for (const [name, args] of Object.entries(variants)) {
  const browser = await chromium.launch({ executablePath: CHROME, args });
  const page = await browser.newPage();
  await page.goto(url);
  const res = await page.evaluate(async () => {
    const out = {};
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    out.webglRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : String(gl);
    out.webgpu = navigator.gpu ? (await navigator.gpu.requestAdapter())?.info?.description ?? 'no adapter' : 'none';
    for (const codec of ['avc1.640028', 'vp09.00.40.08', 'av01.0.08M.08']) {
      const cfg = { codec, width: 1920, height: 1080, bitrate: 6e6, framerate: 30, hardwareAcceleration: 'prefer-hardware' };
      out[`enc ${codec}`] = (await VideoEncoder.isConfigSupported(cfg).catch((e) => ({ supported: e.message }))).supported;
      out[`dec ${codec}`] = (await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080, hardwareAcceleration: 'prefer-hardware' }).catch((e) => ({ supported: e.message }))).supported;
    }
    return out;
  });
  const gpuPage = await browser.newPage();
  await gpuPage.goto('chrome://gpu');
  await gpuPage.waitForTimeout(1500);
  const text = await gpuPage.evaluate(() => document.body.innerText + [...document.querySelectorAll('info-view')].map((v) => v.shadowRoot?.textContent || '').join('\n'));
  const lines = text.split('\n').filter((l) => /Video Decode|Video Encode|Hardware accel|GL_RENDERER|VA-API|Vulkan:|WebGL:|Rasterization/i.test(l)).slice(0, 20);
  console.log(`\n### ${name}\n`, res, '\n', lines.join('\n'));
  await browser.close();
}
server.close();
