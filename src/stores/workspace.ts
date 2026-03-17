import '../lib/immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Workspace, WorkspaceOutcome, DiffFile, Checkpoint, WorkspaceSession } from '../lib/ipc-api';
import type { SystemActivity } from '../lib/types';
import { appendSystemActivity } from '../lib/system-activities';

interface WorkspaceState {
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;

  // Multi-chat sessions per workspace
  workspaceSessions: Map<string, WorkspaceSession[]>; // workspaceId → sessions

  // Merge state
  mergingWorkspaceId: string | null;

  // Checkpoint state
  checkpoints: Map<string, Checkpoint[]>;

  // Durable workspace-scoped lifecycle activity
  workspaceActivities: Map<string, SystemActivity[]>;

  // Actions
  setWorkspaces(workspaces: Workspace[]): void;
  mergeWorkspaces(workspaces: Workspace[]): void;
  addWorkspace(ws: Workspace): void;
  updateWorkspace(id: string, updates: Partial<Workspace>): void;
  removeWorkspace(id: string): void;
  setActiveWorkspace(id: string | null): void;
  openMerge(workspaceId: string): void;
  closeMerge(): void;
  // Outcome actions
  setOutcome(id: string, outcome: WorkspaceOutcome): Promise<void>;

  // Changes panel (quick side-panel review)
  changesPanelOpen: boolean;
  changesPanelWorkspaceId: string | null;
  changesPanelFiles: DiffFile[];
  changesPanelSelectedFile: string | null;
  changesPanelFileDiff: { oldContent: string; newContent: string; unified: string } | null;
  openChangesPanel(workspaceId: string): Promise<void>;
  closeChangesPanel(): void;
  toggleChangesPanel(workspaceId: string): void;
  changesPanelSelectFile(path: string): Promise<void>;
  refreshChangesPanelFiles(): Promise<void>;

  // Checkpoint actions
  loadCheckpoints(workspaceId: string): Promise<void>;
  addCheckpoint(workspaceId: string, checkpoint: Checkpoint): void;
  addWorkspaceActivity(workspaceId: string, activity: SystemActivity): void;

  // Workspace session (multi-chat) actions
  setWorkspaceSessions(workspaceId: string, sessions: WorkspaceSession[]): void;
  addWorkspaceSession(workspaceId: string, session: WorkspaceSession): void;
  loadWorkspaceSessions(workspaceId: string): Promise<void>;
}

let changesPanelRequestVersion = 0;
let changesPanelFileDiffVersion = 0;

