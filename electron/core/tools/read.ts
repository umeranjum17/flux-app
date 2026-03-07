import { readFile as fsReadFile } from 'fs/promises';
import { getSshHost, sshExec } from './ssh';

export async function readFile(filePath: string): Promise<string> {
  const host = getSshHost();
  if (host) {
    const escaped = filePath.replace(/'/g, "'\\''");
    const result = await sshExec(host, `cat '${escaped}'`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to read remote file: ${filePath}`);
    }
    return result.stdout;
  }
  return fsReadFile(filePath, 'utf-8');
}
