import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { extendedEnv, resolveExecutable, resolveSshCommand } from '../process-utils';

const execFileAsync = promisify(execFile);
import {
  DetectedAgent,
  AgentId,
  SpawnOptions,
  AgentHandle,
  AuthResult,
} from './types';
import type { SessionMessage } from '../session/types';
import { spawnClaude } from './claude';
import { spawnCodex } from './codex';
import { spawnGemini } from './gemini';
import { spawnOpenAI } from './openai';
import { spawnOllama } from './ollama';
import { fetchModelsForAgent, clearModelCache } from './model-fetcher';
import type { ModelInfo } from './types';

const AGENT_DEFS: Record<
  AgentId,
  { name: string; cmd: string | null; envKeys: string[]; defaultModels: string[]; supportsThinking: boolean }
> = {
  'claude-code': {
    name: 'Claude Code',
    cmd: 'claude',
    envKeys: [],
    defaultModels: ['sonnet', 'opus', 'haiku'],
    supportsThinking: true,
  },
  codex: {
    name: 'Codex',
    cmd: 'codex',
    envKeys: [],
    defaultModels: ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5-codex', 'gpt-5-codex-mini', 'gpt-5.2-codex'],
    supportsThinking: true,
  },
  gemini: {
    name: 'Gemini CLI',
    cmd: 'gemini',
    envKeys: ['GOOGLE_API_KEY'],
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    supportsThinking: false,
  },
  openai: {
    name: 'OpenAI',
    cmd: null, // API-based, no CLI binary required
    envKeys: ['OPENAI_API_KEY'],
    defaultModels: ['gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'o4-mini'],
    supportsThinking: true,
  },
  ollama: {
    name: 'Ollama',
    cmd: 'ollama',
    envKeys: [],
    defaultModels: ['llama3', 'codellama', 'mistral'],
    supportsThinking: false,
  },
};

const spawners: Record<AgentId, (opts: SpawnOptions) => AgentHandle> = {
  'claude-code': spawnClaude,
  codex: spawnCodex,
  gemini: spawnGemini,
  openai: spawnOpenAI,
  ollama: spawnOllama,
};

function versionSync(command: string): string {
  try {
    return execFileSync(command, ['--version'], {
      encoding: 'utf-8',
      env: extendedEnv(),
    }).trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

class AgentManager {
  private agents: Map<AgentId, DetectedAgent> = new Map();

  async detectAll(): Promise<DetectedAgent[]> {
    const ids = Object.keys(AGENT_DEFS) as AgentId[];

    const results = await Promise.allSettled(
      ids.map((id) => this.detect(id)),
    );

    const detected: DetectedAgent[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        detected.push(result.value);
        this.agents.set(result.value.id, result.value);
      }
    }

    return detected;
  }

  get(id: AgentId): DetectedAgent | undefined {
    return this.agents.get(id);
  }

  async checkAuth(agentId: string): Promise<AuthResult> {
    const id = agentId as AgentId;
    const def = AGENT_DEFS[id];
    if (!def) {
      return { authenticated: false, message: `Unknown agent: ${agentId}` };
    }

    // CLI-based agents: check if the binary exists and responds
    if (def.cmd) {
      const path = resolveExecutable(def.cmd);
      if (!path) {
        return { authenticated: false, message: `${def.name} CLI not found` };
      }

      // claude-code and codex use subscription auth — presence is enough
      if (id === 'claude-code' || id === 'codex') {
        return { authenticated: true, message: `${def.name} CLI detected (subscription auth)` };
      }
    }

    // Env-key-based agents: check that required keys are set
    if (def.envKeys.length > 0) {
      const missing = def.envKeys.filter((k) => !process.env[k]);
      if (missing.length > 0) {
        return {
          authenticated: false,
          message: `Missing environment variable(s): ${missing.join(', ')}`,
        };
      }
      return { authenticated: true, message: `${def.name} API key(s) found` };
    }

    // ollama — local, no auth needed
    if (id === 'ollama') {
      const path = resolveExecutable('ollama');
      return path
        ? { authenticated: true, message: 'Ollama running locally' }
        : { authenticated: false, message: 'Ollama not found' };
    }

    return { authenticated: false, message: 'Unable to determine auth status' };
  }

  async listModels(id: AgentId): Promise<ModelInfo[]> {
    return fetchModelsForAgent(id);
  }

  spawn(id: AgentId, options: SpawnOptions, resumeMessages?: SessionMessage[]): AgentHandle {
    const agent = this.agents.get(id);
    if (!agent || !agent.available) {
      throw new Error(`Agent ${id} is not available`);
    }

    const opts = { ...options, binaryPath: agent.path || undefined };

    // OpenAI supports session resume via message replay
    if (id === 'openai' && resumeMessages?.length) {
      return spawnOpenAI(opts, resumeMessages);
    }

    const spawner = spawners[id];
    return spawner(opts);
  }

  async detectAllRemote(remoteHost: string): Promise<DetectedAgent[]> {
    const ids = Object.keys(AGENT_DEFS) as AgentId[];
    const detected: DetectedAgent[] = [];

    // Run all SSH detection commands concurrently to avoid blocking
    const promises = ids.map(async (id) => {
      const def = AGENT_DEFS[id];

      if (!def.cmd) {
        const existing = this.agents.get(id);
        return existing ?? null;
      }

      let remotePath = '';
      let version = 'unknown';
      let available = false;

      try {
        const { stdout } = await execFileAsync(
          resolveSshCommand(),
          [remoteHost, `command -v ${def.cmd} >/dev/null 2>&1 && command -v ${def.cmd} && ${def.cmd} --version 2>/dev/null || true`],
          { encoding: 'utf-8', timeout: 15000, env: extendedEnv() },
        );

        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length > 0 && lines[0].startsWith('/')) {
          remotePath = lines[0];
          available = true;
          if (lines.length > 1) {
            version = lines[1];
          }
        }
      } catch {
        // Remote detection failed — mark unavailable
      }

      return {
        id,
        name: def.name,
        path: remotePath,
        version,
        available,
        models: def.defaultModels,
        supportsThinking: def.supportsThinking,
        authStatus: available ? 'authenticated' : 'unauthenticated',
        envKeys: def.envKeys,
      } satisfies DetectedAgent;
    });

    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        this.agents.set(result.value.id, result.value);
        detected.push(result.value);
      }
    }

    return detected;
  }

  // ---- private ----

  private async detect(id: AgentId): Promise<DetectedAgent> {
    const def = AGENT_DEFS[id];

    // OpenAI is API-only — available when the key is set
    if (id === 'openai') {
      const hasKey = !!process.env.OPENAI_API_KEY;
      return {
        id,
        name: def.name,
        path: '',
        version: 'api',
        available: hasKey,
        models: def.defaultModels,
        supportsThinking: def.supportsThinking,
        authStatus: hasKey ? 'authenticated' : 'unauthenticated',
        envKeys: def.envKeys,
      };
    }

    // CLI-based agents
    const path = resolveExecutable(def.cmd!);
    const available = path !== null;
    const version = available ? versionSync(path) : 'unknown';

    let authStatus: DetectedAgent['authStatus'] = 'unknown';
    if (!available) {
      authStatus = 'unauthenticated';
    } else if (def.envKeys.length === 0) {
      // subscription / local auth (claude-code, codex, ollama)
      authStatus = 'authenticated';
    } else {
      const missing = def.envKeys.filter((k) => !process.env[k]);
      authStatus = missing.length === 0 ? 'authenticated' : 'unauthenticated';
    }

    return {
      id,
      name: def.name,
      path: path ?? '',
      version,
      available,
      models: def.defaultModels,
      supportsThinking: def.supportsThinking,
      authStatus,
      envKeys: def.envKeys,
    };
  }
}

export const agentManager = new AgentManager();
export { AgentManager };
