import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessageList } from '../MessageList';
import { useChatStore } from '../../../stores/chat';
import { useWorkspaceStore } from '../../../stores/workspace';
import { renderMermaidDiagram } from '../../../lib/mermaid';

vi.mock('../../../lib/mermaid', () => ({
  renderMermaidDiagram: vi.fn(),
}));

const renderMermaidDiagramMock = vi.mocked(renderMermaidDiagram);

beforeEach(() => {
  cleanup();
  renderMermaidDiagramMock.mockReset();
  renderMermaidDiagramMock.mockResolvedValue({
    svg: '<svg viewBox="0 0 120 40"><text x="10" y="20">Plan Diagram</text></svg>',
  });
  useChatStore.setState({ tasks: new Map(), activeTaskId: null, tabOrder: [] });
  useWorkspaceStore.setState({
    workspaces: new Map(),
    activeWorkspaceId: null,
    mergingWorkspaceId: null,
    checkpoints: new Map(),
    workspaceActivities: new Map(),
    workspaceOperations: new Map(),
    workspaceSessions: new Map(),
    changesPanelOpen: false,
    changesPanelWorkspaceId: null,
    changesPanelFiles: [],
    changesPanelSelectedFile: null,
    changesPanelFileDiff: null,
  });
});

describe('MessageList', () => {
  it('renders status messages as compact activity rows', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Claude startup',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');
    useChatStore.getState().addMessage('task-1', {
      type: 'status',
      role: 'system',
      statusKind: 'startup',
      content: 'Initializing Claude session',
      timestamp: 1,
    });

    render(<MessageList />);

    expect(screen.getByText('Initializing Claude session')).not.toBeNull();
    expect(document.querySelector('[data-status-kind="startup"]')).not.toBeNull();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders question requests inline', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Question',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'waiting_input');
    useChatStore.getState().addMessage('task-1', {
      type: 'question_request',
      role: 'assistant',
      content: 'Which area should I fix first?',
      timestamp: 2,
      requestId: 'q-1',
      questions: [{
        header: 'Priority',
        question: 'Which area should I fix first?',
        options: [{ label: 'Backend first' }, { label: 'UI first' }],
        allowFreeform: false,
      }],
      options: [{ label: 'Backend first' }, { label: 'UI first' }],
      allowFreeform: false,
    });

    render(<MessageList />);

    expect(screen.getAllByText('Input requested').length).toBeGreaterThan(0);
    expect(screen.getByText('Backend first')).not.toBeNull();
    expect(screen.getByText('UI first')).not.toBeNull();
  });

  it('keeps active thinking expanded while a task is live', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Thinking',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');
    useChatStore.getState().addMessage('task-1', {
      type: 'thinking',
      role: 'assistant',
      content: 'Line 1\nLine 2',
      timestamp: 3,
    });

    render(<MessageList />);

    expect(screen.getByText(/Line 1/)).not.toBeNull();
    expect(screen.getByText(/Line 2/)).not.toBeNull();
  });

  it('does not render exploratory assistant text as a plan card', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Planning',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'plan',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'running');
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: "I'll inspect the repo first and then map the fix to exact files.",
      timestamp: 4,
    });

    render(<MessageList />);

    expect(screen.getByText("I'll inspect the repo first and then map the fix to exact files.")).not.toBeNull();
    expect(screen.queryByText(/^Generating plan\.\.\.$/)).toBeNull();
    expect(screen.queryByText(/^Plan$/)).toBeNull();
  });

  it('renders only the structured plan in the plan card', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Planning',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'plan',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'done');
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: "I'll inspect the repo first and then map the fix to exact files.",
      timestamp: 5,
    });
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: `## Summary
Stabilize the plan renderer.

## Analysis
Only structured plan markdown should be treated as plan content.

## Steps
1. Detect real plan output.
2. Keep exploratory commentary out of the plan card.
3. Render interim updates as normal assistant text.

## Trade-offs
This depends on the agent honoring the structured plan prompt.`,
      timestamp: 6,
    });

    render(<MessageList />);

    expect(screen.getByText("I'll inspect the repo first and then map the fix to exact files.")).not.toBeNull();
    expect(screen.getByText(/^Summary$/)).not.toBeNull();
    expect(screen.getByText(/^Analysis$/)).not.toBeNull();
    expect(screen.getByText(/^Steps$/)).not.toBeNull();
    expect(screen.getByText('Stabilize the plan renderer.')).not.toBeNull();
  });

  it('preserves nearby assistant text when FLUX_SIGNAL lines contain nested JSON', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Copilot cleanup',
      agentId: 'copilot',
      model: 'gpt-5.4',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: [
        'Before text.',
        'FLUX_SIGNAL: {"type":"todo_update","todos":[{"label":"Investigate Copilot text trimming","status":"in_progress"},{"label":"Implement and verify fix","status":"pending"}]}',
        'After text.',
      ].join('\n'),
      timestamp: 6,
    });

    render(<MessageList />);

    expect(screen.getByText('Before text.')).not.toBeNull();
    expect(screen.getByText('After text.')).not.toBeNull();
    expect(screen.queryByText(/Investigate Copilot text trimming/)).toBeNull();
  });

  it('renders Mermaid diagrams inside the plan card', async () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Planning',
      agentId: 'codex',
      model: 'o4-mini',
      mode: 'plan',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().setTaskStatus('task-1', 'done');
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: `## Summary
Visualize the rollout.

\`\`\`mermaid
graph TD
  A[Prompt] --> B[Plan]
  B --> C[Diagram]
\`\`\`

## Analysis
Mermaid diagrams should render inside plan content.

## Steps
1. Route Mermaid fences through a dedicated renderer.
2. Verify the plan card shows the generated SVG.

## Trade-offs
This adds a renderer dependency but keeps markdown output visual.`,
      timestamp: 7,
    });

    const { container } = render(<MessageList />);

    await waitFor(() => {
      expect(container.querySelector('.premium-plan-card .mermaid-block svg')).not.toBeNull();
    });

    expect(renderMermaidDiagramMock).toHaveBeenCalledWith(
      'graph TD\n  A[Prompt] --> B[Plan]\n  B --> C[Diagram]',
      'dark',
      expect.stringMatching(/^mermaid-/),
    );
  });

  it('renders background system activities inline in the chat timeline', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Workspace task',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().addMessage('task-1', {
      type: 'text',
      role: 'assistant',
      content: 'Working on it.',
      timestamp: 7,
    });
    useChatStore.getState().addSystemActivity('task-1', {
      id: 'activity-1',
      category: 'checkpoint',
      label: 'Checkpoint saved',
      detail: '3 files · +18 / -4',
      timestamp: Date.now(),
    });

    render(<MessageList />);

    expect(screen.getByText('Checkpoint saved')).not.toBeNull();
    expect(screen.getByText('· 3 files · +18 / -4')).not.toBeNull();
  });

  it('renders workspace lifecycle activity before the first assistant message arrives', () => {
    useWorkspaceStore.getState().addWorkspace({
      id: 'ws-1',
      name: 'Lifecycle',
      parentRepo: '/workspace',
      branch: 'flux/lifecycle',
      status: 'running',
      outcome: 'in_progress',
      createdAt: 1,
      updatedAt: 1,
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      worktreePath: '/workspace/.flux-worktrees/ws-1',
    });
    useWorkspaceStore.getState().addWorkspaceActivity('ws-1', {
      id: 'activity-1',
      category: 'workspace',
      label: 'Workspace is running',
      timestamp: 2,
    });
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'Workspace task',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace/.flux-worktrees/ws-1',
      workspaceId: 'ws-1',
    });

    render(<MessageList />);

    expect(screen.getByText('Workspace is running')).not.toBeNull();
    expect(screen.queryByText('Ask Flux anything...')).toBeNull();
  });

  it('renders ipc activity with expandable payload details', () => {
    useChatStore.getState().createTask({
      id: 'task-1',
      title: 'IPC trace',
      agentId: 'claude-code',
      model: 'sonnet',
      mode: 'act',
      thinking: 'medium',
      cwd: '/workspace',
    });
    useChatStore.getState().addSystemActivity('task-1', {
      id: 'ipc-1',
      category: 'ipc',
      label: 'task:spawn',
      detail: 'response · task task-1 · session session-1',
      payloadPreview: '{"session":{"id":"session-1"}}',
      timestamp: 8,
    });

    render(<MessageList />);

    expect(screen.getByText('task:spawn')).not.toBeNull();
    expect(screen.getByText('· response · task task-1 · session session-1')).not.toBeNull();
    expect(screen.getByText('payload')).not.toBeNull();
    expect(screen.getByText('{"session":{"id":"session-1"}}')).not.toBeNull();
  });
});
