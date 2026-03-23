import { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';

const AgentSelector = lazy(() => import('./components/dialogs/AgentSelector').then(m => ({ default: m.AgentSelector })));
const CommandPalette = lazy(() => import('./components/dialogs/CommandPalette').then(m => ({ default: m.CommandPalette })));
const SettingsPanel = lazy(() => import('./components/dialogs/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const SessionPicker = lazy(() => import('./components/dialogs/SessionPicker').then(m => ({ default: m.SessionPicker })));
const SshConnectDialog = lazy(() => import('./components/dialogs/SshConnectDialog').then(m => ({ default: m.SshConnectDialog })));
const RemoteFolderPicker = lazy(() => import('./components/dialogs/RemoteFolderPicker').then(m => ({ default: m.RemoteFolderPicker })));
const ContextSettings = lazy(() => import('./components/dialogs/ContextSettings').then(m => ({ default: m.ContextSettings })));
const CreateFolderDialog = lazy(() => import('./components/dialogs/CreateFolderDialog').then(m => ({ default: m.CreateFolderDialog })));

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
      <Suspense fallback={null}>
        <AgentSelector />
        <CommandPalette />
        <SettingsPanel />
        <SessionPicker />
        <SshConnectDialog />
        <RemoteFolderPicker />
        <CreateFolderDialog />
        <ContextSettings />
      </Suspense>
      <Toaster position="top-right" theme="dark" />
    </ErrorBoundary>
  );
}
