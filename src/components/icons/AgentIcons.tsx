interface IconProps {
  size?: number;
  className?: string;
}

/** Anthropic / Claude — sparkle mark */
export function ClaudeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16.98 3.39L14.6 10.78l6.09 4.24-7.4-.46-2.38 7.39-2.39-7.39-7.39.46 6.08-4.24L4.73 3.39l6.09 4.24 3.78-5.58 3.78 5.58-.6.01z" opacity="0.85" />
      <path d="M12 1.05l2.38 7.39 7.4-.46-6.09 4.24 2.39 7.39-6.08-4.24-6.09 4.24 2.38-7.39-6.08-4.24 7.39.46L12 1.05z" />
    </svg>
  );
}

/** OpenAI Codex — hexagonal bracket */
export function CodexIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2L21.5 7.5V16.5L12 22L2.5 16.5V7.5L12 2Z" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" fill="currentColor" />
      <path d="M8.5 9L6.5 12L8.5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 9L17.5 12L15.5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Google Gemini — twin-star */
export function GeminiIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C12 2 13.5 7.5 16 10C18.5 12.5 22 12 22 12C22 12 18.5 13.5 16 16C13.5 18.5 12 22 12 22C12 22 10.5 18.5 8 16C5.5 13.5 2 12 2 12C2 12 5.5 12.5 8 10C10.5 7.5 12 2 12 2Z" />
    </svg>
  );
}

/** OpenAI — circular logo mark */
export function OpenAIIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 5.5V12L16.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12L7.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12V18.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  'claude-code': 'text-amber-500',
  codex: 'text-emerald-500',
  gemini: 'text-blue-500',
  openai: 'text-indigo-400',
  ollama: 'text-violet-500',
};
