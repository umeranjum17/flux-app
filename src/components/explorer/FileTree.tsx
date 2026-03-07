import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

interface FileTreeProps {
  nodes: TreeNode[];
  depth?: number;
  onFileSelect?: (path: string) => void;
  onFileDoubleClick?: (path: string) => void;
}

export function FileTree({ nodes, depth = 0, onFileSelect, onFileDoubleClick }: FileTreeProps) {
  return (
    <div>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={depth}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
        />
      ))}
    </div>
  );
}

function FileTreeItem({
  node,
  depth,
  onFileSelect,
  onFileDoubleClick,
}: {
  node: TreeNode;
  depth: number;
  onFileSelect?: (path: string) => void;
  onFileDoubleClick?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [children, setChildren] = useState<TreeNode[] | undefined>(node.children);
  const [loading, setLoading] = useState(false);

  const handleToggle = useCallback(async () => {
    if (!node.isDirectory) {
      onFileSelect?.(node.path);
      return;
    }

    if (!expanded && !children?.length) {
      setLoading(true);
      try {
        const result = await window.api.invoke('fs:readdir', { dirPath: node.path, depth: 2 }) as TreeNode[];
        setChildren(result);
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }

    setExpanded(!expanded);
  }, [expanded, children, node, onFileSelect]);

  const paddingLeft = depth * 16 + 8;

  return (
    <div>
      <button
        onClick={handleToggle}
        onDoubleClick={() => { if (!node.isDirectory) onFileDoubleClick?.(node.path); }}
        className="w-full flex items-center gap-1.5 py-0.5 pr-2 text-xs hover:bg-bg-hover transition-colors text-left"
        style={{ paddingLeft }}
      >
        {node.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown size={12} className="text-text-tertiary shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-text-tertiary shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={14} className="text-accent shrink-0" />
            ) : (
              <Folder size={14} className="text-accent shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <File size={14} className="text-text-tertiary shrink-0" />
          </>
        )}
        <span className="truncate text-text-secondary">{node.name}</span>
        {loading && (
          <span className="text-[10px] text-text-tertiary ml-auto">...</span>
        )}
      </button>
      {expanded && children && children.length > 0 && (
        <FileTree nodes={children} depth={depth + 1} onFileSelect={onFileSelect} onFileDoubleClick={onFileDoubleClick} />
      )}
    </div>
  );
}
