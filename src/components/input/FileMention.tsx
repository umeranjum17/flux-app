import { useState, useEffect, useCallback } from 'react';
import { File, Folder } from 'lucide-react';

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

interface FileMentionProps {
  query: string;
  onSelect: (filePath: string, fileName: string) => void;
  onClose: () => void;
}

export function FileMention({ query, onSelect, onClose }: FileMentionProps) {
  const [results, setResults] = useState<TreeNode[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    async function search() {
      try {
        const tree = await window.api.invoke('fs:readdir', { depth: 3 }) as TreeNode[];
        const flat = flattenTree(tree);
        const lower = query.toLowerCase();
        const matches = flat.filter((n) => n.name.toLowerCase().includes(lower)).slice(0, 10);
        setResults(matches);
        setActiveIndex(0);
      } catch {
        setResults([]);
      }
    }
    search();
  }, [query]);

  const handleKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (results[activeIndex]) {
          e.preventDefault();
          onSelect(results[activeIndex].path, results[activeIndex].name);
        }
      }
    },
    [results, activeIndex, onClose, onSelect],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (results.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-bg-elevated border border-border rounded-xl shadow-xl overflow-hidden z-20">
      <div className="py-1 max-h-60 overflow-y-auto">
        {results.map((node, index) => (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelect(node.path, node.name)}
            onMouseEnter={() => setActiveIndex(index)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
              index === activeIndex ? 'bg-bg-hover text-text-primary' : 'text-text-secondary'
            }`}
          >
            {node.isDirectory ? (
              <Folder size={12} className="text-accent shrink-0" />
            ) : (
              <File size={12} className="text-text-tertiary shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            <span className="text-[10px] text-text-tertiary ml-auto truncate max-w-[200px]">
              {node.path}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}
