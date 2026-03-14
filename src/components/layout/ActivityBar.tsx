import { FolderTree, Search, Terminal, FolderPlus, MessageSquare } from 'lucide-react';
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

  const handleChats = () => {
    useUiStore.getState().setSidebarTab('chat');
    useUiStore.getState().setSidebarOpen(true);
  };

  return (
    <div className="chrome-sidebar flex h-full w-[48px] min-w-[48px] flex-col items-center border-r border-border/70 px-1 py-3">
      <div className="flex flex-col items-center gap-2">
        <ActivityIcon
          icon={<MessageSquare size={20} strokeWidth={1.8} />}
          label="Chats"
          active={sidebarOpen && sidebarTab === 'chat'}
          onClick={handleChats}
        />

        <ActivityIcon
          icon={<FolderTree size={20} strokeWidth={1.8} />}
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
          icon={<FolderPlus size={20} strokeWidth={1.8} />}
          label="Open Folder"
          onClick={handleOpenFolder}
        />

        <ActivityIcon
          icon={<Search size={20} strokeWidth={1.8} />}
          label="Search"
          active={sidebarOpen && sidebarTab === 'search'}
          onClick={handleSearch}
        />
      </div>

      <div className="flex-1" />

      <ActivityIcon
        icon={<Terminal size={20} strokeWidth={1.8} />}
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
        <div className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />
      )}
      {icon}
    </button>
  );
}
