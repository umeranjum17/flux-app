import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [
        'typescript', 'javascript', 'python', 'rust', 'go', 'bash',
        'json', 'yaml', 'html', 'css', 'sql', 'markdown', 'tsx', 'jsx',
        'shell', 'diff', 'toml', 'c', 'cpp', 'java', 'ruby', 'php',
      ],
    });
  }
  return highlighterPromise;
}
