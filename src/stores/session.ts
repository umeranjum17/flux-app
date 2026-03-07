import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Session } from '../lib/ipc-api';

interface SessionState {
  sessions: Session[];
  loading: boolean;

  setSessions(sessions: Session[]): void;
  setLoading(loading: boolean): void;
  addSession(session: Session): void;
  upsertSession(session: Session): void;
  removeSession(id: string): void;
}

export const useSessionStore = create<SessionState>()(
  immer((set) => ({
    sessions: [],
    loading: false,

    setSessions(sessions) {
      set((state) => {
        state.sessions = sessions;
        state.loading = false;
      });
    },

    setLoading(loading) {
      set((state) => {
        state.loading = loading;
      });
    },

    addSession(session) {
      set((state) => {
        state.sessions.unshift(session);
      });
    },

    upsertSession(session) {
      set((state) => {
        state.sessions = [session, ...state.sessions.filter((s) => s.id !== session.id)];
      });
    },

    removeSession(id) {
      set((state) => {
        state.sessions = state.sessions.filter((s) => s.id !== id);
      });
    },
  })),
);
