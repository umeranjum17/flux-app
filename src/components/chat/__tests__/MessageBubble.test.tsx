import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import { useUiStore } from '../../../stores/ui';
import { renderMermaidDiagram } from '../../../lib/mermaid';

vi.mock('../../../lib/mermaid', () => ({
  renderMermaidDiagram: vi.fn(),
}));

const renderMermaidDiagramMock = vi.mocked(renderMermaidDiagram);

describe('MessageBubble', () => {
  beforeEach(() => {
    cleanup();
    renderMermaidDiagramMock.mockReset();
    renderMermaidDiagramMock.mockResolvedValue({
      svg: '<svg viewBox="0 0 100 40"><text x="10" y="20">Diagram</text></svg>',
    });
    useUiStore.setState({ theme: 'dark' });
  });

  it('renders Mermaid fenced blocks as diagrams in assistant messages', async () => {
    const { container } = render(
      <MessageBubble
        role="assistant"
        content={'```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```'}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.mermaid-block svg')).not.toBeNull();
    });

    expect(renderMermaidDiagramMock).toHaveBeenCalledWith(
      'graph TD\n  A[Start] --> B[Done]',
      'dark',
      expect.stringMatching(/^mermaid-/),
    );
  });

  it('renders Mermaid fenced blocks for system messages too', async () => {
    const { container } = render(
      <MessageBubble
        role="system"
        content={'```mermaid\ngraph TD\n  System --> Notice\n```'}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.mermaid-block svg')).not.toBeNull();
    });

    expect(renderMermaidDiagramMock).toHaveBeenCalledWith(
      'graph TD\n  System --> Notice',
      'dark',
      expect.stringMatching(/^mermaid-/),
    );
  });

  it('shows Mermaid errors with the original source', async () => {
    renderMermaidDiagramMock.mockRejectedValueOnce(new Error('Parse error on line 2'));

    const { container, getByText } = render(
      <MessageBubble
        role="assistant"
        content={'```mermaid\ngraph TD\n  A -->\n```'}
      />,
    );

    await waitFor(() => {
      expect(getByText('Unable to render Mermaid diagram')).not.toBeNull();
    });

    expect(getByText('Parse error on line 2')).not.toBeNull();
    expect(container.querySelector('.mermaid-block pre code')?.textContent).toContain('graph TD');
  });

  it('renders attachment names and paths', () => {
    render(
      <MessageBubble
        role="user"
        content="Please review"
        attachments={[{ path: '/workspace/src/app.ts', name: 'app.ts' }]}
      />,
    );

    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getByText('/workspace/src/app.ts')).toBeInTheDocument();
  });
});
