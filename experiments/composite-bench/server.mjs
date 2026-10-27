// Serves the compositing benchmark. Clips support Range requests; finished runs
// POST their numbers to /result so they land in results/ for us to read.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
const files = {
  '/': ['index.html', 'text/html'],
  '/bench.js': ['bench.js', 'text/javascript'],
  '/mediabunny.mjs': ['node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', 'text/javascript'],
};

http
  .createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/result') return saveResult(req, res);
    const clip = url.match(/^\/clips\/(clip\d+\.mp4)$/);
    if (clip) return sendFile(req, res, path.join(root, 'clips', clip[1]), 'video/mp4');
    if (files[url]) return sendFile(req, res, path.join(root, files[url][0]), files[url][1]);
    res.writeHead(404).end();
  })
  .listen(port, host, () => console.log(`composite bench on http://localhost:${port}/`));

function sendFile(req, res, file, type) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return res.writeHead(404).end();
  }
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (!range) {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
    return fs.createReadStream(file).pipe(res);
  }
  const start = range[1] ? Number(range[1]) : size - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  res.writeHead(206, {
    'content-type': type,
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${size}`,
    'accept-ranges': 'bytes',
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

function saveResult(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      const result = JSON.parse(body);
      fs.mkdirSync(path.join(root, 'results'), { recursive: true });
      const name = `result-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(root, 'results', name), JSON.stringify(result, null, 2));
      console.log(`saved results/${name}: ${result.summary}`);
      res.writeHead(204).end();
    } catch {
      res.writeHead(400).end();
    }
  });
}
