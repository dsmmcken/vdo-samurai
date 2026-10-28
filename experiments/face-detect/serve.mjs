// Static server for this folder. `node serve.mjs` (or PORT=8080 node serve.mjs)
// then open http://localhost:8098/demo.html
// (localhost counts as secure, so the camera works).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };

export function serve(port = 8098) {
  return http
    .createServer((q, s) => {
      const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(root) || !fs.existsSync(f)) return s.writeHead(404).end();
      if (fs.statSync(f).isDirectory())
        return s.writeHead(200, { 'content-type': 'text/html' }).end(fs.readdirSync(f).map((n) => `<a href="${n}">${n}</a>`).join('\n'));
      s.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
      fs.createReadStream(f).pipe(s);
    })
    .listen(port);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = +(process.env.PORT ?? 8098);
  serve(port);
  console.log(`http://localhost:${port}/demo.html`);
}
