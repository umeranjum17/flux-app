import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { getFileIcon } from './fileIcons';

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

  const paddingLeft = depth * 14 + 6;

  return (
    <div>
      <button
        onClick={handleToggle}
        onDoubleClick={() => { if (!node.isDirectory) onFileDoubleClick?.(node.path); }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover/70"
        style={{ paddingLeft }}
      >
        {node.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown size={11} className="shrink-0 text-text-tertiary" />
            ) : (
              <ChevronRight size={11} className="shrink-0 text-text-tertiary" />
            )}
            {expanded ? (
              <FolderOpen size={13} className="shrink-0" style={{ color: 'hsl(42, 70%, 62%)' }} />
            ) : (
              <Folder size={13} className="shrink-0" style={{ color: 'hsl(42, 65%, 55%)' }} />
            )}
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" />
            {(() => {
              const { icon: Icon, color } = getFileIcon(node.name);
              return <Icon size={13} className="shrink-0" style={{ color }} />;
            })()}
          </>
        )}
        <span className="truncate">{node.name}</span>
        {loading && (
          <span className="ml-auto text-[10px] text-text-tertiary">...</span>
        )}
      </button>
      {expanded && children && children.length > 0 && (
        <FileTree nodes={children} depth={depth + 1} onFileSelect={onFileSelect} onFileDoubleClick={onFileDoubleClick} />
      )}
    </div>
  );
}
