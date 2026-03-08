import { useRef, useCallback } from 'react';

const MAX_HISTORY = 50;

const history: string[] = [];

export function useInputHistory() {
  const indexRef = useRef(-1);
  const draftRef = useRef('');

  const pushHistory = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // Remove duplicate if it exists
    const existing = history.indexOf(trimmed);
    if (existing !== -1) history.splice(existing, 1);
    history.unshift(trimmed);
    if (history.length > MAX_HISTORY) history.pop();
    indexRef.current = -1;
    draftRef.current = '';
  }, []);

  const navigateUp = useCallback((currentValue: string): string | null => {
    if (history.length === 0) return null;
    if (indexRef.current === -1) {
      draftRef.current = currentValue;
    }
    if (indexRef.current < history.length - 1) {
      indexRef.current++;
      return history[indexRef.current];
    }
    return null;
  }, []);

  const navigateDown = useCallback((): string | null => {
    if (indexRef.current <= -1) return null;
    indexRef.current--;
    if (indexRef.current === -1) {
      return draftRef.current;
    }
    return history[indexRef.current];
  }, []);

  const resetIndex = useCallback(() => {
    indexRef.current = -1;
    draftRef.current = '';
  }, []);

  return { pushHistory, navigateUp, navigateDown, resetIndex };
}
