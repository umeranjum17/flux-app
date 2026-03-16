import { EventEmitter } from 'events';

export type AgentId = 'claude-code' | 'codex' | 'gemini' | 'openai' | 'ollama';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type TaskMode = 'plan' | 'act';

export interface FileAttachment {
  path: string;
  name: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
  value?: string;
}

export interface QuestionField {
  header?: string;
  question: string;
  options?: QuestionOption[];
  allowFreeform?: boolean;
  placeholder?: string;
  multiSelect?: boolean;
}

export interface AgentMessage {
  type: 'text' | 'status' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'result' | 'permission_request' | 'question_request' | 'rate_limit' | 'quality_gate';
  role: MessageRole;
  content: string;
  timestamp: number;
  statusKind?: 'spawn' | 'startup' | 'progress' | 'diagnostic';
  subagentId?: string;
  subagentName?: string;
  subagentStatus?: 'spawning' | 'running' | 'done' | 'error';
  subagentToolCount?: number;
  subagentTokens?: {
    input: number;
    output: number;
  };
  // For tool calls
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  // For tool results
  isError?: boolean;
  // For permission requests
  requestId?: string;
  action?: string;
  filePath?: string;
  options?: QuestionOption[];
  questions?: QuestionField[];
  allowFreeform?: boolean;
  placeholder?: string;
  // For results
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  // For file edits
  diff?: string;
  oldContent?: string;
  newContent?: string;
  // For image attachments
  images?: string[];
  attachments?: FileAttachment[];
  // For quality gates
  command?: string;
  exitCode?: number;
  passed?: boolean;
  stdout?: string;
  stderr?: string;
  retryAttempt?: number;
  maxRetries?: number;
  isPreExisting?: boolean;
  // For rate limits
  rateLimitInfo?: {
    providerId?: 'claude-code' | 'codex';
    status: string;
    resetsAt: number;
    rateLimitType: string;
    utilization: number;
    overageStatus?: string;
    overageResetsAt?: number;
    fetchedAt?: number;
  };
}

export interface SpawnOptions {
  taskId: string;
  workspaceId?: string; // If set, agent runs inside this workspace's worktree
  prompt: string;
  model?: string;
  mode: TaskMode;
  thinking?: ThinkingLevel;
  cwd: string;
  sessionId?: string;
  resumeSessionId?: string;
  images?: string[]; // base64 encoded
  attachments?: FileAttachment[];
  contextBlock?: string; // Injected repo map context (for logging/diagnostics)
  binaryPath?: string; // Resolved absolute path to the agent binary
  sshHost?: string;      // e.g., "umera@extreme" — spawn agent over SSH
  remoteCwd?: string;    // Remote working directory for SSH mode
  dangerouslyBypassPermissions?: boolean; // Disable agent sandboxing for externally sandboxed runs
  parentTaskId?: string;
  subagentName?: string;
  /** Pre-built conversation context to inject if native session resume fails. */
  fallbackContext?: string;
}

export interface AgentHandle extends EventEmitter {
  taskId: string;
  agentId: AgentId;
  /** PID of the underlying child process, if available. */
  pid?: number;
  stop(): Promise<void>;
  approve(requestId: string): void;
  deny(requestId: string): void;
  steer(prompt: string, images?: string[]): void;
  answerQuestion(requestId: string, response: string): void;
  /** Returns true if the underlying process is still running. */
  isAlive(): boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface DetectedAgent {
  id: AgentId;
  name: string;
  path: string;
  version: string;
  available: boolean;
  models: string[];
  supportsThinking: boolean;
  authStatus: 'authenticated' | 'unauthenticated' | 'unknown';
  envKeys: string[];
}

export interface AuthResult {
  authenticated: boolean;
  message: string;
}

export const PLAN_FORMAT_PREAMBLE = `You are a senior software architect creating a detailed, visual implementation plan. Produce a well-structured GFM markdown document that is self-contained, rich, and directly importable into Notion or exportable as PDF/markdown.

Format your response using the following sections:

## Summary

One clear paragraph describing **what** changes, **why**, and the **expected outcome**. If the change spans multiple components or services, include a Mermaid architecture or component diagram:

\`\`\`mermaid
graph TD
  A[Component] --> B[Component]
\`\`\`

## Analysis

Thorough examination of the current state: relevant files, constraints, dependencies, and risks. Reference specific files and line numbers with inline code (\`path/to/file.ts:42\`).

When comparing approaches or technologies, use a table:

| Approach | Pros | Cons |
|----------|------|------|
| Option A | ... | ... |

If the change involves state transitions, data flow, or sequencing, include a Mermaid sequence or flowchart diagram.

## Steps

Numbered, actionable implementation steps. For each step include:

1. **Step title**
   - **File:** \`path/to/file.ts\`
   - **Change:** What to add, modify, or remove — include brief code snippets for non-trivial logic.
   - **Reason:** Why this change is needed.

Group related file changes under the same step. Order steps by dependency so they can be executed sequentially.

## Verification

How to validate the implementation is correct:
- Commands to run (typecheck, lint, tests) with expected output.
- Manual testing steps and expected behavior.
- Edge cases to watch for.
- Metrics or logs to check if applicable.

## Trade-offs

Alternatives that were considered. For each alternative, briefly state pros/cons and why the chosen approach wins. Use a table or bullet list.

---

**Formatting guidelines:**
- Use GFM tables, \`\`\`mermaid\`\`\` diagrams, and fenced code blocks liberally.
- Reference files as \`path/to/file.ts:lineNumber\` with inline code.
- Bold key terms and section labels for scannability.
- Keep the plan self-contained — a reader should understand the full scope without external context.`;
