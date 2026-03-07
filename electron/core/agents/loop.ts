import OpenAI from 'openai';
import { AgentMessage, TaskMode, ThinkingLevel } from './types';

interface LoopMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAI.Chat.Completions.ChatCompletionContentPart[] | null;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolHandler {
  (name: string, input: Record<string, unknown>): Promise<string>;
}

interface ConversationLoopOptions {
  model: string;
  mode: TaskMode;
  cwd: string;
  thinking?: ThinkingLevel;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolHandler?: ToolHandler;
  client?: OpenAI;
  systemPrompt?: string;
  maxTurns?: number;
}

/**
 * ConversationLoop manages multi-turn conversations for API-based agents
 * (OpenAI, or any OpenAI-compatible API). It handles:
 * - Message history management
 * - Tool call execution and result feeding
 * - Streaming responses
 * - Abort/stop support
 */
export class ConversationLoop {
  private client: OpenAI;
  private model: string;
  private mode: TaskMode;
  private thinking: ThinkingLevel | undefined;
  private tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  private toolHandler: ToolHandler | null;
  private maxTurns: number;
  private abortController: AbortController | null = null;

  messages: LoopMessage[] = [];

  constructor(options: ConversationLoopOptions) {
    this.client = options.client ?? new OpenAI();
    this.model = options.model;
    this.mode = options.mode;
    this.thinking = options.thinking;
    this.tools = options.mode === 'act' ? options.tools : undefined;
    this.toolHandler = options.toolHandler ?? null;
    this.maxTurns = options.maxTurns ?? 10;

    // Initialize with system prompt
    const systemPrompt = options.systemPrompt ?? buildDefaultSystemPrompt(options.mode, options.cwd);
    this.messages.push({ role: 'system', content: systemPrompt });
  }

  /**
   * Add a user message to the conversation, optionally with images.
   */
  addUserMessage(content: string, images?: string[]): void {
    if (!images?.length) {
      this.messages.push({ role: 'user', content });
      return;
    }

    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    if (content.trim()) {
      parts.push({ type: 'text', text: content });
    }
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: image },
      });
    }

    this.messages.push({ role: 'user', content: parts });
  }

  /**
   * Run the conversation loop. Yields AgentMessage events as they stream in.
   * Automatically handles tool calls up to maxTurns.
   */
  async *run(): AsyncGenerator<AgentMessage> {
    this.abortController = new AbortController();
    let turns = 0;

    while (turns < this.maxTurns) {
      turns++;

      const startTime = Date.now();
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      const pendingToolCalls: {
        id: string;
        name: string;
        arguments: string;
      }[] = [];
      let finishReason: string | null = null;

      try {
        const stream = await this.client.chat.completions.create(
          {
            model: this.model,
            messages: this.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            stream: true,
            stream_options: { include_usage: true },
            ...(this.thinking ? { reasoning_effort: toReasoningEffort(this.thinking, this.model) } : {}),
            ...(this.tools?.length ? { tools: this.tools } : {}),
          },
          { signal: this.abortController.signal },
        );

        for await (const chunk of stream) {
          if (this.abortController.signal.aborted) return;

          const choice = chunk.choices?.[0];
          if (!choice) {
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
            }
            continue;
          }

          const delta = choice.delta;

          // Streaming text
          if (delta?.content) {
            fullText += delta.content;
            yield {
              type: 'text',
              role: 'assistant',
              content: delta.content,
              timestamp: Date.now(),
            };
          }

          // Tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              while (pendingToolCalls.length <= idx) {
                pendingToolCalls.push({ id: '', name: '', arguments: '' });
              }
              const pending = pendingToolCalls[idx];
              if (tc.id) pending.id = tc.id;
              if (tc.function?.name) pending.name = tc.function.name;
              if (tc.function?.arguments) pending.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      } catch (err: any) {
        if (this.abortController.signal.aborted) return;

        yield {
          type: 'error',
          role: 'system',
          content: `API error: ${err.message ?? String(err)}`,
          timestamp: Date.now(),
        };
        return;
      }

      // Handle tool calls
      if (finishReason === 'tool_calls' && pendingToolCalls.length > 0) {
        // Add assistant message with tool calls to history
        const toolCallObjs: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
          pendingToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));

        this.messages.push({
          role: 'assistant',
          content: fullText || null,
          tool_calls: toolCallObjs,
        });

        // Execute each tool call and yield results
        for (const tc of pendingToolCalls) {
          let parsedInput: Record<string, unknown> = {};
          try {
            parsedInput = JSON.parse(tc.arguments);
          } catch {
            parsedInput = { raw: tc.arguments };
          }

          // Yield tool_call message
          yield {
            type: 'tool_call',
            role: 'assistant',
            content: `Calling: ${tc.name}`,
            timestamp: Date.now(),
            toolName: tc.name,
            toolInput: parsedInput,
            toolCallId: tc.id,
          };

          // Execute the tool
          let result: string;
          let isError = false;
          if (this.toolHandler) {
            try {
              result = await this.toolHandler(tc.name, parsedInput);
            } catch (err: any) {
              result = `Error: ${err.message ?? String(err)}`;
              isError = true;
            }
          } else {
            result = 'Tool execution not configured';
            isError = true;
          }

          // Add tool result to message history
          this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
          });

          // Yield tool_result message
          yield {
            type: 'tool_result',
            role: 'tool',
            content: result,
            timestamp: Date.now(),
            toolCallId: tc.id,
            toolName: tc.name,
            isError,
          };
        }

        // Continue the loop — the model will see tool results and respond
        continue;
      }

      // Normal completion (no tool calls) — we're done
      if (fullText) {
        this.messages.push({ role: 'assistant', content: fullText });
      }

      // Yield final result
      const durationMs = Date.now() - startTime;
      yield {
        type: 'result',
        role: 'assistant',
        content: fullText,
        timestamp: Date.now(),
        inputTokens,
        outputTokens,
        durationMs,
      };

      return;
    }

    // Exceeded max turns
    yield {
      type: 'error',
      role: 'system',
      content: `Conversation exceeded maximum turns (${this.maxTurns})`,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a tool call and return the result string.
   * This is the public API for external callers that want to handle
   * tool execution outside the loop.
   */
  async handleToolCall(
    toolCallId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    if (!this.toolHandler) {
      throw new Error('No tool handler configured');
    }

    const result = await this.toolHandler(name, input);

    // Add to message history
    this.messages.push({
      role: 'tool',
      content: result,
      tool_call_id: toolCallId,
    });

    return result;
  }

  /**
   * Stop the current generation.
   */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

function buildDefaultSystemPrompt(mode: TaskMode, cwd: string): string {
  const base = `You are an AI coding assistant. Working directory: ${cwd}`;
  if (mode === 'plan') {
    return `${base}\n\nYou are in PLAN mode. Analyze the codebase, explain your reasoning, and suggest changes. Do NOT make any modifications.`;
  }
  return `${base}\n\nYou are in ACT mode. You can use tools to read, write, and modify files. Execute the user's request.`;
}

function toReasoningEffort(thinking: ThinkingLevel, model: string): 'low' | 'medium' | 'high' | 'xhigh' {
  if (thinking === 'xhigh' && !supportsExtraHighReasoning(model)) {
    return 'high';
  }
  return thinking;
}

function supportsExtraHighReasoning(model: string): boolean {
  return /^gpt-5\.[234]/.test(model) || /^gpt-5-pro/.test(model) || /codex-max/.test(model);
}
