import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { registerIpcHandlers, cleanupProcesses } from './core/ipc-handlers';
import { runMigrations } from './core/db/migrations';

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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#181a20',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    frame: true,
    ...(isMac && { trafficLightPosition: { x: 12, y: 12 } }),
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

  registerIpcHandlers(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  console.info('[main] Electron app ready; starting initialization');
  try {
    runMigrations();
    createWindow();
  } catch (error) {
    console.error('[main] Failed to initialize application', error);
    dialog.showErrorBox(
      'Flux failed to start',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
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
