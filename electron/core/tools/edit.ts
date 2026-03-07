import { readFile } from './read';
import { writeFile } from './write';

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string
): Promise<{ success: boolean; error?: string }> {
  let content: string;
  try {
    content = await readFile(filePath);
  } catch (err) {
    return { success: false, error: `Failed to read file: ${(err as Error).message}` };
  }

  const occurrences = content.split(oldString).length - 1;

  if (occurrences === 0) {
    return { success: false, error: 'oldString not found in file' };
  }

  if (occurrences > 1) {
    return {
      success: false,
      error: `oldString found ${occurrences} times — must be unique (found ${occurrences} occurrences)`,
    };
  }

  const updated = content.replace(oldString, newString);
  await writeFile(filePath, updated);

  return { success: true };
}
