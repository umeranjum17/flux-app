import {
  File,
  FileCode2,
  FileJson2,
  FileText,
  FileType2,
  Image,
  Terminal,
  Settings,
  Lock,
  Package,
  Database,
  Globe,
  Braces,
  Hash,
  BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FileIconInfo {
  icon: LucideIcon;
  color: string;
}

const EXT_MAP: Record<string, FileIconInfo> = {
  // TypeScript / JavaScript
  '.ts': { icon: FileCode2, color: '#3178c6' },
  '.tsx': { icon: FileCode2, color: '#3178c6' },
  '.js': { icon: FileCode2, color: '#f0db4f' },
  '.jsx': { icon: FileCode2, color: '#61dafb' },
  '.mjs': { icon: FileCode2, color: '#f0db4f' },
  '.cjs': { icon: FileCode2, color: '#f0db4f' },

  // Web
  '.html': { icon: Globe, color: '#e44d26' },
  '.htm': { icon: Globe, color: '#e44d26' },
  '.css': { icon: FileCode2, color: '#563d7c' },
  '.scss': { icon: FileCode2, color: '#c6538c' },
  '.less': { icon: FileCode2, color: '#1d365d' },
  '.svg': { icon: Image, color: '#ffb13b' },

  // Data / Config
  '.json': { icon: FileJson2, color: '#cbcb41' },
  '.yaml': { icon: Settings, color: '#cb171e' },
  '.yml': { icon: Settings, color: '#cb171e' },
  '.toml': { icon: Settings, color: '#9c4121' },
  '.ini': { icon: Settings, color: '#6d8086' },
  '.env': { icon: Lock, color: '#ecd53f' },
  '.xml': { icon: FileCode2, color: '#e37933' },

  // Markdown / Docs
  '.md': { icon: BookOpen, color: '#519aba' },
  '.mdx': { icon: BookOpen, color: '#519aba' },
  '.txt': { icon: FileText, color: '#89a1b0' },
  '.rst': { icon: FileText, color: '#89a1b0' },

  // Shell
  '.sh': { icon: Terminal, color: '#4eaa25' },
  '.bash': { icon: Terminal, color: '#4eaa25' },
  '.zsh': { icon: Terminal, color: '#4eaa25' },
  '.fish': { icon: Terminal, color: '#4eaa25' },
  '.bat': { icon: Terminal, color: '#c1f12e' },
  '.cmd': { icon: Terminal, color: '#c1f12e' },
  '.ps1': { icon: Terminal, color: '#012456' },

  // Python
  '.py': { icon: FileCode2, color: '#3572a5' },
  '.pyx': { icon: FileCode2, color: '#3572a5' },

  // Rust / Go / C
  '.rs': { icon: FileCode2, color: '#dea584' },
  '.go': { icon: FileCode2, color: '#00add8' },
  '.c': { icon: FileCode2, color: '#555555' },
  '.h': { icon: FileCode2, color: '#555555' },
  '.cpp': { icon: FileCode2, color: '#f34b7d' },
  '.hpp': { icon: FileCode2, color: '#f34b7d' },

  // Java / Kotlin
  '.java': { icon: FileCode2, color: '#b07219' },
  '.kt': { icon: FileCode2, color: '#a97bff' },

  // Ruby / PHP
  '.rb': { icon: FileCode2, color: '#cc342d' },
  '.php': { icon: FileCode2, color: '#4f5d95' },

  // Images
  '.png': { icon: Image, color: '#a074c4' },
  '.jpg': { icon: Image, color: '#a074c4' },
  '.jpeg': { icon: Image, color: '#a074c4' },
  '.gif': { icon: Image, color: '#a074c4' },
  '.webp': { icon: Image, color: '#a074c4' },
  '.ico': { icon: Image, color: '#a074c4' },

  // Database
  '.sql': { icon: Database, color: '#dad8d8' },
  '.sqlite': { icon: Database, color: '#dad8d8' },
  '.db': { icon: Database, color: '#dad8d8' },

  // Package / Lock
  '.lock': { icon: Lock, color: '#6d8086' },

  // Fonts
  '.woff': { icon: FileType2, color: '#6d8086' },
  '.woff2': { icon: FileType2, color: '#6d8086' },
  '.ttf': { icon: FileType2, color: '#6d8086' },
  '.otf': { icon: FileType2, color: '#6d8086' },
};

const NAME_MAP: Record<string, FileIconInfo> = {
  '.gitignore': { icon: Settings, color: '#f54d27' },
  '.gitattributes': { icon: Settings, color: '#f54d27' },
  '.gitmodules': { icon: Settings, color: '#f54d27' },
  '.npmrc': { icon: Settings, color: '#cb3837' },
  '.nvmrc': { icon: Settings, color: '#4eaa25' },
  '.editorconfig': { icon: Settings, color: '#6d8086' },
  '.prettierrc': { icon: Settings, color: '#56b3b4' },
  '.eslintrc': { icon: Settings, color: '#4b32c3' },
  'dockerfile': { icon: Package, color: '#2496ed' },
  'docker-compose.yml': { icon: Package, color: '#2496ed' },
  'docker-compose.yaml': { icon: Package, color: '#2496ed' },
  'package.json': { icon: Package, color: '#cb3837' },
  'package-lock.json': { icon: Lock, color: '#cb3837' },
  'yarn.lock': { icon: Lock, color: '#2c8ebb' },
  'pnpm-lock.yaml': { icon: Lock, color: '#f69220' },
  'tsconfig.json': { icon: Braces, color: '#3178c6' },
  'vite.config.ts': { icon: Settings, color: '#646cff' },
  'vite.config.js': { icon: Settings, color: '#646cff' },
  'tailwind.config.ts': { icon: Settings, color: '#38bdf8' },
  'tailwind.config.js': { icon: Settings, color: '#38bdf8' },
  'makefile': { icon: Hash, color: '#6d8086' },
  'license': { icon: FileText, color: '#d4aa00' },
  'readme.md': { icon: BookOpen, color: '#519aba' },
  'changelog.md': { icon: BookOpen, color: '#519aba' },
};

export function getFileIcon(filename: string): FileIconInfo {
  const lower = filename.toLowerCase();

  // Check exact filename match first
  if (NAME_MAP[lower]) return NAME_MAP[lower];

  // Check extension
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx);
    if (EXT_MAP[ext]) return EXT_MAP[ext];
  }

  return { icon: File, color: 'var(--color-text-tertiary)' };
}
