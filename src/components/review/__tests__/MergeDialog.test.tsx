import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { MergeDialog } from '../MergeDialog';
import { useUiStore } from '../../../stores/ui';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useUiStore.setState({
    gitBranch: 'master',
  } as any);
});

describe('MergeDialog', () => {
  it('prefills the target branch from the current repository branch', () => {
    render(
      <MergeDialog
        workspace={{
          id: 'ws-1',
          name: 'Hardening pass',
          parentRepo: '/repo',
          branch: 'flux-hardening',
          status: 'done',
          createdAt: 1,
          updatedAt: 1,
          agentId: 'codex',
          model: 'gpt-5-codex',
          worktreePath: '/repo/.flux-worktrees/ws-1',
        }}
        onClose={() => {}}
      />,
    );

    const targetBranchInput = screen.getByRole('textbox') as HTMLInputElement;
    expect(targetBranchInput.value).toBe('master');
  });
});
