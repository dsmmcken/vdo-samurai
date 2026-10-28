// Sender CPU for a screen share sent to 1, 2, 4 and 6 viewers (one encode each,
// like the app's mesh). Sender and viewers run in separate headless browsers, and
// only the sender browser's processes are counted (from /proc, utime + stime).
// Usage: CHROME=/path/to/chrome node cpu-run.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) return s.writeHead(404).end();
  s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(s);
}).listen(8099);

const HZ = 100; // clock ticks per second on Linux
function cpuTicks(rootPid) {
  const procs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map((pid) => {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      return { pid: +pid, ppid: +f[1], ticks: +f[11] + +f[12] };
    } catch { return null; }
  }).filter(Boolean);
  const tree = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) if (!tree.has(p.pid) && tree.has(p.ppid)) (tree.add(p.pid), (grew = true));
  }
  return procs.filter((p) => tree.has(p.pid)).reduce((a, p) => a + p.ticks, 0);
}

const opts = { executablePath: process.env.CHROME };
const server = await chromium.launchServer(opts); // launchServer exposes the process id
const sb = await chromium.connect(server.wsEndpoint()), rb = await chromium.launch(opts);
const send = await sb.newPage(), recv = await rb.newPage();
await send.exposeFunction('relay', (m) => recv.evaluate((m) => window.signal(m), m));
await recv.exposeFunction('relay', (m) => send.evaluate((m) => window.signal(m), m));
await send.goto('http://localhost:8099/cpu.html?role=send');
await recv.goto('http://localhost:8099/cpu.html?role=recv');
await send.waitForFunction(() => window.setup);
await recv.waitForFunction(() => window.signal);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = server.process().pid;
const rows = [];
for (const cfg of [{ codec: 'VP8', height: 720, kbps: 900, fps: 8, name: 'VP8 720p (today)' }, { codec: 'AV1', height: 1080, kbps: 900, fps: 8, name: 'AV1 1080p 8fps' }, { codec: 'AV1', height: 1080, kbps: 1500, fps: 15, name: 'AV1 1080p 15fps' }]) {
  // Baseline: the page drawing its screen with nobody watching.
  await send.evaluate((c) => window.setup({ ...c, viewers: 0 }), cfg);
  await wait(2000);
  let c0 = cpuTicks(pid); await wait(8000); const idleStill = (cpuTicks(pid) - c0) / HZ / 8;
  c0 = cpuTicks(pid); await send.evaluate(() => window.scrollFor(8000)); const idleScroll = (cpuTicks(pid) - c0) / HZ / 8;
  await send.evaluate(() => window.teardown());
  for (const viewers of [1, 2, 4, 6]) {
    await send.evaluate((c) => window.setup(c), { ...cfg, viewers });
    await wait(6000); // connect and ramp up
    c0 = cpuTicks(pid); await wait(8000); const still = (cpuTicks(pid) - c0) / HZ / 8;
    c0 = cpuTicks(pid); await send.evaluate(() => window.scrollFor(8000)); const scrolling = (cpuTicks(pid) - c0) / HZ / 8;
    const st = await send.evaluate(() => window.stats());
    await send.evaluate(() => window.teardown());
    await recv.evaluate(() => { location.reload(); });
    await recv.waitForFunction(() => window.signal);
    rows.push({ setting: cfg.name, viewers, codecs: [...new Set(st.map((s) => s.codec))].join(), width: st[0]?.w,
      'still % core': Math.round((still - idleStill) * 100), 'scroll % core': Math.round((scrolling - idleScroll) * 100) });
    console.log(JSON.stringify(rows.at(-1)));
  }
}
console.table(rows);
fs.mkdirSync(path.join(root, 'results'), { recursive: true });
fs.writeFileSync(path.join(root, 'results', 'cpu.json'), JSON.stringify(rows, null, 1));
await sb.close(); await server.close(); await rb.close(); srv.close();
