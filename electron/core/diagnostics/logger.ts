import fs from 'fs';
import path from 'path';
import { app } from 'electron';

function getFluxDir(): string {
  const homeDir = app?.getPath('home') ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const fluxDir = path.join(homeDir, '.flux');
  if (!fs.existsSync(fluxDir)) {
    fs.mkdirSync(fluxDir, { recursive: true });
  }
  return fluxDir;
}

export function getDiagnosticsLogPath(): string {
  return path.join(getFluxDir(), 'flux-debug.log');
}

function serialize(data: unknown): string {
  if (data === undefined) return '';
  try {
    return JSON.stringify(data);
  } catch (err) {
    return JSON.stringify({ serializationError: String(err) });
  }
}

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function rotateIfNeeded(logPath: string): void {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size > MAX_LOG_SIZE) {
      fs.renameSync(logPath, logPath + '.1');
    }
  } catch {
    // file may not exist yet — that's fine
  }
}

export function logDiagnostic(scope: string, message: string, data?: unknown): void {
  const logPath = getDiagnosticsLogPath();
  const line = `[${new Date().toISOString()}] ${scope} ${message}${data === undefined ? '' : ` ${serialize(data)}`}\n`;
  try {
    rotateIfNeeded(logPath);
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    // best effort diagnostics only
  }
}

export function tailDiagnostics(lines: number = 200): string {
  try {
    const raw = fs.readFileSync(getDiagnosticsLogPath(), 'utf-8');
    return raw.split('\n').filter(Boolean).slice(-lines).join('\n');
  } catch {
    return '';
  }
}
