import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Workspace, WorkspaceStatus, WorkspaceOutcome, DiffFile, Checkpoint, WorkspaceSession } from '../lib/ipc-api';

interface WorkspaceState {
  workspaces: Map<string, Workspace>;
  archivedWorkspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  showArchived: boolean;

  // Multi-chat sessions per workspace
  workspaceSessions: Map<string, WorkspaceSession[]>; // workspaceId → sessions

  // Review state
  reviewingWorkspaceId: string | null;
  diffFiles: DiffFile[];
  selectedFile: string | null;
  fileDiff: { oldContent: string; newContent: string; unified: string } | null;

  // Merge state
  mergingWorkspaceId: string | null;

  // Checkpoint state
  checkpoints: Map<string, Checkpoint[]>;

  // Actions
  setWorkspaces(workspaces: Workspace[]): void;
  addWorkspace(ws: Workspace): void;
  updateWorkspace(id: string, updates: Partial<Workspace>): void;
  removeWorkspace(id: string): void;
  setActiveWorkspace(id: string | null): void;
  openMerge(workspaceId: string): void;
  closeMerge(): void;
  setShowArchived(show: boolean): void;

  // Outcome actions
  setOutcome(id: string, outcome: WorkspaceOutcome): Promise<void>;

  // Archive actions
  setArchivedWorkspaces(workspaces: Workspace[]): void;
  archiveWorkspace(id: string): void;
  unarchiveWorkspace(id: string, restored: Workspace): void;

  // Review actions
  openReview(workspaceId: string): Promise<void>;
  closeReview(): void;
  selectFile(path: string): Promise<void>;
  refreshDiffFiles(): Promise<void>;

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

  // Workspace session (multi-chat) actions
  setWorkspaceSessions(workspaceId: string, sessions: WorkspaceSession[]): void;
  addWorkspaceSession(workspaceId: string, session: WorkspaceSession): void;
  loadWorkspaceSessions(workspaceId: string): Promise<void>;
}

let reviewRequestVersion = 0;
let fileDiffRequestVersion = 0;
let changesPanelRequestVersion = 0;
let changesPanelFileDiffVersion = 0;

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: new Map(),
    archivedWorkspaces: new Map(),
    activeWorkspaceId: null,
    showArchived: false,
    reviewingWorkspaceId: null,
    diffFiles: [],
    selectedFile: null,
    fileDiff: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
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
        state.workspaceSessions.delete(id);
        if (state.activeWorkspaceId === id) {
          state.activeWorkspaceId = null;
        }
        if (state.reviewingWorkspaceId === id) {
          state.reviewingWorkspaceId = null;
          state.diffFiles = [];
          state.selectedFile = null;
          state.fileDiff = null;
        }
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

    setShowArchived(show) {
      set((state) => {
        state.showArchived = show;
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

    setArchivedWorkspaces(workspaces) {
      set((state) => {
        state.archivedWorkspaces = new Map(workspaces.map((ws) => [ws.id, ws]));
      });
    },

    archiveWorkspace(id) {
      set((state) => {
        const ws = state.workspaces.get(id);
        if (ws) {
          const archived = { ...ws, archivedAt: Date.now(), status: 'idle' as WorkspaceStatus };
          state.archivedWorkspaces.set(id, archived);
          state.workspaces.delete(id);
          state.checkpoints.delete(id);
          state.workspaceSessions.delete(id);
          if (state.activeWorkspaceId === id) {
            state.activeWorkspaceId = null;
          }
          if (state.reviewingWorkspaceId === id) {
            state.reviewingWorkspaceId = null;
            state.diffFiles = [];
            state.selectedFile = null;
            state.fileDiff = null;
          }
        }
      });
    },

    unarchiveWorkspace(id, restored) {
      set((state) => {
        state.archivedWorkspaces.delete(id);
        state.workspaces.set(id, restored);
      });
    },

    async openReview(workspaceId) {
      const requestVersion = ++reviewRequestVersion;
      set((state) => {
        state.reviewingWorkspaceId = workspaceId;
        state.diffFiles = [];
        state.selectedFile = null;
        state.fileDiff = null;
      });

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
          if (requestVersion !== reviewRequestVersion || state.reviewingWorkspaceId !== workspaceId) {
            return;
          }
          state.diffFiles = files;
        });
      } catch {
        // Failed to load diff files
      }
    },

    closeReview() {
      reviewRequestVersion += 1;
      fileDiffRequestVersion += 1;
      set((state) => {
        state.reviewingWorkspaceId = null;
        state.diffFiles = [];
        state.selectedFile = null;
        state.fileDiff = null;
      });
    },

    async selectFile(filePath) {
      const workspaceId = get().reviewingWorkspaceId;
      if (!workspaceId) return;
      const requestVersion = ++fileDiffRequestVersion;

      set((state) => {
        state.selectedFile = filePath;
        state.fileDiff = null;
      });

      try {
        const diff = await window.api.invoke('workspace:file-diff', { workspaceId, filePath }) as {
          oldContent: string;
          newContent: string;
          unified: string;
        };
        set((state) => {
          if (
            requestVersion !== fileDiffRequestVersion ||
            state.reviewingWorkspaceId !== workspaceId ||
            state.selectedFile !== filePath
          ) {
            return;
          }
          state.fileDiff = diff;
        });
      } catch {
        // Failed to load file diff
      }
    },

    async refreshDiffFiles() {
      const workspaceId = get().reviewingWorkspaceId;
      if (!workspaceId) return;
      const requestVersion = ++reviewRequestVersion;

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
          if (requestVersion !== reviewRequestVersion || state.reviewingWorkspaceId !== workspaceId) {
            return;
          }
          state.diffFiles = files;
        });
      } catch {
        // Failed to refresh
      }
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
