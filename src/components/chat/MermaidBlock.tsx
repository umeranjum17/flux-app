import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../../stores/ui';
import { renderMermaidDiagram, type MermaidRenderResult } from '../../lib/mermaid';

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const theme = useUiStore((s) => s.theme);
  const rawId = useId();
  const diagramId = useMemo(() => `mermaid-${rawId.replace(/:/g, '-')}`, [rawId]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderedSvg, setRenderedSvg] = useState<string | null>(null);
  const [bindFunctions, setBindFunctions] = useState<MermaidRenderResult['bindFunctions']>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setRenderedSvg(null);
    setBindFunctions(undefined);
    setError(null);

    renderMermaidDiagram(code, theme, diagramId)
      .then((result) => {
        if (cancelled) return;
        setRenderedSvg(result.svg);
        setBindFunctions(() => result.bindFunctions);
      })
      .catch((renderError: unknown) => {
        if (cancelled) return;
        setError(renderError instanceof Error ? renderError.message : 'Failed to render Mermaid diagram.');
      });

    return () => {
      cancelled = true;
    };
  }, [code, diagramId, theme]);

  useEffect(() => {
    if (!bindFunctions || !containerRef.current) {
      return;
    }

    bindFunctions(containerRef.current);
  }, [bindFunctions, renderedSvg]);

  if (error) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-block-loading">
          <p className="text-sm font-semibold text-error">Unable to render Mermaid diagram</p>
          <p className="mt-1 text-xs text-text-secondary">{error}</p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-bg-primary/70 p-3 font-mono text-[12px] text-text-secondary">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    );
  }

  if (!renderedSvg) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-block-loading text-sm text-text-secondary">Rendering diagram...</div>
      </div>
    );
  }

  return (
    <div className="mermaid-block">
      <div
        ref={containerRef}
        className="mermaid-block-diagram"
        dangerouslySetInnerHTML={{ __html: renderedSvg }}
      />
    </div>
  );
}
