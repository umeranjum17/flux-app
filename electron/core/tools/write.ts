import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import path from 'path';
import { getSshHost, sshExec, sshWriteFile } from './ssh';

export async function writeFile(filePath: string, content: string): Promise<void> {
  const host = getSshHost();
  if (host) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir) {
      await sshExec(host, `mkdir -p '${dir.replace(/'/g, "'\\''")}'`);
    }
    const result = await sshWriteFile(host, filePath, content);
    if (!result.success) {
      throw new Error(result.error || `Failed to write remote file: ${filePath}`);
    }
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await fsWriteFile(filePath, content, 'utf-8');
}
