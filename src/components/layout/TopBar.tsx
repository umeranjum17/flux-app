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
      className={`drag-region flex items-center justify-between h-10 min-h-[40px] bg-bg-secondary border-b border-border/30 px-3 ${isMac ? 'pl-[70px]' : ''}`}
    >
      {/* Left: hamburger */}
      <div className="no-drag flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
      </div>

      {/* Center: title + environment */}
      <div className="flex items-center gap-2 select-none">
        <span className="text-sm font-semibold text-text-primary">
          {titleText}
        </span>
        {sshConnected && sshHost && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1.5">
        {/* Plan / Act toggle */}
        <div className="flex items-center rounded-lg bg-bg-elevated/60 text-xs font-medium overflow-hidden border border-border/20">
          <button
            onClick={() => setMode('plan')}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150 ${
              mode === 'plan'
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover/50'
            }`}
            title="Plan mode (Cmd+Shift+P)"
          >
            <ClipboardList size={12} />
            Plan
          </button>
          <button
            onClick={() => setMode('act')}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150 ${
              mode === 'act'
                ? 'bg-success text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover/50'
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
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <span className="truncate max-w-[100px]">{agentDisplayName}</span>
          {selectedModel && (
            <span className="text-text-tertiary font-normal">{selectedModel}</span>
          )}
          <ChevronDown size={12} />
        </button>

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`p-1.5 rounded-md transition-colors ${
            dashboardOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-secondary hover:bg-bg-hover'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={16} />
        </button>

        {/* Settings */}
        <button
          onClick={() => setOverlay('settings')}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
}
