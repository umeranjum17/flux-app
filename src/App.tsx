import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { AgentSelector } from './components/dialogs/AgentSelector';
import { CommandPalette } from './components/dialogs/CommandPalette';
import { SettingsPanel } from './components/dialogs/SettingsPanel';
import { SessionPicker } from './components/dialogs/SessionPicker';
import { SshConnectDialog } from './components/dialogs/SshConnectDialog';
import { RemoteFolderPicker } from './components/dialogs/RemoteFolderPicker';
import { ContextSettings } from './components/dialogs/ContextSettings';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
      <AgentSelector />
      <CommandPalette />
      <SettingsPanel />
      <SessionPicker />
      <SshConnectDialog />
      <RemoteFolderPicker />
      <ContextSettings />
      <Toaster position="top-right" theme="dark" />
    </ErrorBoundary>
  );
}
