/**
 * Local media server for Speed Dial
 *
 * Serves local video files via HTTP so that captureStream() works properly.
 * Chromium treats localhost as a secure context, avoiding "tainted" source issues.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { createReadStream, statSync } from 'fs';
import { extname } from 'path';
import { randomBytes } from 'crypto';

let server: Server | null = null;
let serverPort = 0;
let serverToken = ''; // Secret token to validate requests

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v'
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'video/mp4';
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  // Common CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  // Parse URL to get file path
  const url = new URL(req.url || '/', `http://localhost:${serverPort}`);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    res.writeHead(400);
    res.end('Missing path parameter');
    return;
  }

  // Validate token to prevent other local apps from accessing
  const token = url.searchParams.get('token');
  if (!token || token !== serverToken) {
    console.warn('[MediaServer] Invalid or missing token');
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  console.log('[MediaServer] Request for:', filePath);

  // Get file stats
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    console.error('[MediaServer] File not found:', filePath);
    res.writeHead(404);
    res.end('File not found');
    return;
  }

  const fileSize = stat.size;
  const mimeType = getMimeType(filePath);
  const range = req.headers.range;

  if (range) {
    // Handle range request for video seeking
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    console.log('[MediaServer] Range request:', start, '-', end, '/', fileSize);

    res.writeHead(206, {
      ...corsHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType
    });

    const stream = createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[MediaServer] Stream error:', err);
      res.end();
    });
  } else {
    // Full file request
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes'
    });

    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      console.error('[MediaServer] Stream error:', err);
      res.end();
    });
  }
}

/**
 * Start the media server on a random available port
 */
export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(serverPort);
      return;
    }

    server = createServer(handleRequest);

    server.on('error', (err) => {
      console.error('[MediaServer] Server error:', err);
      reject(err);
    });

    // Generate a new token for this session
    serverToken = randomBytes(32).toString('hex');

    // Listen on port 0 to get a random available port
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (address && typeof address === 'object') {
        serverPort = address.port;
        console.log('[MediaServer] Started on port:', serverPort);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });
  });
}

/**
 * Stop the media server
 */
export function stopMediaServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log('[MediaServer] Stopped');
        server = null;
        serverPort = 0;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Get the current server port (0 if not running)
 */
export function getMediaServerPort(): number {
  return serverPort;
}

/**
 * Get the current server token (empty if not running)
 */
export function getMediaServerToken(): string {
  return serverToken;
}
