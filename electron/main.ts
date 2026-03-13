import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpcHandlers, cleanupProcesses } from './core/ipc-handlers';
import { runMigrations } from './core/db/migrations';
import { ConfigManager } from './core/config/config';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const configManager = new ConfigManager();
  const config = configManager.get();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#181a20',
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    frame: true,
    ...(isMac && { trafficLightPosition: { x: 12, y: 12 } }),
    ...(isWin && {
      titleBarOverlay: {
        color: '#14161b',
        symbolColor: '#8b8fa3',
        height: 38,
      },
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Apply persisted zoom level
  const zoomLevel = config.zoomLevel ?? 1.0;
  if (zoomLevel !== 1.0) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.setZoomFactor(zoomLevel);
    });
  }

  registerIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  console.info('[main] Electron app ready; starting initialization');
  runMigrations();
  createWindow();
});

app.on('before-quit', () => {
  cleanupProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
