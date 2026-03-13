import { Menu, Settings, ChevronDown, LayoutGrid, ClipboardList, Zap, ShieldCheck, ShieldOff } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';

const isMac = window.api?.platform === 'darwin';
const isWin = window.api?.platform === 'win32';

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
  const environment = useUiStore((s) => s.environment);

  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectedModel = useAgentStore((s) => s.selectedModel);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const agentDisplayName = selectedAgent?.name ?? selectedAgentId;

  const titleText = projectName || 'Flux';

  return (
    <div
      className={`drag-region flex items-center justify-between h-[40px] min-h-[40px] bg-bg-secondary border-b border-border px-3 ${isMac ? 'pl-[72px]' : ''} ${isWin ? 'pr-[140px]' : ''}`}
    >
      {/* Left: hamburger + title */}
      <div className="no-drag flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
        <span className="text-[13px] font-semibold text-text-primary select-none tracking-[-0.01em]">
          {titleText}
        </span>
        {environment === 'wsl' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/12 text-blue-400 font-medium select-none leading-none">
            WSL
          </span>
        )}
        {environment === 'ssh' && !sshConnected && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/12 text-purple-400 font-medium select-none leading-none">
            SSH Session
          </span>
        )}
        {sshConnected && sshHost && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/12 text-accent font-medium select-none leading-none">
            SSH:{sshHost}
          </span>
        )}
      </div>

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1.5 min-w-0 overflow-hidden">
        {/* Plan / Act segmented toggle */}
        <div className="flex items-center rounded-lg bg-bg-primary/80 text-[11px] font-medium border border-border-subtle p-[2px]">
          <button
            onClick={() => setMode('plan')}
            className={`flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] transition-all duration-150 ${
              mode === 'plan'
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title={`Plan mode (${isMac ? 'Cmd' : 'Ctrl'}+Shift+P)`}
          >
            <ClipboardList size={11} strokeWidth={2.2} />
            Plan
          </button>
          <button
            onClick={() => setMode('act')}
            className={`flex items-center gap-1.5 px-3 py-[5px] rounded-[6px] transition-all duration-150 ${
              mode === 'act'
                ? 'bg-success text-white shadow-sm'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            title={`Act mode (${isMac ? 'Cmd' : 'Ctrl'}+Shift+P)`}
          >
            <Zap size={11} strokeWidth={2.2} />
            Act
          </button>
        </div>

        {/* Auto-approve toggle */}
        <button
          onClick={toggleAutoApprove}
          className={`flex items-center gap-1 px-2 py-[5px] rounded-lg text-[11px] font-medium transition-all duration-150 ${
            autoApprove
              ? 'bg-success/12 text-success hover:bg-success/20'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label={autoApprove ? 'Auto-approve on' : 'Auto-approve off'}
          title={autoApprove ? 'Auto-approve: ON (click to disable)' : 'Auto-approve: OFF (click to enable)'}
        >
          {autoApprove ? <ShieldCheck size={13} strokeWidth={2} /> : <ShieldOff size={13} strokeWidth={2} />}
          <span className="hidden sm:inline">{autoApprove ? 'Auto' : ''}</span>
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        {/* Agent selector */}
        <button
          onClick={() => setOverlay('agent-selector')}
          className="flex items-center gap-1.5 px-2 py-[5px] rounded-lg text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <span className="truncate max-w-[80px] font-medium">{agentDisplayName}</span>
          {selectedModel && (
            <span className="text-text-tertiary truncate max-w-[100px]">{selectedModel}</span>
          )}
          <ChevronDown size={10} className="text-text-tertiary shrink-0" />
        </button>

        <div className="w-px h-4 bg-border mx-0.5" />

        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          className={`p-1.5 rounded-lg transition-colors ${
            dashboardOpen
              ? 'bg-accent/12 text-accent'
              : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
          }`}
          aria-label="Toggle workspaces"
          title="Workspaces"
        >
          <LayoutGrid size={14} />
        </button>

        <button
          onClick={() => setOverlay('settings')}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-tertiary hover:text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
