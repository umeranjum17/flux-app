import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMockApi, type MockApi } from '../../../../test/mocks/window-api';
import { TopBar } from '../TopBar';
import { useUiStore } from '../../../stores/ui';

let mockApi: MockApi;

beforeEach(() => {
  mockApi = createMockApi();
  (window as any).api = mockApi;

  useUiStore.setState({
    autoApprove: false,
    workspaceViewMode: 'list',
  } as any);
});

describe('TopBar', () => {
  it('renders a single kanban toggle button', () => {
    render(<TopBar />);

    expect(screen.getByLabelText('Toggle kanban board')).toBeInTheDocument();
    expect(screen.queryByLabelText('Switch to kanban view')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Switch to list view')).not.toBeInTheDocument();
  });

  it('toggles kanban mode from the left toolbar button', () => {
    const view = render(<TopBar />);
    const scoped = within(view.container);

    fireEvent.click(scoped.getByLabelText('Toggle kanban board'));

    expect(useUiStore.getState().workspaceViewMode).toBe('kanban');
    expect(scoped.getByTitle('Switch to engineering mode')).toBeInTheDocument();
  });
});
