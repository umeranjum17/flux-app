import chalk from 'chalk';

/** Colored console logger for the main process. */
export const log = {
  /** Informational — cyan tag */
  info(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${chalk.cyan(`[${tag}]`)} ${msg}`, ...args);
  },
  /** Success / positive transition — green tag */
  ok(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${chalk.green(`[${tag}]`)} ${msg}`, ...args);
  },
  /** Warning — yellow tag */
  warn(tag: string, msg: string, ...args: unknown[]) {
    console.warn(`${chalk.yellow(`[${tag}]`)} ${msg}`, ...args);
  },
  /** Error — red tag */
  error(tag: string, msg: string, ...args: unknown[]) {
    console.error(`${chalk.red(`[${tag}]`)} ${msg}`, ...args);
  },
  /** Dim / noisy / verbose — gray tag */
  dim(tag: string, msg: string, ...args: unknown[]) {
    console.log(`${chalk.gray(`[${tag}]`)} ${chalk.gray(msg)}`, ...args);
  },
};
