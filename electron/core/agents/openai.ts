import type OpenAI from 'openai';
import { EventEmitter } from 'events';
import type { AgentHandle, SpawnOptions, AgentMessage, TaskMode } from './types';
import { ConversationLoop } from './loop';
import { readFile } from '../tools/read';
import { writeFile } from '../tools/write';
import { executeBash } from '../tools/bash';
import { globFiles } from '../tools/glob';
import { grepFiles } from '../tools/grep';
import type { SessionMessage } from '../session/types';

/**
 * OpenAI API-based agent backed by the shared conversation loop so tool
 * execution actually completes instead of stopping after tool call emission.
 */
export async function spawnOpenAI(options: SpawnOptions, resumeMessages?: SessionMessage[]): Promise<AgentHandle> {
  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'openai';

  // Dynamic import to avoid loading openai at startup
  const { default: OpenAI } = await import('openai');
  const loop = new ConversationLoop({
    client: new OpenAI(),
    model: options.model ?? 'gpt-5.1',
    mode: options.mode,
    cwd: options.cwd,
    thinking: options.thinking,
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

  // Restore previous session messages for resume
  if (resumeMessages?.length) {
    loop.restoreMessages(sessionMessagesToLoopMessages(resumeMessages));
  }

  loop.addUserMessage(options.prompt, options.images);
  void runLoop();

  emitter.stop = async () => {
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

  emitter.answerQuestion = (_requestId: string, response: string) => {
    emitter.steer(response);
  };

  emitter.isAlive = () => !stopped;

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
  const repoName = cwd.split('/').pop() ?? 'project';
  const base = `You are an expert coding assistant working in the "${repoName}" project.
Working directory: ${cwd}

Available tools: read_file, write_file, run_command, list_files, search_files.
Use absolute paths. Prefer search_files to locate code before making changes.`;

  if (mode === 'plan') {
    return `${base}

MODE: PLAN — Read and analyze only. Do NOT modify files or run destructive commands.`;
  }
  if (mode === 'ask') {
    return `${base}

MODE: ASK — Answer questions only. Do NOT modify files, run destructive commands, or make any changes. Read and search code as needed to provide accurate answers.`;
  }
  if (mode === 'architect') {
    return `${base}

MODE: ARCHITECT — Read, analyze, and propose high-level architecture and design. Do NOT modify files or run destructive commands. Focus on system design, trade-offs, and recommendations.`;
  }
  return `${base}

MODE: ACT — Make changes directly. After modifications, verify with run_command when appropriate. Be concise about what you changed and why.`;
}

function sessionMessagesToLoopMessages(messages: SessionMessage[]): Array<{
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  tool_call_id?: string;
}> {
  const result: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
    tool_call_id?: string;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user' && msg.type === 'text') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant' && msg.type === 'text') {
      result.push({ role: 'assistant', content: msg.content });
    } else if (msg.role === 'assistant' && msg.type === 'tool_call' && msg.toolCallId && msg.toolName) {
      let args = '{}';
      if (msg.toolInput) {
        try {
          args = typeof msg.toolInput === 'string' ? msg.toolInput : JSON.stringify(msg.toolInput);
        } catch { /* keep default */ }
      }
      result.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: msg.toolCallId,
          type: 'function',
          function: { name: msg.toolName, arguments: args },
        }],
      });
    } else if (msg.role === 'tool' && msg.type === 'tool_result' && msg.toolCallId) {
      result.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId,
      });
    }
  }

  return result;
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
