const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  htm: 'html',
  css: 'css',
  sql: 'sql',
  md: 'markdown',
  toml: 'toml',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  xml: 'html',
  svg: 'html',
};

const BASENAME_MAP: Record<string, string> = {
  Dockerfile: 'bash',
  Makefile: 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.gitignore': 'bash',
};

export function detectLanguage(filePath: string): string {
  if (!filePath) return 'text';
  const basename = filePath.split('/').pop() ?? '';
  if (BASENAME_MAP[basename]) return BASENAME_MAP[basename];
  const ext = basename.includes('.') ? (basename.split('.').pop() ?? '') : '';
  return EXT_MAP[ext] ?? 'text';
}
