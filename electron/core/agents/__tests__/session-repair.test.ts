import { describe, it, expect } from 'vitest';
import { isSessionLockError } from '../session-repair';

describe('isSessionLockError', () => {
  it('detects "already in use" errors', () => {
    expect(isSessionLockError(new Error('Session ID already in use'))).toBe(true);
    expect(isSessionLockError(new Error('session is ALREADY IN USE'))).toBe(true);
  });

  it('detects "session lock" errors', () => {
    expect(isSessionLockError(new Error('session lock conflict'))).toBe(true);
    expect(isSessionLockError(new Error('Session is locked by another process'))).toBe(true);
  });

  it('detects "session_locked" errors', () => {
    expect(isSessionLockError(new Error('Error: session_locked'))).toBe(true);
  });

  it('returns false for non-lock errors', () => {
    expect(isSessionLockError(new Error('API key invalid'))).toBe(false);
    expect(isSessionLockError(new Error('Network timeout'))).toBe(false);
    expect(isSessionLockError(new Error('Rate limited'))).toBe(false);
  });

  it('handles string errors', () => {
    expect(isSessionLockError('Session ID already in use')).toBe(true);
    expect(isSessionLockError('some other error')).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(isSessionLockError(null)).toBe(false);
    expect(isSessionLockError(undefined)).toBe(false);
  });
});
