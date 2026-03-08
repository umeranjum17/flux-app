import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Workspace, WorkspaceStatus, DiffFile, Checkpoint } from '../lib/ipc-api';

interface WorkspaceState {
  workspaces: Map<string, Workspace>;
  activeWorkspaceId: string | null;
  dashboardOpen: boolean;

  // Review state
  reviewingWorkspaceId: string | null;
  diffFiles: DiffFile[];
  selectedFile: string | null;
  fileDiff: { oldContent: string; newContent: string; unified: string } | null;

  // Checkpoint state
  checkpoints: Map<string, Checkpoint[]>;

  // Actions
  setWorkspaces(workspaces: Workspace[]): void;
  addWorkspace(ws: Workspace): void;
  updateWorkspace(id: string, updates: Partial<Workspace>): void;
  removeWorkspace(id: string): void;
  setActiveWorkspace(id: string | null): void;
  toggleDashboard(): void;
  setDashboardOpen(open: boolean): void;

  // Review actions
  openReview(workspaceId: string): Promise<void>;
  closeReview(): void;
  selectFile(path: string): Promise<void>;
  refreshDiffFiles(): Promise<void>;

  // Checkpoint actions
  loadCheckpoints(workspaceId: string): Promise<void>;
  addCheckpoint(workspaceId: string, checkpoint: Checkpoint): void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: new Map(),
    activeWorkspaceId: null,
    dashboardOpen: false,
    reviewingWorkspaceId: null,
    diffFiles: [],
    selectedFile: null,
    fileDiff: null,
    checkpoints: new Map(),

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

    toggleDashboard() {
      set((state) => {
        state.dashboardOpen = !state.dashboardOpen;
      });
    },

    setDashboardOpen(open) {
      set((state) => {
        state.dashboardOpen = open;
      });
    },

    async openReview(workspaceId) {
      set((state) => {
        state.reviewingWorkspaceId = workspaceId;
        state.diffFiles = [];
        state.selectedFile = null;
        state.fileDiff = null;
      });

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
          state.diffFiles = files;
        });
      } catch {
        // Failed to load diff files
      }
    },

    closeReview() {
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
          state.fileDiff = diff;
        });
      } catch {
        // Failed to load file diff
      }
    },

    async refreshDiffFiles() {
      const workspaceId = get().reviewingWorkspaceId;
      if (!workspaceId) return;

      try {
        const files = await window.api.invoke('workspace:diff-files', { workspaceId }) as DiffFile[];
        set((state) => {
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
  })),
);
