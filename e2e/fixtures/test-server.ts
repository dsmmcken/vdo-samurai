/**
 * Test server for serving the web build and test assets
 * Used for cross-platform E2E tests (Electron + Browser)
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const DIST_WEB_DIR = path.join(PROJECT_ROOT, 'dist-web');
const TEST_VIDEOS_DIR = path.join(PROJECT_ROOT, 'e2e/test-assets/videos');

// Default port for test server
const DEFAULT_PORT = 5174;

// MIME types for common files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export interface TestServer {
  server: http.Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Start the test server
 */
export async function startTestServer(port: number = DEFAULT_PORT): Promise<TestServer> {
  // Verify dist-web exists
  if (!fs.existsSync(DIST_WEB_DIR)) {
    throw new Error(
      `Web build not found. Run: npm run build:web\nExpected: ${DIST_WEB_DIR}`
    );
  }

  // Verify test videos exist
  if (!fs.existsSync(TEST_VIDEOS_DIR)) {
    throw new Error(
      `Test videos not found. Run: npm run generate:test-videos\nExpected: ${TEST_VIDEOS_DIR}`
    );
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      let pathname = url.pathname;

      // Set CORS headers for all responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

      // Required headers for WebRTC/SharedArrayBuffer
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Route: /test-videos/* -> e2e/test-assets/videos/*
      if (pathname.startsWith('/test-videos/')) {
        const videoPath = pathname.replace('/test-videos/', '');
        const filePath = path.join(TEST_VIDEOS_DIR, videoPath);
        serveFile(res, filePath);
        return;
      }

      // Route: /vdo-samurai/* -> dist-web/*
      // The web build uses base: '/vdo-samurai/' so all assets are under this path
      if (pathname.startsWith('/vdo-samurai/')) {
        pathname = pathname.replace('/vdo-samurai/', '/');
      }

      // Serve from dist-web
      let filePath = path.join(DIST_WEB_DIR, pathname);

      // SPA fallback: if path doesn't exist or is a directory without index.html, serve index.html
      if (!fs.existsSync(filePath) ||
          (fs.statSync(filePath).isDirectory() && !fs.existsSync(path.join(filePath, 'index.html')))) {
        filePath = path.join(DIST_WEB_DIR, 'index.html');
      } else if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      serveFile(res, filePath);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      const baseUrl = `http://localhost:${port}`;
      console.log(`[TestServer] Started on ${baseUrl}`);
      console.log(`[TestServer] Serving dist-web from: ${DIST_WEB_DIR}`);
      console.log(`[TestServer] Test videos at: ${baseUrl}/test-videos/`);

      resolve({
        server,
        port,
        baseUrl,
        close: () => new Promise<void>((closeResolve) => {
          server.close(() => {
            console.log('[TestServer] Stopped');
            closeResolve();
          });
        }),
      });
    });
  });
}

/**
 * Serve a file with proper headers
 */
function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error(`[TestServer] Error streaming file: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal Server Error');
    });
  } catch (err) {
    console.error(`[TestServer] Error serving file: ${err}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

/**
 * Stop the test server
 */
export async function stopTestServer(testServer: TestServer): Promise<void> {
  await testServer.close();
}
