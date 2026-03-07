import fs from 'fs';
import readline from 'readline';
import fg from 'fast-glob';
import { getSshHost, sshExec } from './ssh';

export async function grepFiles(
  pattern: string,
  cwd: string,
  glob: string = '**/*'
): Promise<Array<{ file: string; line: number; content: string }>> {
  const host = getSshHost();
  if (host) {
    const escaped = cwd.replace(/'/g, "'\\''");
    const includeArg = glob !== '**/*'
      ? `--include='${glob.replace(/\*\*\//g, '')}'`
      : '';
    const result = await sshExec(
      host,
      `grep -rn ${includeArg} '${pattern}' '${escaped}' 2>/dev/null || true`,
    );
    if (!result.stdout.trim()) return [];

    return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const i1 = line.indexOf(':');
      const i2 = line.indexOf(':', i1 + 1);
      const file = line.substring(0, i1);
      const lineNum = parseInt(line.substring(i1 + 1, i2), 10);
      const content = line.substring(i2 + 1);
      const relFile = file.startsWith(cwd + '/') ? file.substring(cwd.length + 1) : file;
      return { file: relFile, line: lineNum, content };
    });
  }

  const regex = new RegExp(pattern);
  const files = await fg(glob, { cwd, dot: false, onlyFiles: true });
  const results: Array<{ file: string; line: number; content: string }> = [];

  for (const file of files.sort()) {
    const fullPath = `${cwd}/${file}`;

    try {
      const stream = fs.createReadStream(fullPath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let lineNumber = 0;
      for await (const line of rl) {
        lineNumber++;
        if (regex.test(line)) {
          results.push({ file, line: lineNumber, content: line });
        }
      }
    } catch {
      // Skip files that can't be read (binary, permission errors, etc.)
    }
  }

  return results;
}
