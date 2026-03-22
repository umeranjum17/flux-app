import { writeFile as fsWriteFile, mkdir } from 'fs/promises';
import path from 'path';
import { RemoteConnectionManager } from '../remote/connection-manager';

export async function writeFile(filePath: string, content: string): Promise<void> {
  const remote = RemoteConnectionManager.current;
  if (remote?.host) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir) {
      await remote.exec(`mkdir -p '${dir.replace(/'/g, "'\\''")}'`);
    }
    const result = await remote.writeFile(filePath, content);
    if (!result.success) {
      throw new Error(result.error || `Failed to write remote file: ${filePath}`);
    }
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await fsWriteFile(filePath, content, 'utf-8');
}
