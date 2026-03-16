import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { extendedEnv } from '../process-utils';
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
  { id: 'sonnet', name: 'Claude Sonnet 4.6' },
  { id: 'opus', name: 'Claude Opus 4.6' },
  { id: 'haiku', name: 'Claude Haiku 4.5' },
];

const CODEX_DEFAULTS: ModelInfo[] = [
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
  { id: 'gpt-5-codex-mini', name: 'GPT-5 Codex Mini' },
];

const COPILOT_DEFAULTS: ModelInfo[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 Fast' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
];

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');

const GEMINI_DEFAULTS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
];

const OPENAI_DEFAULTS: ModelInfo[] = [
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'o4-mini', name: 'o4-mini' },
  { id: 'gpt-4o', name: 'GPT-4o' },
];

// --- Per-agent fetchers ---

async function fetchClaudeModels(): Promise<ModelInfo[]> {
  // Claude Code currently exposes model selection but not a stable model-listing
  // command, so use curated aliases instead of shelling out to a nonexistent path.
  return CLAUDE_DEFAULTS;
}

async function fetchCodexModels(): Promise<ModelInfo[]> {
  const cached = readCodexModelsFromCache();
  if (cached.length > 0) {
    return orderModels(cached, CODEX_DEFAULTS);
  }

  return CODEX_DEFAULTS;
}

async function fetchCopilotModels(): Promise<ModelInfo[]> {
  try {
    const { stdout } = await execFileAsync('copilot', ['--help'], {
      timeout: 5000,
      encoding: 'utf-8',
      env: extendedEnv(),
    });

    const choicesMatch = stdout.match(/--model\s+<model>[\s\S]*?\(choices:\s*([\s\S]*?)\)\n/);
    if (!choicesMatch?.[1]) {
      return COPILOT_DEFAULTS;
    }

    const ids = Array.from(choicesMatch[1].matchAll(/"([^"]+)"/g)).map((match) => match[1]);
    const models = ids.map((id) => ({ id, name: prettifyModelId(id) }));
    return orderModels(models, COPILOT_DEFAULTS);
  } catch {
    return COPILOT_DEFAULTS;
  }
}

async function fetchGeminiModels(): Promise<ModelInfo[]> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }
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
      env: extendedEnv(),
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
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return OPENAI_DEFAULTS;

    const data = (await res.json()) as { data: { id: string }[] };
    const models = data.data
      .map((m) => m.id)
      .filter(isOpenAIChatModel)
      .map((id) => ({ id, name: prettifyModelId(id) }));

    return orderModels(models, OPENAI_DEFAULTS);
  } catch {
    return OPENAI_DEFAULTS;
  }
}

async function fetchOllamaModels(): Promise<ModelInfo[]> {
  // Try REST API first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch('http://localhost:11434/api/tags', {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

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
      env: extendedEnv(),
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
  copilot: fetchCopilotModels,
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

function isOpenAIChatModel(id: string): boolean {
  if (/(audio|realtime|transcribe|speech|embedding|moderation|image|tts|search)/i.test(id)) {
    return false;
  }
  if (/codex/i.test(id)) {
    return false;
  }
  return /^(gpt-5(\.|-|$)|gpt-4\.1(\.|-|$)|gpt-4o(\.|-|$)|o4-mini(\.|-|$)|o3(\.|-|$)|o1(\.|-|$))/i.test(id);
}

function orderModels(models: ModelInfo[], preferred: ModelInfo[]): ModelInfo[] {
  const preferredOrder = new Map(preferred.map((model, index) => [model.id, index]));
  const deduped = new Map<string, ModelInfo>();

  for (const model of [...preferred, ...models]) {
    if (!deduped.has(model.id)) {
      deduped.set(model.id, model);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const aIndex = preferredOrder.get(a.id);
    const bIndex = preferredOrder.get(b.id);

    if (aIndex != null && bIndex != null) return aIndex - bIndex;
    if (aIndex != null) return -1;
    if (bIndex != null) return 1;
    return b.id.localeCompare(a.id, undefined, { numeric: true });
  });
}

function prettifyModelId(id: string): string {
  return id
    .replace(/^models\//, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/\s(\d{8,})$/, ' ($1)'); // move date suffix into parens
}

function readCodexModelsFromCache(): ModelInfo[] {
  try {
    const raw = fs.readFileSync(CODEX_MODELS_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
      }>;
    };

    if (!Array.isArray(parsed.models)) {
      return [];
    }

    const models = parsed.models
      .filter((model) => model.visibility !== 'hidden')
      .map((model) => {
        const id = model.slug?.trim();
        if (!id) return null;
        return {
          id,
          name: model.display_name?.trim() || prettifyModelId(id),
        } satisfies ModelInfo;
      })
      .filter((model): model is ModelInfo => !!model)
      .filter((model) => /codex|^gpt-5(\.|-|$)/i.test(model.id));

    return dedupeModels(models);
  } catch {
    return [];
  }
}

function dedupeModels(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const deduped: ModelInfo[] = [];

  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }

  return deduped;
}
