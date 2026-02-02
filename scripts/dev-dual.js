#!/usr/bin/env node

/**
 * Launches Electron host + Browser participant for manual P2P testing
 * Usage: npm run dev:dual
 *
 * - Host: Electron app with simulated media
 * - Participant: Browser app via Vite dev server (with hot reload)
 */

import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const ELECTRON_PATH = join(projectRoot, 'node_modules', '.bin', 'electron');
const MAIN_ENTRY = join(projectRoot, 'out', 'main', 'index.js');

// Vite dev server port (from vite.config.web.ts)
const VITE_DEV_PORT = 5173;

const processes = [];
const tempDirs = [];

/**
 * Build the Electron app if needed
 */
function ensureElectronBuilt() {
  if (!existsSync(MAIN_ENTRY)) {
    console.log('[dev-dual] Electron app not built. Running npm run build...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
  } else {
    console.log('[dev-dual] Electron app built at:', MAIN_ENTRY);
  }
}

/**
 * Create a unique temp directory for user data
 */
function createTempDir(instanceId) {
  const tempDir = join(tmpdir(), 'vdo-samurai-dual', `${instanceId}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  tempDirs.push(tempDir);
  return tempDir;
}

/**
 * Kill any existing process on the Vite dev port
 */
function killExistingViteServer() {
  try {
    // Find and kill process on port 5173
    if (process.platform === 'win32') {
      execSync(`netstat -ano | findstr :${VITE_DEV_PORT} | findstr LISTENING`, { encoding: 'utf8' });
      // If found, kill it
      const output = execSync(`netstat -ano | findstr :${VITE_DEV_PORT} | findstr LISTENING`, { encoding: 'utf8' });
      const pid = output.trim().split(/\s+/).pop();
      if (pid) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`[dev-dual] Killed existing process on port ${VITE_DEV_PORT}`);
      }
    } else {
      // macOS/Linux
      const output = execSync(`lsof -ti:${VITE_DEV_PORT}`, { encoding: 'utf8' }).trim();
      if (output) {
        execSync(`kill -9 ${output}`, { stdio: 'ignore' });
        console.log(`[dev-dual] Killed existing process on port ${VITE_DEV_PORT}`);
      }
    }
  } catch {
    // No process found on port, which is fine
  }
}

/**
 * Start the Vite dev server for browser participant
 */
function startViteDevServer() {
  return new Promise((resolve, reject) => {
    console.log('[dev-dual] Starting Vite dev server...');

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const viteProcess = spawn(npmCmd, ['run', 'dev:web'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processes.push({ process: viteProcess, id: 'vite-dev-server' });

    let resolved = false;

    // Watch for server ready message
    viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(`[vite] ${output}`);

      // Vite outputs "Local: http://localhost:5173/" when ready
      if (!resolved && output.includes('Local:')) {
        resolved = true;
        resolve(viteProcess);
      }
    });

    viteProcess.stderr.on('data', (data) => {
      process.stderr.write(`[vite] ${data}`);
    });

    viteProcess.on('error', (err) => {
      console.error('[dev-dual] Failed to start Vite dev server:', err.message);
      if (!resolved) {
        reject(err);
      }
    });

    viteProcess.on('exit', (code) => {
      console.log(`[dev-dual] Vite dev server exited with code ${code}`);
      if (!resolved) {
        reject(new Error(`Vite exited with code ${code}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Assume it's ready even if we didn't see the message
        console.log('[dev-dual] Vite server startup timeout, assuming ready...');
        resolve(viteProcess);
      }
    }, 30000);
  });
}

/**
 * Launch the Electron host instance
 */
function launchElectronHost() {
  const userDataDir = createTempDir('host');

  console.log('[dev-dual] Starting Electron host...');
  console.log(`[dev-dual]   User data: ${userDataDir}`);

  const electronProcess = spawn(
    ELECTRON_PATH,
    [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        SIMULATE_MEDIA: 'true',
        INSTANCE_ID: 'host',
        WINDOW_OFFSET: '0',
      },
    }
  );

  electronProcess.on('error', (err) => {
    console.error('[dev-dual] Failed to start Electron host:', err.message);
  });

  electronProcess.on('exit', (code) => {
    console.log(`[dev-dual] Electron host exited with code ${code}`);
  });

  processes.push({ process: electronProcess, id: 'host' });
  return electronProcess;
}

/**
 * Open browser for participant
 */
function openBrowserParticipant() {
  const url = `http://localhost:${VITE_DEV_PORT}/vdo-samurai/`;

  console.log('[dev-dual] Opening browser participant...');
  console.log(`[dev-dual]   URL: ${url}`);

  // Determine the command to open browser based on platform
  let command;
  let args;

  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', url];
  } else {
    // Linux
    command = 'xdg-open';
    args = [url];
  }

  const browserProcess = spawn(command, args, {
    cwd: projectRoot,
    stdio: 'ignore',
    detached: true,
  });

  browserProcess.unref();

  console.log('[dev-dual] Browser opened (participant)');
}

/**
 * Cleanup function
 */
function cleanup() {
  console.log('\n[dev-dual] Shutting down...');

  // Kill all processes
  for (const { process: proc, id } of processes) {
    if (!proc.killed) {
      console.log(`[dev-dual] Killing ${id}...`);
      proc.kill('SIGTERM');
      // Force kill after a short delay
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 1000);
    }
  }

  // Remove temp directories
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
      console.log(`[dev-dual] Cleaned up: ${dir}`);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Give processes time to die, then exit
  setTimeout(() => {
    process.exit(0);
  }, 1500);
}

// Handle shutdown signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Main
console.log('[dev-dual] VDO Samurai Dual Instance Launcher');
console.log('[dev-dual] ===================================');
console.log('[dev-dual] This will launch:');
console.log('[dev-dual]   - Electron host with simulated media');
console.log('[dev-dual]   - Browser participant via Vite dev server (hot reload!)');
console.log('[dev-dual] Press Ctrl+C to stop.\n');

// Ensure Electron build exists
ensureElectronBuilt();

// Kill any existing Vite server on the port
killExistingViteServer();

// Start Vite dev server
try {
  await startViteDevServer();
  console.log(`[dev-dual] Vite dev server ready at http://localhost:${VITE_DEV_PORT}`);
} catch (err) {
  console.error('[dev-dual] Failed to start Vite dev server:', err.message);
  process.exit(1);
}

// Launch Electron host
launchElectronHost();

// Small delay then open browser
await new Promise((resolve) => setTimeout(resolve, 1000));
openBrowserParticipant();

console.log('\n[dev-dual] Both instances launched!');
console.log('[dev-dual] Instructions:');
console.log('[dev-dual]   1. In Electron (Host): Complete profile setup and create a session');
console.log('[dev-dual]   2. Copy the session code from the URL or share dialog');
console.log('[dev-dual]   3. In Browser (Participant): Complete profile setup and join with the code');
console.log('[dev-dual]   4. Test P2P features: screen share, recording, file transfer');
console.log('[dev-dual]');
console.log('[dev-dual] Browser has hot reload - changes to src/ will auto-refresh!');
