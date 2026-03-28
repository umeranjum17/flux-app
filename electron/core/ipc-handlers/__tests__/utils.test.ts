import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAttachmentContextPrompt,
  buildPromptWithAttachments,
  buildWorkspaceSystemContext,
  extractLatestSessionAttachmentContext,
  getStepTrackableContent,
  extractTodoItemsFromPayload,
  isTodoTrackingToolCall,
  parseAgentTodos,
  parseFluxTodo,
  parseFluxTodoAll,
  parseStepMarkers,
  parseTodoBlock,
  writeAttachmentContextFile,
} from '../utils';
import type { AgentMessage } from '../../agents/types';
import type { WorkspaceFs } from '../../worktree/workspace-fs';
import type { Workspace } from '../../worktree/types';
import * as workspaceFsModule from '../../worktree/workspace-fs';

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Hardening pass',
  parentRepo: '/repo',
  worktreePath: '/repo/.flux-worktrees/ws-1',
  branch: 'flux-hardening',
  agentId: 'codex',
  model: 'gpt-5.4',
  mode: 'act',
  status: 'idle',
  outcome: 'in_progress',
  createdAt: 1,
  updatedAt: 1,
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseStepMarkers', () => {
  it('extracts START markers', () => {
    expect(parseStepMarkers('[STEP 1 START]')).toEqual([
      { stepId: 1, status: 'in_progress' },
    ]);
  });

  it('extracts DONE markers', () => {
    expect(parseStepMarkers('[STEP 3 DONE]')).toEqual([
      { stepId: 3, status: 'done' },
    ]);
  });

  it('handles both START and DONE for the same step — DONE wins', () => {
    const markers = parseStepMarkers('[STEP 2 START] some work [STEP 2 DONE]');
    expect(markers).toEqual([{ stepId: 2, status: 'done' }]);
  });

  it('extracts multiple different steps', () => {
    const markers = parseStepMarkers(
      'Starting [STEP 1 DONE] now [STEP 2 START] and [STEP 3 START]',
    );
    expect(markers).toHaveLength(3);
    expect(markers).toContainEqual({ stepId: 1, status: 'done' });
    expect(markers).toContainEqual({ stepId: 2, status: 'in_progress' });
    expect(markers).toContainEqual({ stepId: 3, status: 'in_progress' });
  });

  it('is case-insensitive', () => {
    expect(parseStepMarkers('[step 1 done]')).toEqual([
      { stepId: 1, status: 'done' },
    ]);
    expect(parseStepMarkers('[Step 2 Start]')).toEqual([
      { stepId: 2, status: 'in_progress' },
    ]);
  });

  it('handles extra whitespace in markers', () => {
    expect(parseStepMarkers('[STEP  5  DONE]')).toEqual([
      { stepId: 5, status: 'done' },
    ]);
  });

  it('returns empty for no markers', () => {
    expect(parseStepMarkers('just some regular text')).toEqual([]);
    expect(parseStepMarkers('')).toEqual([]);
  });

  it('extracts label from START marker with colon', () => {
    expect(parseStepMarkers('[STEP 1 START: Set up database schema]')).toEqual([
      { stepId: 1, status: 'in_progress', label: 'Set up database schema' },
    ]);
  });

  it('preserves label when DONE wins over START', () => {
    const markers = parseStepMarkers('[STEP 2 START: Add API endpoints] work [STEP 2 DONE]');
    expect(markers).toEqual([{ stepId: 2, status: 'done', label: 'Add API endpoints' }]);
  });

  it('handles START without label (undefined)', () => {
    const markers = parseStepMarkers('[STEP 3 START]');
    expect(markers[0].label).toBeUndefined();
  });

  it('handles mixed labeled and unlabeled markers', () => {
    const markers = parseStepMarkers(
      '[STEP 1 START: Fix auth] done [STEP 1 DONE] [STEP 2 START]',
    );
    expect(markers).toHaveLength(2);
    expect(markers).toContainEqual({ stepId: 1, status: 'done', label: 'Fix auth' });
    expect(markers).toContainEqual({ stepId: 2, status: 'in_progress', label: undefined });
  });
});

