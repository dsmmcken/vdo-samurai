// Minimal static server: localhost is a secure context, so getUserMedia works.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const routes = {
  '/': ['page.html', 'text/html'],
  '/lab.js': ['lab.js', 'text/javascript'],
  '/sdk.js': ['node_modules/@vdoninja/sdk/vdoninja-sdk.js', 'text/javascript'],
};

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const route = routes[req.url.split('?')[0]];
    if (!route) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': route[1] });
    fs.createReadStream(path.join(root, route[0])).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://localhost:${server.address().port}/` })),
  );
}
