import fg from 'fast-glob';
import { getSshHost, sshExec } from './ssh';

export async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  const host = getSshHost();
  if (host) {
    const escaped = cwd.replace(/'/g, "'\\''");
    // Extract the file name pattern from glob (e.g., "**/*.ts" -> "*.ts")
    const namePattern = pattern.replace(/\*\*\//g, '');
    const result = await sshExec(host, `find '${escaped}' -type f -name '${namePattern}' 2>/dev/null | sort`);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }
  const files = await fg(pattern, { cwd, dot: false });
  return files.sort();
}
