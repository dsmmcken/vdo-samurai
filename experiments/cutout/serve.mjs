// Static server: this folder, plus the app's model and kernels under /app/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const app = path.join(root, '../../src');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };

export function serve(port = 8099) {
  return http
    .createServer((q, s) => {
      const url = decodeURIComponent(q.url.split('?')[0]);
      const [base, rel] = url.startsWith('/app/') ? [app, url.slice(5)] : [root, url];
      const f = path.join(base, rel);
      if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return s.writeHead(404).end();
      s.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
      fs.createReadStream(f).pipe(s);
    })
    .listen(port);
}
