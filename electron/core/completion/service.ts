import OpenAI from 'openai';
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

export async function suggestCompletion(
  prefix: string,
  cwd: string,
  recentCommands: string[],
  model = 'gpt-4o-mini',
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !prefix.trim()) return '';

  // Cancel prior in-flight request
  if (activeAbort) {
    activeAbort.abort();
  }
  activeAbort = new AbortController();
  const { signal } = activeAbort;

  const [dirListing] = await Promise.all([getDirListing(cwd)]);
  const recentHistory = recentCommands.slice(0, 20).join('\n');

  const systemPrompt = [
    `You are a shell command autocomplete assistant.`,
    `Current directory: ${cwd}`,
    dirListing ? `Directory contents:\n${dirListing}` : '',
    recentHistory ? `Recent commands:\n${recentHistory}` : '',
    `OS: ${os.platform()}, Shell: bash`,
    `Respond with ONLY the completion suffix to append after the cursor. Do not repeat the prefix. Output nothing if uncertain.`,
  ].filter(Boolean).join('\n');

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Complete this command: ${prefix}` },
        ],
        max_tokens: 50,
        temperature: 0,
      },
      { signal },
    );
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return '';
    return '';
  } finally {
    if (activeAbort?.signal === signal) activeAbort = null;
  }
}
