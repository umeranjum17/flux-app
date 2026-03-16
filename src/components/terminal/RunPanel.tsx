import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, ChevronDown, RefreshCw } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspace';
import { useUiStore } from '../../stores/ui';
import { useChatStore } from '../../stores/chat';
import type { WorkspaceScript } from '../../lib/ipc-api';

export function RunPanel() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;

  const activeTask = useChatStore((s) => {
    const id = s.activeTaskId;
    return id ? s.tasks.get(id) : undefined;
  });

  const [scripts, setScripts] = useState<WorkspaceScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [customCommand, setCustomCommand] = useState('');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  // Detect scripts when workspace changes
  useEffect(() => {
    if (!workspace) {
      setScripts([]);
      return;
    }
    window.api.invoke('workspace:detect-scripts', { workspaceId: workspace.id })
      .then((result) => {
        setScripts(result as WorkspaceScript[]);
      })
      .catch(() => setScripts([]));
  }, [workspace?.id]);

  // Listen for run output
  useEffect(() => {
    const cleanupOutput = window.api.on('workspace:run-output', (...args: unknown[]) => {
      const { terminalId, data } = args[0] as { terminalId: string; data: string };
      if (terminalId === activeTerminalId) {
        setOutput((prev) => prev + data);
      }
    });

    const cleanupExit = window.api.on('workspace:run-exit', (...args: unknown[]) => {
      const { terminalId, exitCode } = args[0] as { terminalId: string; exitCode: number };
      if (terminalId === activeTerminalId) {
        setOutput((prev) => prev + `\n\x1b[${exitCode === 0 ? '32' : '31'}m--- Process exited with code ${exitCode} ---\x1b[0m\n`);
        setIsRunning(false);
        setActiveTerminalId(null);
      }
    });

    return () => {
      cleanupOutput();
      cleanupExit();
    };
  }, [activeTerminalId]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleRun = useCallback(async (command: string) => {
    if (!workspace || isRunning) return;

    // Stop previous run
    if (activeTerminalId) {
      await window.api.invoke('workspace:stop-run', { terminalId: activeTerminalId });
    }

    setOutput('');
    setIsRunning(true);

    try {
      const result = await window.api.invoke('workspace:run-command', {
        workspaceId: workspace.id,
        command,
      }) as { terminalId: string };
      setActiveTerminalId(result.terminalId);
    } catch (err: any) {
      setOutput(`Error: ${err.message}\n`);
      setIsRunning(false);
    }
  }, [workspace, isRunning, activeTerminalId]);

  const handleStop = useCallback(async () => {
    if (activeTerminalId) {
      await window.api.invoke('workspace:stop-run', { terminalId: activeTerminalId });
      setIsRunning(false);
      setActiveTerminalId(null);
    }
  }, [activeTerminalId]);

  // No workspace: show task info
  if (!workspace) {
    const cost = activeTask?.costUsd ?? 0;
    const inputTokens = activeTask?.inputTokens ?? 0;
    const outputTokens = activeTask?.outputTokens ?? 0;

    return (
      <div className="p-3 text-xs text-text-secondary space-y-2">
        <div className="flex items-center gap-4">
          <span>Cost: <strong className="text-text-primary">${cost.toFixed(4)}</strong></span>
          <span>Input: <strong className="text-text-primary">{formatTokens(inputTokens)}</strong></span>
          <span>Output: <strong className="text-text-primary">{formatTokens(outputTokens)}</strong></span>
        </div>
        {activeTask?.status && (
          <div>Status: <strong className="text-text-primary">{activeTask.status}</strong></div>
        )}
        {!activeTask && (
          <div className="text-text-tertiary">No active task</div>
        )}
      </div>
    );
  }

  // Workspace active: show run controls
  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary">
        {scripts.length > 0 && (
          <select
            value={selectedScript ?? ''}
            onChange={(e) => {
              setSelectedScript(e.target.value || null);
              if (e.target.value) setCustomCommand(e.target.value);
            }}
            className="text-xs bg-bg-primary border border-border rounded px-2 py-1 text-text-primary max-w-[200px]"
          >
            <option value="">Select script...</option>
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
        {isRunning ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-error/20 text-error hover:bg-error/30 transition-colors"
          >
            <Square size={10} />
            Stop
          </button>
        ) : (
          <button
            onClick={() => customCommand.trim() && handleRun(customCommand.trim())}
            disabled={!customCommand.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-success/20 text-success hover:bg-success/30 disabled:opacity-40 transition-colors"
          >
            <Play size={10} />
            Run
          </button>
        )}
      </div>

      {/* Output area */}
      <pre
        ref={outputRef}
        className="flex-1 overflow-auto p-3 text-[11px] leading-relaxed font-mono text-text-secondary bg-bg-primary whitespace-pre-wrap"
      >
        {output || (
          <span className="text-text-tertiary">
            {scripts.length > 0
              ? 'Select a script or enter a command to run in the workspace'
              : 'Enter a command to run in the workspace'}
          </span>
        )}
      </pre>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
