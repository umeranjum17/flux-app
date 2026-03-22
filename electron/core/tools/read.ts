import { readFile as fsReadFile } from 'fs/promises';
import { RemoteConnectionManager } from '../remote/connection-manager';

export async function readFile(filePath: string): Promise<string> {
  const remote = RemoteConnectionManager.current;
  if (remote?.host) {
    const escaped = filePath.replace(/'/g, "'\\''");
    const result = await remote.exec(`cat '${escaped}'`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to read remote file: ${filePath}`);
    }
    return result.stdout;
  }
  return fsReadFile(filePath, 'utf-8');
}
