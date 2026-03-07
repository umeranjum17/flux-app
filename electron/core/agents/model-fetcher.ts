import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentId, ModelInfo } from './types';

const execFileAsync = promisify(execFile);

// --- Cache ---

const cache = new Map<AgentId, { models: ModelInfo[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function clearModelCache(id?: AgentId): void {
  if (id) {
    cache.delete(id);
  } else {
    cache.clear();
  }
}

// --- Fallback defaults ---

const CLAUDE_DEFAULTS: ModelInfo[] = [
  { id: 'sonnet', name: 'Sonnet (latest)' },
  { id: 'opus', name: 'Opus (latest)' },
  { id: 'haiku', name: 'Haiku (latest)' },
];

const CODEX_DEFAULTS: ModelInfo[] = [
  { id: 'o4-mini', name: 'o4-mini' },
  { id: 'o3', name: 'o3' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
];

const GEMINI_DEFAULTS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
];

const OPENAI_DEFAULTS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'o3-mini', name: 'o3-mini' },
  { id: 'o4-mini', name: 'o4-mini' },
];

// --- Per-agent fetchers ---

async function fetchClaudeModels(): Promise<ModelInfo[]> {
  try {
    const { stdout } = await execFileAsync('claude', ['model', 'list'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return CLAUDE_DEFAULTS;

    const models: ModelInfo[] = [];
    for (const line of lines) {
      const id = line.trim().split(/\s+/)[0];
      if (!id) continue;
      models.push({ id, name: prettifyModelId(id) });
    }
    return models.length > 0 ? models : CLAUDE_DEFAULTS;
  } catch {
    return CLAUDE_DEFAULTS;
  }
}

async function fetchCodexModels(): Promise<ModelInfo[]> {
  try {
    const { stdout } = await execFileAsync('codex', ['--help'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
    // Look for model references in help output
    const modelMatch = stdout.match(/models?[:\s]+([^\n]+)/i);
    if (modelMatch) {
      const ids = modelMatch[1].split(/[,\s]+/).filter(Boolean);
      if (ids.length > 0) {
        return ids.map((id) => ({ id, name: prettifyModelId(id) }));
      }
    }
    return CODEX_DEFAULTS;
  } catch {
    return CODEX_DEFAULTS;
  }
}

async function fetchGeminiModels(): Promise<ModelInfo[]> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          models: { name: string; displayName: string; supportedGenerationMethods: string[] }[];
        };
        const chatModels = data.models
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .filter((m) => m.name.includes('gemini'))
          .map((m) => ({
            id: m.name.replace('models/', ''),
            name: m.displayName || prettifyModelId(m.name.replace('models/', '')),
          }));
        if (chatModels.length > 0) return chatModels;
      }
    } catch {
      // fall through to defaults
    }
  }

  // Try CLI fallback
  try {
    const { stdout } = await execFileAsync('gemini', ['model', 'list'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const models: ModelInfo[] = [];
    for (const line of lines) {
      const id = line.trim().split(/\s+/)[0];
      if (id && id.includes('gemini')) {
        models.push({ id, name: prettifyModelId(id) });
      }
    }
    if (models.length > 0) return models;
  } catch {
    // fall through
  }

  return GEMINI_DEFAULTS;
}

async function fetchOpenAIModels(): Promise<ModelInfo[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return OPENAI_DEFAULTS;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return OPENAI_DEFAULTS;

    const data = (await res.json()) as { data: { id: string }[] };
    const chatPatterns = /^(gpt-4|gpt-3\.5|o1|o3|o4|chatgpt)/;
    const excludePatterns = /realtime|audio|search/;

    const models = data.data
      .filter((m) => chatPatterns.test(m.id) && !excludePatterns.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: prettifyModelId(m.id) }));

    return models.length > 0 ? models : OPENAI_DEFAULTS;
  } catch {
    return OPENAI_DEFAULTS;
  }
}

async function fetchOllamaModels(): Promise<ModelInfo[]> {
  // Try REST API first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as { models: { name: string }[] };
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
      }));
    }
  } catch {
    // fall through to CLI
  }

  // Try CLI fallback
  try {
    const { stdout } = await execFileAsync('ollama', ['list'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
    const lines = stdout.trim().split('\n').slice(1); // skip header
    const models: ModelInfo[] = [];
    for (const line of lines) {
      const name = line.trim().split(/\s+/)[0];
      if (name) models.push({ id: name, name });
    }
    return models;
  } catch {
    return []; // Ollama models are local — no misleading defaults
  }
}

// --- Dispatcher ---

const fetcherMap: Record<AgentId, () => Promise<ModelInfo[]>> = {
  'claude-code': fetchClaudeModels,
  codex: fetchCodexModels,
  gemini: fetchGeminiModels,
  openai: fetchOpenAIModels,
  ollama: fetchOllamaModels,
};

export async function fetchModelsForAgent(id: AgentId): Promise<ModelInfo[]> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.models;
  }

  const fetcher = fetcherMap[id];
  if (!fetcher) return [];

  const models = await fetcher();
  cache.set(id, { models, fetchedAt: Date.now() });
  return models;
}

// --- Helpers ---

function prettifyModelId(id: string): string {
  return id
    .replace(/^models\//, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s(\d{8,})$/, ' ($1)'); // move date suffix into parens
}