function clearWorkspaceUiState(state: {
  activeWorkspaceId: string | null;
  mergingWorkspaceId: string | null;
  changesPanelOpen: boolean;
  changesPanelWorkspaceId: string | null;
  changesPanelFiles: DiffFile[];
  changesPanelSelectedFile: string | null;
  changesPanelFileDiff: { oldContent: string; newContent: string; unified: string } | null;
}, workspaceId: string): void {
  if (state.activeWorkspaceId === workspaceId) {
    state.activeWorkspaceId = null;
  }
  if (state.mergingWorkspaceId === workspaceId) {
    state.mergingWorkspaceId = null;
  }
  if (state.changesPanelWorkspaceId === workspaceId) {
    changesPanelRequestVersion += 1;
    changesPanelFileDiffVersion += 1;
    state.changesPanelOpen = false;
    state.changesPanelWorkspaceId = null;
    state.changesPanelFiles = [];
    state.changesPanelSelectedFile = null;
    state.changesPanelFileDiff = null;
  }
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: new Map(),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,

    setWorkspaces(workspaces) {
      set((state) => {
        state.workspaces = new Map(workspaces.map((ws) => [ws.id, ws]));
      });
    },

    mergeWorkspaces(workspaces) {
      set((state) => {
        for (const ws of workspaces) {
          state.workspaces.set(ws.id, ws);
        }
      });
    },

    addWorkspace(ws) {
      set((state) => {
        state.workspaces.set(ws.id, ws);
      });
    },

    updateWorkspace(id, updates) {
      set((state) => {
        const ws = state.workspaces.get(id);
        if (ws) {
          Object.assign(ws, updates);
        }
      });
    },

    removeWorkspace(id) {
      set((state) => {
        state.workspaces.delete(id);
        state.checkpoints.delete(id);
        state.workspaceActivities.delete(id);
        state.workspaceSessions.delete(id);
        clearWorkspaceUiState(state, id);
      });
    },

    setActiveWorkspace(id) {
      set((state) => {
        state.activeWorkspaceId = id;
      });
    },

    openMerge(workspaceId) {
      set((state) => {
        state.mergingWorkspaceId = workspaceId;
      });
    },

    closeMerge() {
      set((state) => {
        state.mergingWorkspaceId = null;
      });
    },

    async setOutcome(id, outcome) {
      await window.api.invoke('workspace:set-outcome', { workspaceId: id, outcome });
      set((state) => {
        const ws = state.workspaces.get(id);
        if (ws) {
          ws.outcome = outcome;
        }
      });
    },

    async loadCheckpoints(workspaceId) {
      try {
        const checkpoints = await window.api.invoke('checkpoint:list', { workspaceId }) as Checkpoint[];
        set((state) => {
          state.checkpoints.set(workspaceId, checkpoints);
        });
      } catch {
        // Failed to load checkpoints
      }
    },

    addCheckpoint(workspaceId, checkpoint) {
      set((state) => {
        const existing = state.checkpoints.get(workspaceId) ?? [];
        existing.push(checkpoint);
        state.checkpoints.set(workspaceId, existing);
      });
    },

    addWorkspaceActivity(workspaceId, activity) {
      set((state) => {
        const nextActivities = [...(state.workspaceActivities.get(workspaceId) ?? [])];
        appendSystemActivity(nextActivities, activity);
        state.workspaceActivities.set(workspaceId, nextActivities);
      });
    },

    setWorkspaceSessions(workspaceId, sessions) {
      set((state) => {
        state.workspaceSessions.set(workspaceId, sessions);
      });
    },

    addWorkspaceSession(workspaceId, session) {
      set((state) => {
        const existing = state.workspaceSessions.get(workspaceId) ?? [];
        const idx = existing.findIndex((s) => s.sessionId === session.sessionId);
        if (idx >= 0) {
          existing[idx] = session;
        } else {
          existing.push(session);
        }
        state.workspaceSessions.set(workspaceId, existing);
      });
    },

    async openChangesPanel(workspaceId) {
      const requestVersion = ++changesPanelRequestVersion;
      set((state) => {
        state.changesPanelOpen = true;
        state.changesPanelWorkspaceId = workspaceId;
        state.changesPanelFiles = [];
        state.changesPanelSelectedFile = null;
        state.changesPanelFileDiff = null;
      });

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
          if (requestVersion !== changesPanelRequestVersion || state.changesPanelWorkspaceId !== workspaceId) return;
          state.changesPanelFiles = files;
          // Auto-select first file
          if (files.length > 0) {
            state.changesPanelSelectedFile = files[0].path;
          }
        });
        // Auto-load first file's diff
        const currentState = get();
        if (currentState.changesPanelSelectedFile && requestVersion === changesPanelRequestVersion) {
          await get().changesPanelSelectFile(currentState.changesPanelSelectedFile);
        }
      } catch {
        // Failed to load diff files
      }
    },

    closeChangesPanel() {
      changesPanelRequestVersion += 1;
      changesPanelFileDiffVersion += 1;
      set((state) => {
        state.changesPanelOpen = false;
        state.changesPanelWorkspaceId = null;
        state.changesPanelFiles = [];
        state.changesPanelSelectedFile = null;
        state.changesPanelFileDiff = null;
      });
    },

    toggleChangesPanel(workspaceId) {
      const { changesPanelOpen, changesPanelWorkspaceId } = get();
      if (changesPanelOpen && changesPanelWorkspaceId === workspaceId) {
        get().closeChangesPanel();
      } else {
        get().openChangesPanel(workspaceId);
      }
    },

    async changesPanelSelectFile(filePath) {
      const workspaceId = get().changesPanelWorkspaceId;
      if (!workspaceId) return;
      const requestVersion = ++changesPanelFileDiffVersion;

      set((state) => {
        state.changesPanelSelectedFile = filePath;
        state.changesPanelFileDiff = null;
      });

      try {
        const diff = await window.api.invoke('workspace:file-diff', { workspaceId, filePath }) as {
          oldContent: string;
          newContent: string;
          unified: string;
        };
        set((state) => {
          if (
            requestVersion !== changesPanelFileDiffVersion ||
            state.changesPanelWorkspaceId !== workspaceId ||
            state.changesPanelSelectedFile !== filePath
          ) return;
          state.changesPanelFileDiff = diff;
        });
      } catch {
        // Failed to load file diff
      }
    },

    async refreshChangesPanelFiles() {
      const workspaceId = get().changesPanelWorkspaceId;
      if (!workspaceId) return;
      const requestVersion = ++changesPanelRequestVersion;

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
          if (requestVersion !== changesPanelRequestVersion || state.changesPanelWorkspaceId !== workspaceId) return;
          state.changesPanelFiles = files;
        });
      } catch {
        // Failed to refresh
      }
    },

    async loadWorkspaceSessions(workspaceId) {
      try {
        const sessions = await window.api.invoke('workspace:list-chats', { workspaceId }) as WorkspaceSession[];
        set((state) => {
          state.workspaceSessions.set(workspaceId, sessions);
        });
      } catch {
        // Failed to load workspace sessions
      }
    },
  })),
);
