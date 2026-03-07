import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { AgentSelector } from './components/dialogs/AgentSelector';
import { CommandPalette } from './components/dialogs/CommandPalette';
import { SettingsPanel } from './components/dialogs/SettingsPanel';
import { SessionPicker } from './components/dialogs/SessionPicker';
import { SshConnectDialog } from './components/dialogs/SshConnectDialog';
import { RemoteFolderPicker } from './components/dialogs/RemoteFolderPicker';

export function App() {
  return (
    <>
      <AppShell />
      <AgentSelector />
      <CommandPalette />
      <SettingsPanel />
      <SessionPicker />
      <SshConnectDialog />
      <RemoteFolderPicker />
      <Toaster position="top-right" theme="dark" />
    </>
  );
}
