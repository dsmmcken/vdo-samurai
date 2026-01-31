import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';
import { getMediaMockScript } from './media-mock';

let mainWindow: BrowserWindow | null = null;

const isMac = process.platform === 'darwin';
// Check for headless mode (for E2E testing)
const isHeadless = process.env.HEADLESS === 'true' || process.env.E2E_HEADLESS === 'true';
// Check for simulated media mode (for dual-instance testing)
const simulateMedia = process.env.SIMULATE_MEDIA === 'true';
const instanceId = process.env.INSTANCE_ID;

console.log('[main] Environment: SIMULATE_MEDIA=', simulateMedia, 'INSTANCE_ID=', instanceId);

function createWindow(): void {
  // On macOS, use hiddenInset for native traffic lights
  // On Windows/Linux, use frameless window for custom title bar
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    backgroundColor: '#0f0f23',
    show: false
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
  } else {
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Create a minimal menu to enable keyboard shortcuts (like DevTools toggle)
  // On Windows/Linux with frameless window, the menu bar isn't visible anyway
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Show window when ready to prevent visual flash (unless headless)
  mainWindow.once('ready-to-show', () => {
    if (!isHeadless) {
      mainWindow?.show();
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Inject media mocks and profile seeding if SIMULATE_MEDIA is enabled
  if (simulateMedia) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[main] Injecting media mock and profile seed (instanceId:', instanceId, ')');

      // Inject the media mock script (pass instanceId for host/participant video selection)
      mainWindow?.webContents.executeJavaScript(getMediaMockScript(instanceId));

      // Seed the user profile if instanceId is set
      if (instanceId) {
        const profiles: Record<string, { displayName: string; fullName: string }> = {
          host: { displayName: 'Host', fullName: 'Host User' },
          participant: { displayName: 'Participant', fullName: 'Participant User' }
        };
        const profile = profiles[instanceId];
        const isHostInstance = instanceId === 'host';

        if (profile) {
          // Seed localStorage AND update Zustand store to trigger re-render
          const seedScript = `
            (function() {
              const profile = ${JSON.stringify(profile)};
              const isHost = ${isHostInstance};

              // Seed user profile in localStorage
              const userStorageKey = 'vdo-samurai-user';
              const userState = { state: { profile }, version: 0 };
              localStorage.setItem(userStorageKey, JSON.stringify(userState));
              console.log('[SEED] Seeded user profile');

              // Seed last session info so SessionPage knows to create vs join
              const sessionStorageKey = 'vdo-samurai-last-session';
              const lastSession = { roomCode: 'debug?p=debug', wasHost: isHost };
              localStorage.setItem(sessionStorageKey, JSON.stringify(lastSession));
              console.log('[SEED] Seeded last session (wasHost:', isHost, ')');

              // Update Zustand store to trigger re-render (stores are now exposed immediately)
              if (window.useUserStore && window.useUserStore.setState) {
                window.useUserStore.setState({ profile });
                console.log('[SEED] Updated Zustand store with profile:', profile.displayName);
              } else {
                console.error('[SEED] useUserStore not available!');
              }
            })();
          `;
          mainWindow?.webContents.executeJavaScript(seedScript);
        }
      }
    });
  }

  // Load the app
  // For dual-instance testing, auto-join the debug room
  const debugRoom = simulateMedia && instanceId ? '#/session/debug?p=debug' : '';

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(`http://localhost:5173/${debugRoom}`);
    mainWindow.webContents.openDevTools();
  } else {
    // For production, need to use loadURL with file:// to include hash
    if (debugRoom) {
      mainWindow.loadURL(`file://${join(__dirname, '../renderer/index.html')}${debugRoom}`);
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();

    // Window control IPC handlers
    ipcMain.handle('window:minimize', () => {
      mainWindow?.minimize();
    });

    ipcMain.handle('window:maximize', () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow?.maximize();
      }
    });

    ipcMain.handle('window:close', () => {
      mainWindow?.close();
    });

    ipcMain.handle('window:isMaximized', () => {
      return mainWindow?.isMaximized() ?? false;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
