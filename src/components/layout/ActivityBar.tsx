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
    <div className="chrome-sidebar flex h-full w-[48px] min-w-[48px] flex-col items-center border-r border-border/70 px-2 py-3">
      <div className="mb-3 flex flex-col items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg border border-border/80 bg-bg-primary/80 text-[11px] font-semibold tracking-[0.18em] text-text-primary">
          FX
        </div>
      </div>

      <div className="flex flex-col items-center gap-1.5">
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

        <ActivityIcon
          icon={<FolderOpen size={20} />}
          label="Open Folder"
          onClick={handleOpenFolder}
        />

        <div className="relative">
          <ActivityIcon
            icon={<GitBranch size={20} />}
            label={gitBranch ? `${gitBranch}${gitDirty ? ' (modified)' : ''}` : 'Source Control'}
            active={false}
            badge={gitDirty}
          />
        </div>

        <ActivityIcon
          icon={sshConnected ? <Wifi size={20} /> : <WifiOff size={20} />}
          label={sshConnected ? `SSH: ${sshHost}` : 'SSH Connect'}
          active={sshConnected}
          highlight={sshConnected}
          onClick={() => useUiStore.getState().setOverlay('ssh-connect')}
        />
      </div>

      <div className="flex-1" />

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
      className={`chrome-rail-button ${active ? 'chrome-rail-button-active' : ''} ${highlight && !active ? 'text-accent' : ''}`}
    >
      {active && (
        <div className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
      {icon}
      {badge && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-bg-secondary bg-warning" />
      )}
    </button>
  );
}