describe('getStepTrackableContent', () => {
  it('returns content for assistant text messages', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'assistant',
      content: 'hello [STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBe('hello [STEP 1 START]');
  });

  it('returns content for status messages', () => {
    const msg: AgentMessage = {
      type: 'status',
      role: 'system',
      content: 'Checking workspace [STEP 1 DONE]',
      timestamp: Date.now(),
      statusKind: 'progress',
    };
    expect(getStepTrackableContent(msg)).toBe('Checking workspace [STEP 1 DONE]');
  });

  it('returns content for tool_result messages', () => {
    const msg: AgentMessage = {
      type: 'tool_result',
      role: 'tool',
      content: 'Output [STEP 2 DONE]',
      timestamp: Date.now(),
      toolCallId: 'tc-1',
    };
    expect(getStepTrackableContent(msg)).toBe('Output [STEP 2 DONE]');
  });

  it('returns null for user messages', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'user',
      content: '[STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });

  it('returns null for thinking messages', () => {
    const msg: AgentMessage = {
      type: 'thinking',
      role: 'assistant',
      content: '[STEP 1 START]',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });

  it('returns null for empty content', () => {
    const msg: AgentMessage = {
      type: 'text',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    expect(getStepTrackableContent(msg)).toBeNull();
  });
});

describe('extractTodoItemsFromPayload', () => {
  it('normalizes update_plan payloads into todo items', () => {
    expect(extractTodoItemsFromPayload({
      plan: [
        { step: 'Inspect Codex event payloads', status: 'completed' },
        { step: 'Sync renderer todo bar', status: 'in_progress' },
      ],
    })).toEqual([
      { id: 1, label: 'Inspect Codex event payloads', status: 'done' },
      { id: 2, label: 'Sync renderer todo bar', status: 'in_progress' },
    ]);
  });
});

describe('isTodoTrackingToolCall', () => {
  it('recognizes update_plan tool calls with plan items', () => {
    expect(isTodoTrackingToolCall('update_plan', {
      plan: [{ step: 'Ship the fix', status: 'pending' }],
    })).toBe(true);
  });

  it('recognizes TodoWrite by name', () => {
    expect(isTodoTrackingToolCall('TodoWrite', {
      todos: [{ content: 'Do something', status: 'pending' }],
    })).toBe(true);
  });

  it('recognizes tool calls with explicit todos key', () => {
    expect(isTodoTrackingToolCall('some_custom_tool', {
      todos: [{ content: 'A task', status: 'pending' }],
    })).toBe(true);
  });

  it('does NOT match unrelated tools with items/steps/tasks keys', () => {
    expect(isTodoTrackingToolCall('Glob', {
      items: ['file1.ts', 'file2.ts'],
    })).toBe(false);

    expect(isTodoTrackingToolCall('BatchProcess', {
      steps: [{ title: 'Step one' }, { title: 'Step two' }],
    })).toBe(false);

    expect(isTodoTrackingToolCall('Read', {
      tasks: [{ text: 'something' }],
    })).toBe(false);
  });
});

describe('parseFluxTodo', () => {
  it('parses FLUX_TODO: JSON lines', () => {
    const items = parseFluxTodo('FLUX_TODO:{"todos":[{"label":"Step one","status":"done"}]}');
    expect(items).toEqual([{ id: 1, label: 'Step one', status: 'done' }]);
  });

  it('still parses legacy FLUX_PROGRESS: JSON lines', () => {
    const items = parseFluxTodo('FLUX_PROGRESS:{"todos":[{"label":"Legacy step","status":"pending"}]}');
    expect(items).toEqual([{ id: 1, label: 'Legacy step', status: 'pending' }]);
  });

  it('returns null for unrelated content', () => {
    expect(parseFluxTodo('just some text')).toBeNull();
  });
});

describe('parseFluxTodoAll', () => {
  it('returns items from the last FLUX_TODO line', () => {
    const content = [
      'FLUX_TODO:{"todos":[{"label":"A","status":"done"}]}',
      'some other text',
      'FLUX_TODO:{"todos":[{"label":"A","status":"done"},{"label":"B","status":"in_progress"}]}',
    ].join('\n');
    const items = parseFluxTodoAll(content);
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ id: 2, label: 'B', status: 'in_progress' });
  });

  it('handles mixed FLUX_TODO and legacy FLUX_PROGRESS lines', () => {
    const content = [
      'FLUX_PROGRESS:{"todos":[{"label":"Old","status":"done"}]}',
      'FLUX_TODO:{"todos":[{"label":"New","status":"in_progress"}]}',
    ].join('\n');
    const items = parseFluxTodoAll(content);
    expect(items).toEqual([{ id: 1, label: 'New', status: 'in_progress' }]);
  });
});

describe('parseTodoBlock', () => {
  it('parses ```todo fenced blocks', () => {
    const content = '```todo\n- [x] First step\n- [ ] Second step\n```';
    const items = parseTodoBlock(content);
    expect(items).toEqual([
      { id: 1, label: 'First step', status: 'done' },
      { id: 2, label: 'Second step', status: 'pending' },
    ]);
  });

  it('still parses legacy ```progress fenced blocks', () => {
    const content = '```progress\n- [x] Done step\n- [>] Active step\n```';
    const items = parseTodoBlock(content);
    expect(items).toEqual([
      { id: 1, label: 'Done step', status: 'done' },
      { id: 2, label: 'Active step', status: 'in_progress' },
    ]);
  });

  it('returns empty for no blocks', () => {
    expect(parseTodoBlock('no blocks here')).toEqual([]);
  });
});

