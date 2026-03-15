import { describe, expect, it } from 'vitest';
import { deriveBranchSlugFromSeed, deriveWorkspaceNameFromPrompt } from '../workspace-state';

describe('workspace naming', () => {
  it('derives concise workspace names from conversational prompts', () => {
    expect(
      deriveWorkspaceNameFromPrompt(
        'the current work tree names are horrible and it just takes what the user has written',
      ),
    ).toBe('Current Work Tree Names Horrible Takes');
  });

  it('drops markdown syntax and stop words from prompt headings', () => {
    expect(deriveWorkspaceNameFromPrompt('## Please fix the flaky CI pipeline for Linux')).toBe(
      'Fix Flaky CI Pipeline Linux',
    );
  });

  it('derives a clean slug from seed text', () => {
    expect(deriveBranchSlugFromSeed('Please add retry logic to API client', 32)).toBe(
      'add-retry-logic-api-client',
    );
  });

  it('falls back to normalized slug when no keywords are found', () => {
    expect(deriveBranchSlugFromSeed('---', 32)).toBe('');
    expect(deriveBranchSlugFromSeed('workspace-20260315', 32)).toBe('workspace-20260315');
  });
});
