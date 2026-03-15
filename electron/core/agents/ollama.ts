import { AgentHandle, SpawnOptions, AgentMessage } from './types';
import { createCliAgentHandle } from './cli-agent';
import { safeWriteToChildStdin } from '../process-utils';

/**
 * Spawn an Ollama CLI subprocess for local model inference.
 * Ollama outputs plain text, so we stream text as AgentMessage events.
 */
export function spawnOllama(options: SpawnOptions): AgentHandle {
  const model = options.model ?? 'llama3';
  const startTime = Date.now();
  let fullText = '';
  let idleTimer: NodeJS.Timeout | null = null;
  const IDLE_TIMEOUT_MS = 3000;

  const resetIdleTimer = (proc: import('child_process').ChildProcess) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      safeWriteToChildStdin(proc, '/bye\n', 'ollama');
    }, IDLE_TIMEOUT_MS);
  };

  return createCliAgentHandle(options, {
    agentId: 'ollama',
    label: 'Ollama',
    defaultCommand: 'ollama',
    startupTimeoutMs: 30_000,

    buildArgs() {
      return ['run', model];
    },

    // Ollama doesn't output JSON events — raw lines are handled via onRawLine
    mapEvent() {
      return null;
    },

    classifyExit(code) {
      return `Ollama exited with code ${code}`;
    },

    controls: {
      steer(proc, prompt) {
        if (idleTimer) clearTimeout(idleTimer);
        safeWriteToChildStdin(proc, prompt + '\n', 'ollama');
      },
      answerQuestion(proc, _requestId, response) {
        if (idleTimer) clearTimeout(idleTimer);
        safeWriteToChildStdin(proc, response + '\n', 'ollama');
      },
    },

    hooks: {
      onAfterSpawn(proc, ctx) {
        // Warn about unsupported images
        if (options.images?.length) {
          setTimeout(() => {
            ctx.emitMessage({
              type: 'text',
              role: 'system',
              content: 'Note: Images were attached but Ollama does not support image input. They will be ignored.',
              timestamp: Date.now(),
            } satisfies AgentMessage);
          }, 0);
        }

        // Also reset watchdog on stderr
        proc.stderr?.on('data', () => ctx.watchdog.resetProgress());
      },

      sendInitialPrompt(proc) {
        safeWriteToChildStdin(proc, options.prompt + '\n', 'ollama');
      },

      // Ollama streams raw text, not JSON
      onRawLine(line, ctx) {
        fullText += line + '\n';
        resetIdleTimer(ctx.proc);
        ctx.emitMessage({
          type: 'text',
          role: 'assistant',
          content: line + '\n',
          timestamp: Date.now(),
        });
        return true;
      },

      // Custom stderr: Ollama emits progress info (model loading) on stderr
      onStderr(text, ctx) {
        const isProgress = text.includes('pulling') ||
          text.includes('verifying') ||
          text.includes('writing') ||
          text.includes('%');

        ctx.emitMessage({
          type: isProgress ? 'text' : 'error',
          role: 'system',
          content: text,
          timestamp: Date.now(),
        });
        return true; // always handled
      },

      onBeforeFinish(_code, ctx) {
        if (idleTimer) clearTimeout(idleTimer);

        // Emit a result message with the full accumulated text
        const durationMs = Date.now() - startTime;
        ctx.emitMessage({
          type: 'result',
          role: 'assistant',
          content: fullText.trim(),
          timestamp: Date.now(),
          durationMs,
        });

        return false; // proceed with default finish
      },

      onStop() {
        if (idleTimer) clearTimeout(idleTimer);
      },
    },
  });
}
