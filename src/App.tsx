import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { AgentSelector } from './components/dialogs/AgentSelector';
import { CommandPalette } from './components/dialogs/CommandPalette';
import { SettingsPanel } from './components/dialogs/SettingsPanel';
import { SessionPicker } from './components/dialogs/SessionPicker';
import { ConnectRemoteDialog } from './components/dialogs/ConnectRemoteDialog';
import { ContextSettings } from './components/dialogs/ContextSettings';
import { CreateFolderDialog } from './components/dialogs/CreateFolderDialog';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
      <AgentSelector />
      <CommandPalette />
      <SettingsPanel />
      <SessionPicker />
      <ConnectRemoteDialog />
      <CreateFolderDialog />
      <ContextSettings />
      <Toaster position="top-right" theme="dark" />
    </ErrorBoundary>
  );
}
