import {
  File,
  FileCode,
  FileJson2,
  FileText,
  FileType2,
  Image,
  Terminal,
  Settings,
  Lock,
  Database,
  Globe,
  Braces,
  Hash,
  BookOpen,
  Code2,
  Atom,
  Palette,
  Cog,
  Zap,
  CircuitBoard,
  Coffee,
  Diamond,
  Gem,
  Webhook,
  GitBranch,
  Sparkles,
  ShieldCheck,
  Flame,
  Wind,
  Box,
  PackageOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FileIconInfo {
  icon: LucideIcon;
  color: string;
}

const EXT_MAP: Record<string, FileIconInfo> = {
  // TypeScript / JavaScript
  '.ts': { icon: FileType2, color: '#4e9bda' },
  '.tsx': { icon: FileType2, color: '#4e9bda' },
  '.js': { icon: Braces, color: '#e8d44d' },
  '.jsx': { icon: Atom, color: '#5ec8e5' },
  '.mjs': { icon: Braces, color: '#e8d44d' },
  '.cjs': { icon: Braces, color: '#e8d44d' },

  // Web
  '.html': { icon: Globe, color: '#e44d26' },
  '.htm': { icon: Globe, color: '#e44d26' },
  '.css': { icon: Palette, color: '#6b7fc4' },
  '.scss': { icon: Palette, color: '#c6538c' },
  '.less': { icon: Palette, color: '#4d7ab8' },
  '.svg': { icon: Image, color: '#ffb13b' },

  // Data / Config
  '.json': { icon: FileJson2, color: '#cbcb41' },
  '.yaml': { icon: Settings, color: '#cb171e' },
  '.yml': { icon: Settings, color: '#cb171e' },
  '.toml': { icon: Settings, color: '#9c4121' },
  '.ini': { icon: Settings, color: '#6d8086' },
  '.env': { icon: Lock, color: '#ecd53f' },
  '.xml': { icon: FileCode, color: '#d98040' },

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
  '.bat': { icon: Terminal, color: '#a8c84e' },
  '.cmd': { icon: Terminal, color: '#a8c84e' },
  '.ps1': { icon: Terminal, color: '#5b8bc9' },

  // Python
  '.py': { icon: Code2, color: '#7ba0c9' },
  '.pyx': { icon: Code2, color: '#7ba0c9' },

  // Rust / Go / C
  '.rs': { icon: Cog, color: '#dea584' },
  '.go': { icon: Zap, color: '#5ec4db' },
  '.c': { icon: CircuitBoard, color: '#7a8a94' },
  '.h': { icon: CircuitBoard, color: '#7a8a94' },
  '.cpp': { icon: CircuitBoard, color: '#d97088' },
  '.hpp': { icon: CircuitBoard, color: '#d97088' },

  // Java / Kotlin
  '.java': { icon: Coffee, color: '#c0871e' },
  '.kt': { icon: Diamond, color: '#a97bff' },

  // Ruby / PHP
  '.rb': { icon: Gem, color: '#cc342d' },
  '.php': { icon: Webhook, color: '#7b82b8' },

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
  '.gitignore': { icon: GitBranch, color: '#e8613c' },
  '.gitattributes': { icon: GitBranch, color: '#e8613c' },
  '.gitmodules': { icon: GitBranch, color: '#e8613c' },
  '.npmrc': { icon: Settings, color: '#cb3837' },
  '.nvmrc': { icon: Settings, color: '#4eaa25' },
  '.editorconfig': { icon: Settings, color: '#6d8086' },
  '.prettierrc': { icon: Sparkles, color: '#56b3b4' },
  '.eslintrc': { icon: ShieldCheck, color: '#6b4ec3' },
  'dockerfile': { icon: Box, color: '#4d9ee8' },
  'docker-compose.yml': { icon: Box, color: '#4d9ee8' },
  'docker-compose.yaml': { icon: Box, color: '#4d9ee8' },
  'package.json': { icon: PackageOpen, color: '#cb3837' },
  'package-lock.json': { icon: Lock, color: '#cb3837' },
  'yarn.lock': { icon: Lock, color: '#2c8ebb' },
  'pnpm-lock.yaml': { icon: Lock, color: '#f69220' },
  'tsconfig.json': { icon: Braces, color: '#3178c6' },
  'vite.config.ts': { icon: Flame, color: '#8b7bff' },
  'vite.config.js': { icon: Flame, color: '#8b7bff' },
  'tailwind.config.ts': { icon: Wind, color: '#38bdf8' },
  'tailwind.config.js': { icon: Wind, color: '#38bdf8' },
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
