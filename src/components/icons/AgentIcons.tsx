interface IconProps {
  size?: number;
  className?: string;
}

/** Claude mark */
export function ClaudeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g fill="currentColor">
        <rect x="11" y="1.5" width="2" height="7" rx="1" />
        <rect x="11" y="15.5" width="2" height="7" rx="1" />
        <rect x="15.5" y="11" width="7" height="2" rx="1" />
        <rect x="1.5" y="11" width="7" height="2" rx="1" />
        <rect x="14.86" y="3.23" width="2" height="7" rx="1" transform="rotate(45 14.86 3.23)" />
        <rect x="4.94" y="13.14" width="2" height="7" rx="1" transform="rotate(45 4.94 13.14)" />
        <rect x="13.14" y="19.06" width="2" height="7" rx="1" transform="rotate(135 13.14 19.06)" />
        <rect x="3.23" y="9.14" width="2" height="7" rx="1" transform="rotate(135 3.23 9.14)" />
      </g>
      <circle cx="12" cy="12" r="3.3" fill="currentColor" />
    </svg>
  );
}

/** OpenAI / ChatGPT knot-style mark */
export function OpenAIIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4.15c1.92 0 3.48 1.56 3.48 3.48v1.54c0 1.92-1.56 3.48-3.48 3.48s-3.48-1.56-3.48-3.48V7.63c0-1.92 1.56-3.48 3.48-3.48Z" />
        <path d="M15.95 6.44c1.66-.96 3.78-.4 4.74 1.26l.77 1.33c.96 1.66.4 3.78-1.26 4.74-1.66.96-3.78.4-4.74-1.26l-.77-1.33c-.96-1.66-.4-3.78 1.26-4.74Z" />
        <path d="M19.95 11.99c1.66.96 2.22 3.08 1.26 4.74l-.77 1.33c-.96 1.66-3.08 2.22-4.74 1.26-1.66-.96-2.22-3.08-1.26-4.74l.77-1.33c.96-1.66 3.08-2.22 4.74-1.26Z" />
        <path d="M16.03 17.58c0 1.92-1.56 3.48-3.48 3.48h-1.54c-1.92 0-3.48-1.56-3.48-3.48s1.56-3.48 3.48-3.48h1.54c1.92 0 3.48 1.56 3.48 3.48Z" />
        <path d="M8.03 17.55c-.96 1.66-3.08 2.22-4.74 1.26l-1.33-.77c-1.66-.96-2.22-3.08-1.26-4.74.96-1.66 3.08-2.22 4.74-1.26l1.33.77c1.66.96 2.22 3.08 1.26 4.74Z" />
        <path d="M4.08 12.04c-.96-1.66-.4-3.78 1.26-4.74l1.33-.77c1.66-.96 3.78-.4 4.74 1.26.96 1.66.4 3.78-1.26 4.74l-1.33.77c-1.66.96-3.78.4-4.74-1.26Z" />
      </g>
    </svg>
  );
}

/** Codex uses the OpenAI brand icon */
export function CodexIcon({ size = 16, className }: IconProps) {
  return <OpenAIIcon size={size} className={className} />;
}

/** Google Gemini — twin-star */
export function GeminiIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C12 2 13.5 7.5 16 10C18.5 12.5 22 12 22 12C22 12 18.5 13.5 16 16C13.5 18.5 12 22 12 22C12 22 10.5 18.5 8 16C5.5 13.5 2 12 2 12C2 12 5.5 12.5 8 10C10.5 7.5 12 2 12 2Z" />
    </svg>
  );
}

/** Ollama — rounded mark */
export function OllamaIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <ellipse cx="12" cy="13" rx="7" ry="8" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9.5" cy="11" r="1.2" />
      <circle cx="14.5" cy="11" r="1.2" />
      <ellipse cx="12" cy="6" rx="4" ry="3" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Returns the correct icon component for a given agent ID */
export function AgentIcon({ agentId, size = 16, className }: IconProps & { agentId: string }) {
  switch (agentId) {
    case 'claude-code':
      return <ClaudeIcon size={size} className={className} />;
    case 'codex':
      return <CodexIcon size={size} className={className} />;
    case 'gemini':
      return <GeminiIcon size={size} className={className} />;
    case 'openai':
      return <OpenAIIcon size={size} className={className} />;
    case 'ollama':
      return <OllamaIcon size={size} className={className} />;
    default:
      return <ClaudeIcon size={size} className={className} />;
  }
}

/** Brand accent colors per agent */
export const AGENT_COLORS: Record<string, string> = {
  'claude-code': 'text-orange-500',
  codex: 'text-emerald-400',
  gemini: 'text-blue-500',
  openai: 'text-emerald-400',
  ollama: 'text-violet-500',
};
