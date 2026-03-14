import { Files, Search, TerminalSquare, FolderOpen } from 'lucide-react';
import { useUiStore } from '../../stores/ui';

export function ActivityBar() {
  const explorerOpen = useUiStore((s) => s.explorerOpen);
  const terminalOpen = useUiStore((s) => s.terminalOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const cwd = useUiStore((s) => s.cwd);

  const handleOpenFolder = async () => {
    const picked = await window.api.invoke('cwd:pick') as string | null;
    if (picked) {
      useUiStore.getState().setCwd(picked);
      useUiStore.getState().setExplorerOpen(true);
    }
  };

  const handleSearch = () => {
    useUiStore.getState().setSidebarTab('search');
    useUiStore.getState().setSidebarOpen(true);
  };

  return (
    <div className="chrome-sidebar flex h-full w-[44px] min-w-[44px] flex-col items-center border-r border-border/70 px-1.5 py-3">
      <div className="flex flex-col items-center gap-1.5">
        <ActivityIcon
          icon={<Files size={18} />}
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
          icon={<FolderOpen size={18} />}
          label="Open Folder"
          onClick={handleOpenFolder}
        />

        <ActivityIcon
          icon={<Search size={18} />}
          label="Search"
          active={sidebarOpen && sidebarTab === 'search'}
          onClick={handleSearch}
        />
      </div>

      <div className="flex-1" />

      <ActivityIcon
        icon={<TerminalSquare size={18} />}
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      onClick={onClick}
      title={title}
      className={`chrome-rail-button ${active ? 'chrome-rail-button-active' : ''}`}
    >
      {active && (
        <div className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
      {icon}
    </button>
  );
}
