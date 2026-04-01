import { EventEmitter } from 'events';
import { AgentHandle, AgentId, SpawnOptions, AgentMessage } from './types';
import { log } from '../log';

/**
 * Default llama-server endpoints for local and remote.
 * Local: http://localhost:8080
 * Remote (SSH): http://<host>:8080 — the host portion is extracted from the SSH host string.
 */
const DEFAULT_PORT = 8080;

function resolveBaseUrl(host?: string): string {
  if (!host) return `http://localhost:${DEFAULT_PORT}`;
  // host may be "user@hostname" — extract the hostname part
  const hostname = host.includes('@') ? host.split('@')[1] : host;
  return `http://${hostname}:${DEFAULT_PORT}`;
}

/**
 * Spawn a LlamaServer agent that streams chat completions from a llama-server
 * (llama.cpp) HTTP endpoint. Works for both local and remote (SSH) machines —
 * the server must already be running on the target machine.
 */
export function spawnLlamaServer(options: SpawnOptions): AgentHandle {
  const model = options.model ?? 'default';
  const baseUrl = resolveBaseUrl(options.host);
  const startTime = Date.now();
  let fullText = '';
  let abortController: AbortController | null = null;

  const emitter = new EventEmitter() as AgentHandle;
  emitter.setMaxListeners(20);
  emitter.taskId = options.taskId;
  emitter.agentId = 'llamaserver' as AgentId;

  let stopped = false;
  let finished = false;

  const finish = (result: { code: number | null; error?: string }) => {
    if (finished) return;
    finished = true;
    emitter.emit('done', result);
  };

  const emitMessage = (msg: AgentMessage) => {
    emitter.emit('message', msg);
  };

  // Warn about unsupported images
  if (options.images?.length) {
    setTimeout(() => {
      emitMessage({
        type: 'text',
        role: 'system',
        content: 'Note: Images were attached but LlamaServer does not support image input. They will be ignored.',
        timestamp: Date.now(),
      });
    }, 0);
  }

  const streamChat = async (prompt: string) => {
    abortController = new AbortController();

    emitMessage({
      type: 'status',
      role: 'system',
      statusKind: 'spawn',
      content: `[LlamaServer] Connecting to ${baseUrl} (model: ${model})`,
      timestamp: Date.now(),
    });

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const errMsg = `LlamaServer returned ${res.status}: ${body || res.statusText}`;
        emitMessage({ type: 'error', role: 'system', content: errMsg, timestamp: Date.now() });
        finish({ code: 1, error: errMsg });
        return;
      }

      if (!res.body) {
        const errMsg = 'LlamaServer returned no response body';
        emitMessage({ type: 'error', role: 'system', content: errMsg, timestamp: Date.now() });
        finish({ code: 1, error: errMsg });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (stopped) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              emitMessage({
                type: 'text',
                role: 'assistant',
                content: delta,
                timestamp: Date.now(),
              });
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }

      // Emit final result
      const durationMs = Date.now() - startTime;
      emitMessage({
        type: 'result',
        role: 'assistant',
        content: fullText.trim(),
        timestamp: Date.now(),
        durationMs,
      });
      finish({ code: 0 });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        finish({ code: 0 });
        return;
      }
      const errMsg = `LlamaServer error: ${err.message}`;
      emitMessage({ type: 'error', role: 'system', content: errMsg, timestamp: Date.now() });
      finish({ code: 1, error: errMsg });
    }
  };

  // Start streaming the initial prompt
  void streamChat(options.prompt);

  // Control methods
  emitter.stop = async () => {
    if (stopped) return;
    stopped = true;
    abortController?.abort();
  };

  emitter.approve = () => {};
  emitter.deny = () => {};

  emitter.steer = (prompt: string) => {
    // For follow-up messages, start a new streaming request
    void streamChat(prompt);
  };

  emitter.answerQuestion = (_requestId: string, response: string) => {
    void streamChat(response);
  };

  emitter.isAlive = () => !finished && !stopped;

  return emitter;
}
