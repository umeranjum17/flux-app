import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

const DIR_CACHE = new Map<string, { listing: string; ts: number }>();
const DIR_CACHE_TTL = 5000;

async function getDirListing(cwd: string): Promise<string> {
  const cached = DIR_CACHE.get(cwd);
  if (cached && Date.now() - cached.ts < DIR_CACHE_TTL) {
    return cached.listing;
  }
  try {
    const { stdout } = await execAsync('ls -la', { cwd, timeout: 3000 });
    const listing = stdout.split('\n').slice(0, 30).join('\n');
    DIR_CACHE.set(cwd, { listing, ts: Date.now() });
    return listing;
  } catch {
    return '';
  }
}

let activeAbort: AbortController | null = null;

// Detect provider from model name
type Provider = 'anthropic' | 'google' | 'openai';

const ANTHROPIC_MODELS = new Set(['haiku', 'sonnet', 'opus']);

function detectProvider(model: string): Provider {
  if (ANTHROPIC_MODELS.has(model) || model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  return 'openai';
}

// Map short aliases to full Anthropic model IDs
function resolveAnthropicModel(model: string): string {
  if (model === 'haiku') return 'claude-haiku-4-5-20251001';
  if (model === 'sonnet') return 'claude-sonnet-4-6-20250610';
  if (model === 'opus') return 'claude-opus-4-6-20250610';
  return model;
}

function buildSystemPrompt(cwd: string, dirListing: string, recentHistory: string): string {
  return [
    `You are a shell command autocomplete assistant.`,
    `Current directory: ${cwd}`,
    dirListing ? `Directory contents:\n${dirListing}` : '',
    recentHistory ? `Recent commands:\n${recentHistory}` : '',
    `OS: ${os.platform()}, Shell: ${os.platform() === 'darwin' ? 'zsh' : 'bash'}`,
    `Respond with ONLY the completion suffix to append after the cursor. Do not repeat the prefix. Output nothing if uncertain.`,
  ].filter(Boolean).join('\n');
}

async function completeWithAnthropic(
  model: string,
  systemPrompt: string,
  prefix: string,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return '';

  const resolved = resolveAnthropicModel(model);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: resolved,
      max_tokens: 60,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Complete this command: ${prefix}` }],
    }),
    signal,
  });

  if (!res.ok) {
    console.error(`[completion] Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
    return '';
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  return data.content?.[0]?.text?.trim() ?? '';
}

async function completeWithGoogle(
  model: string,
  systemPrompt: string,
  prefix: string,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return '';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: `Complete this command: ${prefix}` }] }],
        generationConfig: { maxOutputTokens: 60, temperature: 0 },
      }),
      signal,
    },
  );

  if (!res.ok) {
    console.error(`[completion] Google API ${res.status}: ${await res.text().catch(() => '')}`);
    return '';
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function completeWithOpenAI(
  model: string,
  systemPrompt: string,
  prefix: string,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return '';

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Complete this command: ${prefix}` },
      ],
      max_tokens: 60,
      temperature: 0,
    },
    { signal },
  );
  return response.choices[0]?.message?.content?.trim() ?? '';
}

export interface CompletionResult {
  suggestion: string;
  error?: string;
}

/** Pick the first available provider that has an API key. */
function pickAvailableProvider(preferred: Provider): { provider: Provider; model: string } | null {
  const keyCheck: Record<Provider, () => boolean> = {
    anthropic: () => !!process.env.ANTHROPIC_API_KEY,
    openai: () => !!process.env.OPENAI_API_KEY,
    google: () => !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  };
  const fallbackModels: Record<Provider, string> = {
    anthropic: 'haiku',
    openai: 'gpt-4o-mini',
    google: 'gemini-2.0-flash',
  };

  // Try preferred first
  if (keyCheck[preferred]()) return { provider: preferred, model: fallbackModels[preferred] };

  // Fallback to any available provider
  for (const p of (['anthropic', 'openai', 'google'] as const)) {
    if (keyCheck[p]()) return { provider: p, model: fallbackModels[p] };
  }
  return null;
}

export async function suggestCompletion(
  prefix: string,
  cwd: string,
  recentCommands: string[],
  model = 'haiku',
): Promise<CompletionResult> {
  if (!prefix.trim()) return { suggestion: '' };

  // Cancel prior in-flight request
  if (activeAbort) {
    activeAbort.abort();
  }
  activeAbort = new AbortController();
  const { signal } = activeAbort;

  const preferredProvider = detectProvider(model);
  const resolved = pickAvailableProvider(preferredProvider);
  if (!resolved) {
    return { suggestion: '', error: 'no_api_key' };
  }

  // Use the resolved provider/model (may differ from requested if fallback was needed)
  const effectiveModel = resolved.provider === preferredProvider ? model : resolved.model;
  const effectiveProvider = resolved.provider;

  const [dirListing] = await Promise.all([getDirListing(cwd)]);
  const recentHistory = recentCommands.slice(0, 20).join('\n');
  const systemPrompt = buildSystemPrompt(cwd, dirListing, recentHistory);

  try {
    let suggestion = '';
    if (effectiveProvider === 'anthropic') {
      suggestion = await completeWithAnthropic(effectiveModel, systemPrompt, prefix, signal);
    } else if (effectiveProvider === 'google') {
      suggestion = await completeWithGoogle(effectiveModel, systemPrompt, prefix, signal);
    } else {
      suggestion = await completeWithOpenAI(effectiveModel, systemPrompt, prefix, signal);
    }
    return { suggestion };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return { suggestion: '' };
    console.error('[completion] API error:', err);
    return { suggestion: '', error: 'api_error' };
  } finally {
    if (activeAbort?.signal === signal) activeAbort = null;
  }
}

/** Check which completion providers have API keys configured. */
export function availableCompletionProviders(): Provider[] {
  const providers: Provider[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) providers.push('google');
  return providers;
}