describe('parseAgentTodos', () => {
  it('returns flux_todo source for FLUX_TODO lines', () => {
    const result = parseAgentTodos('FLUX_TODO:{"todos":[{"label":"Step","status":"pending"}]}');
    expect(result.source).toBe('flux_todo');
    expect(result.items).toHaveLength(1);
  });

  it('returns todo_block source for fenced todo blocks', () => {
    const result = parseAgentTodos('```todo\n- [ ] A task\n- [ ] Another\n```');
    expect(result.source).toBe('todo_block');
    expect(result.items).toHaveLength(2);
  });

  it('returns flux_todo source for legacy FLUX_PROGRESS lines', () => {
    const result = parseAgentTodos('FLUX_PROGRESS:{"todos":[{"label":"Old","status":"done"}]}');
    expect(result.source).toBe('flux_todo');
    expect(result.items).toHaveLength(1);
  });

  it('returns none when no patterns match', () => {
    const result = parseAgentTodos('just regular text');
    expect(result.source).toBe('none');
    expect(result.items).toEqual([]);
  });
});

describe('buildWorkspaceSystemContext', () => {
  it('injects the merge skill for merge tasks', () => {
    const prompt = buildWorkspaceSystemContext(workspace, 'act', {
      workspaceAction: 'merge',
      merge: {
        targetBranch: 'main',
        squash: true,
      },
      agentId: 'codex',
    });

    expect(prompt).toContain('<flux-skill name="merge" mode="act">');
    expect(prompt).toContain('git pull --no-rebase origin main');
    expect(prompt).toContain('git push origin HEAD:main');
    expect(prompt).toContain('<flux-skill name="todo">');
    expect(prompt).not.toContain('<flux-skill name="workspace"');
  });

  it('throws when merge context is missing for merge tasks', () => {
    expect(() => buildWorkspaceSystemContext(workspace, 'act', {
      workspaceAction: 'merge',
      agentId: 'codex',
    })).toThrow('Missing merge context for workspace merge task');
  });

  it('mentions persisted attachments for workspace act runs', () => {
    const prompt = buildWorkspaceSystemContext(workspace, 'act', {
      agentId: 'codex',
    });

    expect(prompt).toContain('.context/attachments.json');
  });
});

