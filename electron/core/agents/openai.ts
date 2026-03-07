import OpenAI from 'openai';
import { EventEmitter } from 'events';
import type { AgentHandle, SpawnOptions, AgentMessage, TaskMode } from './types';
import { ConversationLoop } from './loop';
import { readFile } from '../tools/read';
import { writeFile } from '../tools/write';
import { executeBash } from '../tools/bash';
import { globFiles } from '../tools/glob';
import { grepFiles } from '../tools/grep';

/**
 * OpenAI API-based agent backed by the shared conversation loop so tool
 * execution actually completes instead of stopping after tool call emission.
 */
export function spawnOpenAI(options: SpawnOptions): AgentHandle {
  const emitter = new EventEmitter() as AgentHandle;
  emitter.taskId = options.taskId;
  emitter.agentId = 'openai';

  const loop = new ConversationLoop({
    client: new OpenAI(),
    model: options.model ?? 'gpt-4o',
    mode: options.mode,
    cwd: options.cwd,
    tools: getDefaultTools(),
    toolHandler: (name, input) => handleTool(name, input, options.cwd),
    systemPrompt: buildSystemPrompt(options.mode, options.cwd),
  });

  let running = false;
  let stopped = false;
  let rerunRequested = false;

  const runLoop = async () => {
    if (running || stopped) return;
    running = true;

    let fatalError: string | null = null;

    try {
      for await (const message of loop.run()) {
        emitter.emit('message', message);
        if (message.type === 'error') {
          fatalError = message.content;
        }
      }
    } catch (err) {
      fatalError = err instanceof Error ? err.message : String(err);
      const errorMsg: AgentMessage = {
        type: 'error',
        role: 'system',
        content: `OpenAI API error: ${fatalError}`,
        timestamp: Date.now(),
      };
      emitter.emit('message', errorMsg);
    } finally {
      running = false;
      if (stopped) return;
      if (!fatalError && rerunRequested) {
        rerunRequested = false;
        void runLoop();
        return;
      }
      emitter.emit('done', fatalError ? { code: 1, error: fatalError } : { code: 0 });
    }
  };

  loop.addUserMessage(options.prompt, options.images);
  void runLoop();

  emitter.stop = () => {
    stopped = true;
    loop.stop();
    emitter.emit('done', { code: 0, aborted: true });
  };

  emitter.approve = (_requestId: string) => {
    // OpenAI path executes tools directly.
  };

  emitter.deny = (_requestId: string) => {
    // Not applicable for direct API tool execution.
  };

  emitter.steer = (prompt: string, images?: string[]) => {
    loop.addUserMessage(prompt, images);
    if (running) {
      rerunRequested = true;
      return;
    }
    void runLoop();
  };

  return emitter;
}

async function handleTool(
  name: string,
  input: Record<string, unknown>,
  defaultCwd: string,
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const filePath = asRequiredString(input.path, 'path');
      return readFile(filePath);
    }

    case 'write_file': {
      const filePath = asRequiredString(input.path, 'path');
      const content = asRequiredString(input.content, 'content');
      await writeFile(filePath, content);
      return `Wrote ${filePath}`;
    }

    case 'run_command': {
      const command = asRequiredString(input.command, 'command');
      const cwd = asOptionalString(input.cwd) ?? defaultCwd;
      const result = await executeBash(command, cwd);
      const parts = [];
      if (result.stdout) parts.push(result.stdout.trimEnd());
      if (result.stderr) parts.push(result.stderr.trimEnd());
      parts.push(`Exit code: ${result.exitCode}`);
      return parts.filter(Boolean).join('\n');
    }

    case 'list_files': {
      const targetPath = asRequiredString(input.path, 'path');
      const recursive = Boolean(input.recursive);
      const pattern = recursive ? '**/*' : '*';
      const files = await globFiles(pattern, targetPath);
      return files.length > 0 ? files.join('\n') : '[No files found]';
    }

    case 'search_files': {
      const pattern = asRequiredString(input.pattern, 'pattern');
      const targetPath = asRequiredString(input.path, 'path');
      const filePattern = asOptionalString(input.file_pattern) ?? '**/*';
      const results = await grepFiles(pattern, targetPath, filePattern);
      return results.length > 0
        ? results
            .map((result) => `${result.file}:${result.line}:${result.content}`)
            .join('\n')
        : '[No matches found]';
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function asRequiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required string field: ${key}`);
  }
  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function buildSystemPrompt(mode: TaskMode, cwd: string): string {
  const base = `You are an AI coding assistant. Working directory: ${cwd}`;
  if (mode === 'plan') {
    return `${base}\n\nYou are in PLAN mode. Analyze the codebase, explain your reasoning, and suggest changes. Do NOT make any modifications.`;
  }
  return `${base}\n\nYou are in ACT mode. You can use tools to read, write, and modify files. Execute the user's request.`;
}

function getDefaultTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to the file' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file (creates or overwrites)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'File content to write' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command and return its output',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to run' },
            cwd: { type: 'string', description: 'Working directory (optional)' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files and directories at a given path',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
            recursive: { type: 'boolean', description: 'Whether to list recursively' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for a pattern in files (like grep)',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern (regex)' },
            path: { type: 'string', description: 'Directory to search in' },
            file_pattern: { type: 'string', description: 'Glob pattern for files to search (e.g. "*.ts")' },
          },
          required: ['pattern', 'path'],
        },
      },
    },
  ];
}
