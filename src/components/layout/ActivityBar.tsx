import { Files, GitBranch, Wifi, WifiOff, TerminalSquare, FolderOpen } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

export function ActivityBar() {
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const terminalOpen = useUiStore((s) => s.terminalOpen);
  const sshConnected = useUiStore((s) => s.sshConnected);
  const sshHost = useUiStore((s) => s.sshHost);
  const gitBranch = useUiStore((s) => s.gitBranch);
  const gitDirty = useUiStore((s) => s.gitDirty);
  const cwd = useUiStore((s) => s.cwd);

  const handleOpenFolder = async () => {
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().setCwd(picked);
      useUiStore.getState().setExplorerOpen(true);
    }
  };

  return (
    <div className="flex flex-col items-center w-12 min-w-[48px] h-full bg-bg-secondary border-r border-border py-2 gap-1">
      {/* Explorer */}
      <ActivityIcon
        icon={<Files size={20} />}
        label="Explorer"
        shortcut="Cmd+E"
        active={explorerOpen}
        onClick={() => {
          if (!cwd) {
            handleOpenFolder();
          } else {
            useUiStore.getState().toggleExplorer();
          }
        }}
      />

      {/* Open Folder */}
      <ActivityIcon
        icon={<FolderOpen size={20} />}
        label="Open Folder"
        onClick={handleOpenFolder}
      />

      {/* Source Control */}
      <div className="relative">
        <ActivityIcon
          icon={<GitBranch size={20} />}
          label={gitBranch ? `${gitBranch}${gitDirty ? ' (modified)' : ''}` : 'Source Control'}
          active={false}
          badge={gitDirty}
        />
      </div>

      {/* SSH Remote */}
      <ActivityIcon
        icon={sshConnected ? <Wifi size={20} /> : <WifiOff size={20} />}
        label={sshConnected ? `SSH: ${sshHost}` : 'SSH Connect'}
        active={sshConnected}
        highlight={sshConnected}
        onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Terminal */}
      <ActivityIcon
        icon={<TerminalSquare size={20} />}
        label="Terminal"
        shortcut="Ctrl+`"
        active={terminalOpen}
        onClick={() => useUiStore.getState().toggleTerminal()}
      />
    </div>
  );
}

function ActivityIcon({
  icon,
  label,
  shortcut,
  active,
  highlight,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  highlight?: boolean;
  badge?: boolean;
  onClick?: () => void;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
        active
          ? 'text-text-primary bg-bg-hover'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-hover'
      } ${highlight ? 'text-accent' : ''}`}
    >
      {/* Active indicator bar */}
      {active && (
        <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent" />
      )}
      {icon}
      {/* Badge dot */}
      {badge && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-warning border border-bg-secondary" />
      )}
    </button>
  );
}
