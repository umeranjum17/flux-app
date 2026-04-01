import { execFile } from 'child_process';
import { promisify } from 'util';
import { extendedEnv, resolveExecutable, resolveSshCommand } from '../process-utils';
import { log } from '../log';

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
import { loadMcpServers } from './mcp-config';
import { spawnCodex } from './codex';
import { spawnCopilot } from './copilot';
import { spawnGemini } from './gemini';
import { spawnOpenAI } from './openai';
import { spawnLlamaServer } from './llamaserver';
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
  copilot: {
    name: 'GitHub Copilot',
    cmd: 'copilot',
    envKeys: [],
    defaultModels: ['gpt-5.4', 'gpt-5.3-codex', 'claude-opus-4.6', 'claude-sonnet-4.6'],
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
  llamaserver: {
    name: 'LlamaServer',
    cmd: 'llama-server',
    envKeys: [],
    defaultModels: ['default'],
    supportsThinking: false,
  },
};

const spawners: Record<AgentId, (opts: SpawnOptions) => AgentHandle | Promise<AgentHandle>> = {
  'claude-code': spawnClaude,
  codex: (opts) => spawnCodex(opts),
  copilot: spawnCopilot,
  gemini: spawnGemini,
  openai: spawnOpenAI,
  llamaserver: spawnLlamaServer,
};

async function versionAsync(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, ['--version'], {
      encoding: 'utf-8',
      env: extendedEnv(),
      timeout: 3000,
    });
    return stdout.trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

class AgentManager {
  /** Local agent detection results — never overwritten by remote detection. */
  private agents: Map<AgentId, DetectedAgent> = new Map();
  /** Remote agent detection results keyed by host, then agent id. */
  private remoteAgents: Map<string, Map<AgentId, DetectedAgent>> = new Map();

  async detectAll(): Promise<DetectedAgent[]> {
    log.info('agent-manager', 'Running local agent detection…');
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

    log.ok('agent-manager', 'Local detection complete:', detected.map(a => `${a.id}=${a.available ? a.path : 'unavailable'}`).join(', '));
    return detected;
  }

  /**
   * Get a detected agent. For SSH workspaces, pass the host to get remote detection.
   * Falls back to local detection if no host-specific result exists.
   */
  get(id: AgentId, host?: string): DetectedAgent | undefined {
    if (host) {
      const remote = this.remoteAgents.get(host)?.get(id);
      if (remote) return remote;
    }
    return this.agents.get(id);
  }

  /** Clear cached remote agent detection for a specific host. */
  clearRemoteAgents(host: string): void {
    log.info('agent-manager', `Clearing remote agent cache for ${host}`);
    this.remoteAgents.delete(host);
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

      // claude-code, codex, and copilot use subscription/login auth — presence is enough
      if (id === 'claude-code' || id === 'codex' || id === 'copilot') {
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

    // llamaserver — local or remote, no auth needed; check binary or reachability
    if (id === 'llamaserver') {
      const path = resolveExecutable('llama-server');
      return path
        ? { authenticated: true, message: 'LlamaServer binary found' }
        : { authenticated: false, message: 'llama-server not found' };
    }

    return { authenticated: false, message: 'Unable to determine auth status' };
  }

  async listModels(id: AgentId): Promise<ModelInfo[]> {
    return fetchModelsForAgent(id);
  }

  async spawn(id: AgentId, options: SpawnOptions, resumeMessages?: SessionMessage[]): Promise<AgentHandle> {
    const agent = this.get(id, options.host);
    if (!agent || !agent.available) {
      log.error('agent-manager', `Agent ${id} not available (host=${options.host ?? 'local'}). Local: ${this.agents.get(id)?.available}, Remote hosts: ${[...this.remoteAgents.keys()].join(', ')}`);
      throw new Error(`Agent ${id} is not available`);
    }

    log.ok('agent-manager', `Spawning ${id} (host=${options.host ?? 'local'}, path=${agent.path})`);
    const opts = { ...options, binaryPath: agent.path || undefined };
    const mcpServers = (id === 'claude-code' || id === 'codex')
      ? loadMcpServers(options.cwd)
      : undefined;

    // OpenAI supports session resume via message replay
    if (id === 'openai' && resumeMessages?.length) {
      return spawnOpenAI(opts, resumeMessages);
    }

    if (id === 'codex') {
      return spawnCodex(opts, mcpServers);
    }

    const spawner = spawners[id];
    return spawner(opts);
  }

  async detectAllRemote(remoteHost: string): Promise<DetectedAgent[]> {
    log.info('agent-manager', `Running remote agent detection for ${remoteHost}…`);
    const ids = Object.keys(AGENT_DEFS) as AgentId[];
    const detected: DetectedAgent[] = [];

    // Run all SSH detection commands concurrently to avoid blocking
    const promises = ids.map(async (id) => {
      const def = AGENT_DEFS[id];

      if (!def.cmd) {
        // API-only agents: return local detection result (not host-specific)
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
      } catch (err) {
        log.warn('agent-manager', `Remote detection failed for ${id} on ${remoteHost}:`, err);
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
    // Store remote results in a separate per-host map — never overwrite local agents
    const hostMap = new Map<AgentId, DetectedAgent>();
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        hostMap.set(result.value.id, result.value);
        detected.push(result.value);
      }
    }
    this.remoteAgents.set(remoteHost, hostMap);

    log.ok('agent-manager', `Remote detection complete for ${remoteHost}:`, detected.map(a => `${a.id}=${a.available ? a.path : 'unavailable'}`).join(', '));
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
    const version = available ? await versionAsync(path) : 'unknown';

    let authStatus: DetectedAgent['authStatus'] = 'unknown';
    if (!available) {
      authStatus = 'unauthenticated';
    } else if (def.envKeys.length === 0) {
      // subscription / local auth (claude-code, codex, llamaserver)
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
