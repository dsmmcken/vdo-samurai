import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;

const isMac = process.platform === 'darwin';
// Check for headless mode (for E2E testing)
const isHeadless = process.env.HEADLESS === 'true' || process.env.E2E_HEADLESS === 'true';

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

  // Hide menu on Windows/Linux for cleaner look (no File/Edit/View)
  if (!isMac) {
    Menu.setApplicationMenu(null);
  }

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

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
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
