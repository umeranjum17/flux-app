import { describe, expect, it } from 'vitest';
import { renderMermaidDiagram } from '../mermaid';

describe('renderMermaidDiagram', () => {
  it('renders Mermaid source to SVG markup', async () => {
    const result = await renderMermaidDiagram(
      'graph TD\n  A[Start] --> B[Done]',
      'dark',
      'mermaid-test-dark',
    );

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('mermaid-test-dark');
  });

  it('reconfigures Mermaid when the theme changes', async () => {
    const darkResult = await renderMermaidDiagram(
      'graph TD\n  A --> B',
      'dark',
      'mermaid-theme-dark',
    );
    const lightResult = await renderMermaidDiagram(
      'graph TD\n  A --> B',
      'light',
      'mermaid-theme-light',
    );

    expect(darkResult.svg).toContain('<svg');
    expect(lightResult.svg).toContain('<svg');
    expect(lightResult.svg).toContain('mermaid-theme-light');
  });

  it('rejects empty Mermaid diagrams', async () => {
    await expect(
      renderMermaidDiagram('   \n', 'dark', 'mermaid-empty'),
    ).rejects.toThrow('Mermaid diagram is empty.');
  });
});
