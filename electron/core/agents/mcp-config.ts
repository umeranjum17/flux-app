import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** MCP server configuration. */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Load MCP server configuration from Claude's project and user settings.
 *
 * Searches:
 * 1. Project settings: `<cwd>/.claude/settings.json`
 * 2. User settings: `~/.claude/settings.json`
 *
 * Returns a merged map of server name → config, with project settings
 * taking precedence over user settings.
 */
export function loadMcpServers(cwd: string): Record<string, McpServerConfig> | undefined {
  const servers: Record<string, McpServerConfig> = {};
  let found = false;

  // User-level settings (lower priority)
  const userSettingsPath = join(homedir(), '.claude', 'settings.json');
  const userServers = readMcpServersFromFile(userSettingsPath);
  if (userServers) {
    Object.assign(servers, userServers);
    found = true;
  }

  // Project-level settings (higher priority, overrides user)
  const projectSettingsPath = join(cwd, '.claude', 'settings.json');
  const projectServers = readMcpServersFromFile(projectSettingsPath);
  if (projectServers) {
    Object.assign(servers, projectServers);
    found = true;
  }

  return found ? servers : undefined;
}

/**
 * Read MCP server definitions from a Claude settings.json file.
 * Returns undefined if the file doesn't exist or has no MCP config.
 */
function readMcpServersFromFile(filePath: string): Record<string, McpServerConfig> | undefined {
  if (!existsSync(filePath)) return undefined;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const settings = JSON.parse(content);

    const mcpServers = settings?.mcpServers ?? settings?.mcp_servers;
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
      return undefined;
    }

    const result: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(mcpServers)) {
      const normalized = normalizeMcpServerEntry(name, config);
      if (normalized) {
        result[name] = normalized;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a single MCP server entry from settings into our config format.
 */
function normalizeMcpServerEntry(name: string, entry: unknown): McpServerConfig | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const config = entry as Record<string, unknown>;
  const command = typeof config.command === 'string' ? config.command : undefined;

  if (!command) return null;

  const result: McpServerConfig = { name, command };

  if (Array.isArray(config.args)) {
    result.args = config.args.filter((a): a is string => typeof a === 'string');
  }

  if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
    }
    if (Object.keys(env).length > 0) result.env = env;
  }

  if (typeof config.cwd === 'string') {
    result.cwd = config.cwd;
  }

  return result;
}