describe('attachment context helpers', () => {
  it('writes attachment context markdown and persisted images', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-attachments-'));
    tempDirs.push(cwd);
    const sourceFile = path.join(cwd, 'notes.txt');
    fs.writeFileSync(sourceFile, 'first line\nsecond line\n', 'utf-8');

    const result = await writeAttachmentContextFile(cwd, {
      host: null,
      images: ['data:image/png;base64,aGVsbG8='],
      attachments: [{ path: sourceFile, name: 'notes.txt' }],
    });

    expect(result).not.toBeNull();
    expect(result?.promptPath).toBe('.context/attachments.md');
    expect(fs.existsSync(path.join(cwd, '.context', 'attachments.md'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.context', 'attachments', 'image-1.png'))).toBe(true);

    const content = fs.readFileSync(path.join(cwd, '.context', 'attachments.md'), 'utf-8');
    expect(content).toContain('# Attachment Context');
    expect(content).toContain('notes.txt');
    expect(content).toContain('first line');
    expect(content).toContain('attachments/image-1.png');

    // JSON manifest should be written alongside the markdown
    expect(result?.manifestPath).toBe('.context/attachments.json');
    expect(fs.existsSync(path.join(cwd, '.context', 'attachments.json'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, '.context', 'attachments.json'), 'utf-8'));
    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest.length).toBe(2);
    const imageEntry = manifest.find((e: any) => e.type === 'image');
    expect(imageEntry).toBeDefined();
    expect(imageEntry.diskPath).toContain('attachments/image-1.png');
    const fileEntry = manifest.find((e: any) => e.type === 'file');
    expect(fileEntry).toBeDefined();
    expect(fileEntry.name).toBe('notes.txt');
  });

  it('only counts images that were successfully materialized', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-attachments-'));
    tempDirs.push(cwd);

    const result = await writeAttachmentContextFile(cwd, {
      host: null,
      images: ['data:image/png;base64,aGVsbG8=', 'not-a-data-url'],
      attachments: [],
    });

    expect(result?.imageCount).toBe(1);
    const content = fs.readFileSync(path.join(cwd, '.context', 'attachments.md'), 'utf-8');
    expect(content).toContain('1 could not be materialized');
  });

  it('writes attachment context for SSH workspaces via WorkspaceFs', async () => {
    const writeFileCalls: Array<{ filePath: string; content: string }> = [];
    const writeBufferCalls: Array<{ filePath: string; content: Uint8Array }> = [];
    const fakeWfs: WorkspaceFs = {
      isRemote: true,
      host: 'dev@example',
      git: async () => ({ stdout: '', stderr: '' }),
      readFile: async () => null,
      writeFile: async (filePath, content) => {
        writeFileCalls.push({ filePath, content });
      },
      writeBuffer: async (filePath, content) => {
        writeBufferCalls.push({ filePath, content });
      },
      exists: async () => false,
      listDir: async () => [],
      mkdirp: async () => {},
      rmrf: async () => {},
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      diskUsage: async () => 0,
    };

    const createWorkspaceFsSpy = vi
      .spyOn(workspaceFsModule, 'createWorkspaceFs')
      .mockReturnValue(fakeWfs);

    try {
      const cwd = '/remote/worktree';
      const attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-remote-attachments-'));
      tempDirs.push(attachmentDir);
      const sourceFile = path.join(attachmentDir, 'notes.txt');
      fs.writeFileSync(sourceFile, 'remote preview text\n', 'utf-8');

      const result = await writeAttachmentContextFile(cwd, {
        host: 'dev@example',
        images: ['data:image/png;base64,aGVsbG8='],
        attachments: [{ path: sourceFile, name: 'notes.txt' }],
      });

      expect(result).not.toBeNull();
      expect(createWorkspaceFsSpy).toHaveBeenCalledWith('dev@example');
      expect(result?.absolutePath).toBe('/remote/worktree/.context/attachments.md');
      expect(result?.manifestPath).toBe('.context/attachments.json');
      expect(writeBufferCalls).toHaveLength(1);
      expect(writeBufferCalls[0].filePath).toBe('/remote/worktree/.context/attachments/image-1.png');
      expect(Buffer.from(writeBufferCalls[0].content).toString()).toBe('hello');
      expect(writeFileCalls.map((call) => call.filePath)).toEqual([
        '/remote/worktree/.context/attachments.md',
        '/remote/worktree/.context/attachments.json',
      ]);
      expect(writeFileCalls[0].content).toContain('attachments/image-1.png');
      expect(writeFileCalls[1].content).toContain('"type": "image"');
      expect(writeFileCalls[1].content).toContain('"type": "file"');
    } finally {
      createWorkspaceFsSpy.mockRestore();
    }
  });

  it('builds a prompt note for persisted attachment context', () => {
    expect(buildAttachmentContextPrompt({
      absolutePath: '/repo/.context/attachments.md',
      promptPath: '.context/attachments.md',
      manifestPath: '.context/attachments.json',
      imageCount: 1,
      attachmentCount: 2,
    })).toContain('.context/attachments.md');
  });

  it('builds prompt attachment previews from local files', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-attachment-prompt-'));
    tempDirs.push(cwd);
    const sourceFile = path.join(cwd, 'notes.txt');
    fs.writeFileSync(sourceFile, 'first line\nsecond line\n', 'utf-8');

    const prompt = await buildPromptWithAttachments('Ship it', [{ path: sourceFile, name: 'notes.txt' }]);

    expect(prompt).toContain('Attached file context');
    expect(prompt).toContain('notes.txt');
    expect(prompt).toContain('first line');
    expect(prompt).toContain('User request:\nShip it');
  });

  it('extracts the latest stored user attachment context from payloadJson', () => {
    const sessionStore = {
      getMessages: () => [
        {
          role: 'user',
          type: 'text',
          payloadJson: JSON.stringify({
            type: 'text',
            role: 'user',
            content: 'Earlier',
            attachments: [{ path: '/repo/old.ts', name: 'old.ts' }],
            timestamp: 1,
          }),
        },
        {
          role: 'assistant',
          type: 'text',
          payloadJson: null,
        },
        {
          role: 'user',
          type: 'text',
          payloadJson: JSON.stringify({
            type: 'text',
            role: 'user',
            content: 'Latest',
            images: ['data:image/png;base64,abc'],
            attachments: [{ path: '/repo/new.ts', name: 'new.ts' }],
            timestamp: 2,
          }),
        },
      ],
    } as any;

    expect(extractLatestSessionAttachmentContext(sessionStore, 'session-1')).toEqual({
      images: ['data:image/png;base64,abc'],
      attachments: [{ path: '/repo/new.ts', name: 'new.ts' }],
    });
  });
});
