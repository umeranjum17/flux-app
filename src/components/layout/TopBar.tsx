import { Menu, Settings, ChevronDown, LayoutGrid, ClipboardList, Zap, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';

const isMac = window.api?.platform === 'darwin';

export function TopBar() {
  const mode = useUiStore((s) => s.mode);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setMode = useUiStore((s) => s.setMode);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const autoApprove = useUiStore((s) => s.autoApprove);
  const toggleAutoApprove = useUiStore((s) => s.toggleAutoApprove);
  const dashboardOpen = useWorkspaceStore((s) => s.dashboardOpen);
  const setDashboardOpen = useWorkspaceStore((s) => s.setDashboardOpen);

  const projectName = useUiStore((s) => s.projectName);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);

  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const agentDisplayName = selectedAgent?.name ?? selectedAgentId;

  const titleText = projectName || 'Flux';

  return (
    <div
      className={`drag-region flex items-center justify-between h-[38px] min-h-[38px] bg-bg-secondary border-b border-border-subtle px-3 ${isMac ? 'pl-[72px]' : ''}`}
    >
      {/* Left: hamburger + title */}
      <div className="no-drag flex items-center gap-2.5">
        <button
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <span className="text-[13px] font-semibold text-text-primary select-none">
          {titleText}
        </span>
        {sshConnected && sshHost && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-accent/15 text-accent font-medium select-none">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1">
        {/* Plan / Act toggle */}
        <div className="flex items-center rounded-md bg-bg-primary/60 text-[11px] font-medium overflow-hidden border border-border-subtle">
          <button
            onClick={() => setMode('plan')}
            className={`flex items-center gap-1.5 px-2.5 py-[3px] transition-all ${
              mode === 'plan'
                ? 'bg-accent text-white'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title="Plan mode (Cmd+Shift+P)"
          >
            <ClipboardList size={12} />
            Plan
          </button>
          <button
            onClick={() => setMode('act')}
            className={`flex items-center gap-1.5 px-2.5 py-[3px] transition-all ${
              mode === 'act'
                ? 'bg-success text-white'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title="Act mode (Cmd+Shift+P)"
          >
            <Zap size={12} />
            Act
          </button>
        </div>

        {/* Auto-approve toggle */}
        <button
          onClick={toggleAutoApprove}
          className={`p-1.5 rounded-md transition-colors ${
            autoApprove
              ? 'bg-success/15 text-success hover:bg-success/25'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={15} /> : <ShieldOff size={15} />}
        </button>

        {/* Agent selector */}
        <button
          onClick={() => setOverlay('agent-selector')}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <span className="truncate max-w-[90px] font-medium">{agentDisplayName}</span>
          {selectedModel && (
            <span className="text-text-tertiary">{selectedModel}</span>
          )}
          <ChevronDown size={11} className="text-text-tertiary" />
        </button>

        <div className="w-px h-4 bg-border-subtle mx-0.5" />

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`p-1.5 rounded transition-colors ${
            dashboardOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="p-1.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
