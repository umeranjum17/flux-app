import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { loadMcpServers } from '../mcp-config';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

describe('loadMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when no settings files exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadMcpServers('/projects/test')).toBeUndefined();
  });

  it('loads MCP servers from project settings', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('/projects/test/.claude/settings.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcpServers: {
        'my-tool': {
          command: 'node',
          args: ['server.js'],
          env: { PORT: '3000' },
        },
      },
    }));

    const result = loadMcpServers('/projects/test');
    expect(result).toBeDefined();
    expect(result!['my-tool']).toMatchObject({
      name: 'my-tool',
      command: 'node',
      args: ['server.js'],
      env: { PORT: '3000' },
    });
  });

  it('loads MCP servers from user settings', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('.claude/settings.json') && !String(path).includes('/projects/');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcpServers: {
        'global-tool': {
          command: 'python',
          args: ['-m', 'mcp_server'],
        },
      },
    }));

    const result = loadMcpServers('/projects/test');
    expect(result).toBeDefined();
    expect(result!['global-tool']).toMatchObject({
      name: 'global-tool',
      command: 'python',
      args: ['-m', 'mcp_server'],
    });
  });

  it('project settings override user settings for same server name', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes('/projects/test/.claude/')) {
        return JSON.stringify({
          mcpServers: {
            'shared-tool': { command: 'project-cmd' },
          },
        });
      }
      return JSON.stringify({
        mcpServers: {
          'shared-tool': { command: 'user-cmd' },
          'user-only': { command: 'user-tool' },
        },
      });
    });

    const result = loadMcpServers('/projects/test');
    expect(result).toBeDefined();
    expect(result!['shared-tool'].command).toBe('project-cmd');
    expect(result!['user-only'].command).toBe('user-tool');
  });

  it('skips entries without a command', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('/projects/test/.claude/settings.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcpServers: {
        'valid': { command: 'node', args: ['server.js'] },
        'invalid': { args: ['no-command'] },
        'also-invalid': 42,
      },
    }));

    const result = loadMcpServers('/projects/test');
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(['valid']);
  });

  it('handles malformed JSON gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json{{{');

    expect(loadMcpServers('/projects/test')).toBeUndefined();
  });

  it('handles settings without mcpServers field', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('/projects/test/.claude/settings.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      theme: 'dark',
      someOtherSetting: true,
    }));

    expect(loadMcpServers('/projects/test')).toBeUndefined();
  });

  it('normalizes server entry with cwd', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('/projects/test/.claude/settings.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcpServers: {
        'with-cwd': {
          command: 'node',
          cwd: '/custom/dir',
        },
      },
    }));

    const result = loadMcpServers('/projects/test');
    expect(result!['with-cwd'].cwd).toBe('/custom/dir');
  });

  it('supports mcp_servers (snake_case) key', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).includes('/projects/test/.claude/settings.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      mcp_servers: {
        'snake-case-tool': { command: 'my-tool' },
      },
    }));

    const result = loadMcpServers('/projects/test');
    expect(result).toBeDefined();
    expect(result!['snake-case-tool']).toMatchObject({
      name: 'snake-case-tool',
      command: 'my-tool',
    });
  });
});
