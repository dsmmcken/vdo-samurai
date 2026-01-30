#!/usr/bin/env node

/**
 * Launches two Electron instances with simulated media for manual P2P testing
 * Usage: npm run dev:dual
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

// Instance configurations
const instances = [
  { id: 'host', windowOffset: 0 },
  { id: 'participant', windowOffset: 100 },
];

const processes = [];
const tempDirs = [];

/**
 * Build the app if needed
 */
function ensureBuilt() {
  if (!existsSync(MAIN_ENTRY)) {
    console.log('[dev-dual] App not built. Running npm run build...');
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
  } else {
    console.log('[dev-dual] App already built at:', MAIN_ENTRY);
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
 * Launch an Electron instance
 */
function launchInstance(config) {
  const userDataDir = createTempDir(config.id);

  console.log(`[dev-dual] Starting ${config.id} instance...`);
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
        INSTANCE_ID: config.id,
        WINDOW_OFFSET: String(config.windowOffset),
      },
    }
  );

  electronProcess.on('error', (err) => {
    console.error(`[dev-dual] Failed to start ${config.id}:`, err.message);
  });

  electronProcess.on('exit', (code) => {
    console.log(`[dev-dual] ${config.id} exited with code ${code}`);
  });

  processes.push({ process: electronProcess, id: config.id });
  return electronProcess;
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

  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Main
console.log('[dev-dual] VDO Samurai Dual Instance Launcher');
console.log('[dev-dual] ===================================');
console.log('[dev-dual] This will launch two Electron instances with simulated media.');
console.log('[dev-dual] Use one as Host, another as Participant to test P2P features.');
console.log('[dev-dual] Press Ctrl+C to stop both instances.\n');

ensureBuilt();

// Launch instances with a small delay between them
for (let i = 0; i < instances.length; i++) {
  launchInstance(instances[i]);
  // Small delay to avoid port conflicts during startup
  if (i < instances.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

console.log('\n[dev-dual] Both instances launched!');
console.log('[dev-dual] - Host window (blue): Create a session');
console.log('[dev-dual] - Participant window (pink): Join the session');
