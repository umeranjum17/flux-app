import { useState, useEffect, useCallback } from 'react';
import { Play } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import type { WorkspaceScript } from '../../lib/ipc-api';
import type { TerminalPanelHandle } from './TerminalPanel';

interface RunPanelProps {
  terminalRef: React.RefObject<TerminalPanelHandle | null>;
}

export function RunPanel({ terminalRef }: RunPanelProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  const [scripts, setScripts] = useState<WorkspaceScript[]>([]);
  const [customCommand, setCustomCommand] = useState('');

  // Detect scripts when workspace changes
  useEffect(() => {
    if (!workspace) {
      setScripts([]);
      return;
    }
    window.api.invoke('workspace:detect-scripts', { workspaceId: workspace.id })
      .then((result) => setScripts(result as WorkspaceScript[]))
      .catch(() => setScripts([]));
  }, [workspace?.id]);

  const handleRun = useCallback((command: string) => {
    if (!workspace || !terminalRef.current) return;
    const label = command.length > 30 ? command.slice(0, 30) + '…' : command;
    terminalRef.current.openRunTerminal(workspace.id, command, label);
    setCustomCommand('');
  }, [workspace, terminalRef]);

  if (!workspace) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary">
      {scripts.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) handleRun(e.target.value);
            e.target.value = '';
          }}
          className="text-xs bg-bg-primary border border-border rounded px-2 py-1 text-text-primary max-w-[200px]"
          defaultValue=""
        >
          <option value="">Run script...</option>
          {scripts.map((s) => (
            <option key={s.name} value={s.command}>
              {s.name} ({s.source})
            </option>
          ))}
        </select>
      )}
      <input
        value={customCommand}
        onChange={(e) => setCustomCommand(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && customCommand.trim()) {
            handleRun(customCommand.trim());
          }
        }}
        placeholder="Run command..."
        className="flex-1 text-xs bg-bg-primary border border-border rounded px-2 py-1 text-text-primary font-mono"
      />
      <button
        onClick={() => customCommand.trim() && handleRun(customCommand.trim())}
        disabled={!customCommand.trim()}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-success/20 text-success hover:bg-success/30 disabled:opacity-40 transition-colors"
      >
        <Play size={10} />
        Run
      </button>
    </div>
  );
}
