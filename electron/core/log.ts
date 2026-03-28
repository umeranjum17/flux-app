import chalk from 'chalk';

const TAG_WIDTH = 22;

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return chalk.gray(`${hh}:${mm}:${ss}.${ms}`);
}

function padTag(tag: string): string {
  return tag.padEnd(TAG_WIDTH);
}

/** Colored console logger for the main process. */
export const log = {
  /** Informational — cyan tag with ● symbol */
  info(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${timestamp()} ${chalk.cyan('●')} ${chalk.cyan.bold(padTag(tag))} ${msg}`, ...args);
  },
  /** Success / positive transition — green tag with ✔ symbol */
  ok(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${timestamp()} ${chalk.green('✔')} ${chalk.green.bold(padTag(tag))} ${msg}`, ...args);
  },
  /** Warning — yellow tag with ⚠ symbol */
  warn(tag: string, msg: string, ...args: unknown[]) {
    console.warn(`${timestamp()} ${chalk.yellow('⚠')} ${chalk.yellow.bold(padTag(tag))} ${chalk.yellow(msg)}`, ...args);
  },
  /** Error — red tag with ✖ symbol */
  error(tag: string, msg: string, ...args: unknown[]) {
    console.error(`${timestamp()} ${chalk.red('✖')} ${chalk.red.bold(padTag(tag))} ${chalk.red(msg)}`, ...args);
  },
  /** Dim / noisy / verbose — gray tag with · symbol */
  dim(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${timestamp()} ${chalk.gray('·')} ${chalk.gray(padTag(tag))} ${chalk.gray(msg)}`, ...args);
  },
};
