import type { MermaidConfig } from 'mermaid';

export type MermaidTheme = 'dark' | 'light';

export interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
let initializedTheme: MermaidTheme | null = null;

function getMermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'default',
  } satisfies MermaidConfig;
}

async function getMermaidApi() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid');
  }

  const mermaidModule = await mermaidModulePromise;
  return mermaidModule.default;
}

export async function renderMermaidDiagram(
  source: string,
  theme: MermaidTheme,
  id: string,
): Promise<MermaidRenderResult> {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw new Error('Mermaid diagram is empty.');
  }

  const mermaid = await getMermaidApi();
  if (initializedTheme !== theme) {
    mermaid.initialize(getMermaidConfig(theme));
    initializedTheme = theme;
  }

  try {
    return await mermaid.render(id, normalizedSource);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Failed to render Mermaid diagram.');
  }
}
