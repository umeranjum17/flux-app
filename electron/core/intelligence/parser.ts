import fs from 'fs';
import path from 'path';
import type { Tag } from './types';
import type TreeSitterModule from 'web-tree-sitter';

// Tree-sitter definition node types per language
const TS_DEF_TYPES = new Set([
  'function_declaration',
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'method_definition',
  'abstract_method_signature',
  'public_field_definition',
]);

const JS_DEF_TYPES = new Set([
  'function_declaration',
  'class_declaration',
  'method_definition',
]);

const PY_DEF_TYPES = new Set([
  'function_definition',
  'class_definition',
]);

// Variable declarators that have a name (named arrow functions, const exports, etc.)
const VARIABLE_DECLARATOR_TYPES = new Set([
  'variable_declarator',
  'lexical_declaration',
]);

interface FileCache {
  mtime: number;
  tags: Tag[];
}

let ParserClass: typeof TreeSitterModule.Parser | null = null;
let LanguageClass: typeof TreeSitterModule.Language | null = null;
let parserInstance: TreeSitterModule.Parser | null = null;
const languageCache = new Map<string, TreeSitterModule.Language>();
const fileTagCache = new Map<string, FileCache>();

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
};

async function initParser(): Promise<TreeSitterModule.Parser> {
  if (parserInstance) return parserInstance;

  const TreeSitter = await import('web-tree-sitter');
  const P = TreeSitter.Parser ?? (TreeSitter as any).default;
  ParserClass = P;
  LanguageClass = TreeSitter.Language ?? (TreeSitter as any).Language;
  await P.init();
  parserInstance = new P();
  return parserInstance;
}

async function getLanguage(langName: string): Promise<TreeSitterModule.Language | null> {
  if (languageCache.has(langName)) return languageCache.get(langName)!;

  if (!ParserClass || !LanguageClass) return null;

  // Look for WASM grammars in multiple locations
  const grammarDirs = [
    path.join(__dirname, 'grammars'),
    path.join(__dirname, '..', 'intelligence', 'grammars'),
    path.join(process.cwd(), 'electron', 'core', 'intelligence', 'grammars'),
  ];

  const wasmName = `tree-sitter-${langName}.wasm`;

  for (const dir of grammarDirs) {
    const wasmPath = path.join(dir, wasmName);
    if (fs.existsSync(wasmPath)) {
      try {
        const lang = await LanguageClass!.load(wasmPath);
        languageCache.set(langName, lang);
        return lang;
      } catch {
        // Try next path
      }
    }
  }

  return null;
}

function getDefTypes(langName: string): Set<string> {
  switch (langName) {
    case 'typescript':
    case 'tsx':
      return TS_DEF_TYPES;
    case 'javascript':
      return JS_DEF_TYPES;
    case 'python':
      return PY_DEF_TYPES;
    default:
      return TS_DEF_TYPES;
  }
}

function extractName(node: TreeSitterModule.Node): string | null {
  // Try direct name child
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  // For variable declarators, the name is the first identifier child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'identifier') return child.text;
  }

  return null;
}

function walkTree(
  node: TreeSitterModule.Node,
  relPath: string,
  absPath: string,
  defTypes: Set<string>,
  tags: Tag[],
  seenDefs: Set<string>,
): void {
  const nodeType = node.type;

  // Check for definitions
  if (defTypes.has(nodeType)) {
    const name = extractName(node);
    if (name && name.length > 1) {
      tags.push({ relPath, absPath, line: node.startPosition.row, name, kind: 'def' });
      seenDefs.add(name);
    }
  }

  // Check for variable declarators with function expressions (named arrow functions)
  if (VARIABLE_DECLARATOR_TYPES.has(nodeType)) {
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');
    if (nameNode && valueNode) {
      const valueType = valueNode.type;
      if (valueType === 'arrow_function' || valueType === 'function' || valueType === 'function_expression') {
        const name = nameNode.text;
        if (name && name.length > 1) {
          tags.push({ relPath, absPath, line: node.startPosition.row, name, kind: 'def' });
          seenDefs.add(name);
        }
      }
    }
  }

  // Check for identifiers as references (collected separately from defs)
  if (nodeType === 'identifier' || nodeType === 'property_identifier' || nodeType === 'type_identifier') {
    const name = node.text;
    if (name && name.length > 1) {
      tags.push({ relPath, absPath, line: node.startPosition.row, name, kind: 'ref' });
    }
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkTree(child, relPath, absPath, defTypes, tags, seenDefs);
    }
  }
}

export async function parseFile(absPath: string, projectRoot: string): Promise<Tag[]> {
  const ext = path.extname(absPath);
  const langName = LANG_MAP[ext];
  if (!langName) return [];

  // Check cache
  let mtime: number;
  try {
    const stat = fs.statSync(absPath);
    mtime = stat.mtimeMs;
  } catch {
    return [];
  }

  const cached = fileTagCache.get(absPath);
  if (cached && cached.mtime === mtime) {
    return cached.tags;
  }

  // Read and parse
  let source: string;
  try {
    source = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  // Limit file size (skip files > 500KB)
  if (source.length > 500_000) return [];

  const parser = await initParser();
  const language = await getLanguage(langName);

  if (!language) {
    // Fallback: regex-based extraction if no WASM grammar available
    return parseFileRegex(absPath, projectRoot, source, mtime);
  }

  parser.setLanguage(language);
  const tree = parser.parse(source);

  if (!tree) {
    return parseFileRegex(absPath, projectRoot, source, mtime);
  }

  const relPath = path.relative(projectRoot, absPath);
  const defTypes = getDefTypes(langName);
  const tags: Tag[] = [];
  const seenDefs = new Set<string>();

  walkTree(tree.rootNode, relPath, absPath, defTypes, tags, seenDefs);

  // Cache result
  fileTagCache.set(absPath, { mtime, tags });

  return tags;
}

// Regex fallback for when tree-sitter WASM grammars are not available
function parseFileRegex(absPath: string, projectRoot: string, source: string, mtime: number): Tag[] {
  const relPath = path.relative(projectRoot, absPath);
  const ext = path.extname(absPath);
  const tags: Tag[] = [];
  const lines = source.split('\n');

  const patterns: RegExp[] = [];

  if (ext === '.py') {
    patterns.push(
      /^(?:async\s+)?def\s+(\w+)/,
      /^class\s+(\w+)/,
    );
  } else {
    // TS/JS patterns
    patterns.push(
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /(?:export\s+)?class\s+(\w+)/,
      /(?:export\s+)?interface\s+(\w+)/,
      /(?:export\s+)?type\s+(\w+)\s*=/,
      /(?:export\s+)?enum\s+(\w+)/,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=])*=>/,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*function/,
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match && match[1] && match[1].length > 1) {
        tags.push({ relPath, absPath, line: i, name: match[1], kind: 'def' });
        break;
      }
    }

    // Extract references: identifiers that look like they reference something
    const refPattern = /\b([A-Z]\w{2,}|[a-z]\w{7,})\b/g;
    let refMatch;
    while ((refMatch = refPattern.exec(line)) !== null) {
      if (refMatch[1]) {
        tags.push({ relPath, absPath, line: i, name: refMatch[1], kind: 'ref' });
      }
    }
  }

  fileTagCache.set(absPath, { mtime, tags });
  return tags;
}

export function invalidateFileCache(absPath: string): void {
  fileTagCache.delete(absPath);
}

export function clearCache(): void {
  fileTagCache.clear();
}

export function getCacheSize(): number {
  return fileTagCache.size;
}
