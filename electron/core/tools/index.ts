export { executeBash } from './bash';
export { readFile } from './read';
export { writeFile } from './write';
export { editFile } from './edit';
export { globFiles } from './glob';
export { grepFiles } from './grep';

import { executeBash } from './bash';
import { readFile } from './read';
import { writeFile } from './write';
import { editFile } from './edit';
import { globFiles } from './glob';
import { grepFiles } from './grep';

export const toolRegistry: Record<string, Function> = {
  bash: executeBash,
  read: readFile,
  write: writeFile,
  edit: editFile,
  glob: globFiles,
  grep: grepFiles,
};
