import { vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    webContents: { send: vi.fn() },
    on: vi.fn(),
    loadURL: vi.fn(),
  })),
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
    exec: vi.fn(),
    execFile: vi.fn(),
  };
});
