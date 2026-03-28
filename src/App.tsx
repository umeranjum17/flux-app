import { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';

const AgentSelector = lazy(() => import('./components/dialogs/AgentSelector').then(m => ({ default: m.AgentSelector })));
const CommandPalette = lazy(() => import('./components/dialogs/CommandPalette').then(m => ({ default: m.CommandPalette })));
const SettingsPanel = lazy(() => import('./components/dialogs/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const SessionPicker = lazy(() => import('./components/dialogs/SessionPicker').then(m => ({ default: m.SessionPicker })));
const ConnectRemoteDialog = lazy(() => import('./components/dialogs/ConnectRemoteDialog').then(m => ({ default: m.ConnectRemoteDialog })));
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
        <ConnectRemoteDialog />
        <CreateFolderDialog />
      </Suspense>
      <Toaster position="top-right" theme="dark" />
    </ErrorBoundary>
  );
}
