import { vi } from 'vitest';

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

export const BrowserWindow = vi.fn().mockImplementation(() => ({
  webContents: {
    send: vi.fn(),
  },
  on: vi.fn(),
  loadURL: vi.fn(),
}));

export const dialog = {
  showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  showMessageBox: vi.fn(),
};

export const app = {
  getPath: vi.fn().mockReturnValue('/tmp'),
  on: vi.fn(),
  quit: vi.fn(),
  isReady: vi.fn().mockReturnValue(true),
};
