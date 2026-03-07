import { createHighlighter } from 'shiki';

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

export async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark-default'],
      langs: [
        'typescript',
        'javascript',
        'python',
        'rust',
        'go',
        'bash',
        'json',
        'yaml',
        'css',
        'html',
        'markdown',
        'sql',
        'tsx',
        'jsx',
      ],
    });
  }
  return highlighterPromise;
}
