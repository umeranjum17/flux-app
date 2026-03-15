import { ipcMain } from 'electron';
import crypto from 'crypto';

import { agentManager } from '../agents/manager';
import { findLatestCodexSession } from '../agents/codex-utils';
import type { AgentHandle, AgentId, AgentMessage, FileAttachment, SpawnOptions } from '../agents/types';
import { isInteractiveToolName } from '../agents/claude';
import { StallMonitor } from '../agents/stall-monitor';
import { repoMapService } from '../intelligence/repomap';
import { createCheckpoint, listCheckpoints } from '../checkpoint/manager';
import { extendedEnv, resolveSshCommand, classifySpawnError } from '../process-utils';
import type { WorkspaceStatus } from '../worktree/types';
import type { BaseIpcContext, SpawnTaskRunOptions } from './types';
import {
  MAX_AUTO_RETRIES,
  RECOVERY_DELAY_MS,
  AGENTS_WITH_NATIVE_RESUME,
  requireFields,
  buildSessionTitle,
  getAgentLabel,
  toStoredMessage,
  isRecord,
  readAgentSessionId,
  runShellCommand,
  buildUserMessagePayload,
  buildStoredUserMessage,
  buildPromptWithAttachments,
  buildWorkspaceSystemContext,
  buildConversationContext,
  extractFullPlanText,
  writePlanFile,
  extractPlanTodoItems,
  buildStepTrackingPrompt,
  captureGitSnapshot,
  captureGitDiff,
  normalizeRateLimitInfo,
  workspaceHasPendingChanges,
  isWorkspaceBranchMerged,
  parseStepMarkers,
  getStepTrackableContent,
} from './utils';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function registerTaskHandlers(ctx: BaseIpcContext): {
  spawnTaskRun: (options: SpawnTaskRunOptions) => Promise<{ taskId: string; session: any }>;
} {
  const {
    mainWindow,
    sessionStore,
    configManager,
    usageTracker,
    workspaceStore,
    sendToRenderer,
    emitWorkspaceStatus,
    emitWorkspaceOutcome,
    updateWorkspaceTaskStatus,
    releaseWorkspaceTask,
    activeTasks,
    taskSessions,
    taskWorkspaceMap,
    taskWorkspaceStatusMap,
    cleaningUp,
    taskIdleHeartbeats,
    taskStallMonitors,
    taskRetryCounts,
    activeSubagents,
    cachedRateLimits,
    getCurrentCwd,
    getLocalCwd,
    getSshHost,
  } = ctx;

  const resolveQualityGateCommands = async (_cwd: string): Promise<string[]> => {
    return configManager.get().qualityGateCommands
      .map((command: string) => command.trim())
      .filter(Boolean);
  };

  const emitQualityGateMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    sendToRenderer('agent:message', { taskId, message });
  };

  const emitTaskMessage = (taskId: string, sessionId: string, message: AgentMessage) => {
    sessionStore.addMessage(sessionId, toStoredMessage(message));
    sendToRenderer('agent:message', { taskId, message });
  };

  const emitSubagentMessage = (
    parentTaskId: string,
    subagentId: string,
    subagentName: string,
    message: AgentMessage,
  ) => {
    const payload: AgentMessage = {
      ...message,
      subagentId,
      subagentName,
      ...(message.subagentStatus ? {} : { subagentStatus: 'running' }),
    };
    sendToRenderer('agent:message', { taskId: parentTaskId, message: payload });
  };

  const persistAgentSessionId = (sessionId: string, agentId: AgentId, agentSessionId: string) => {
    const current = sessionStore.get(sessionId);
    if (!current) return;

    const baseMetadata = current.metadata ?? {};
    const currentAgentSessions = isRecord(baseMetadata.agentSessions)
      ? baseMetadata.agentSessions
      : {};
    const metadata = {
      ...baseMetadata,
      agentSessions: {
        ...currentAgentSessions,
        [agentId]: {
          sessionId: agentSessionId,
        },
      },
    };

    sessionStore.update(sessionId, { metadata });
  };

  const recordWorkspaceCheckpoint = async (workspaceId: string, prompt: string, sessionId: string) => {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) return;

    const checkpoint = await createCheckpoint(
      workspace.worktreePath,
      workspaceId,
      sessionId,
      listCheckpoints(workspaceId).length + 1,
      buildSessionTitle(prompt),
    );
    sendToRenderer('workspace:checkpoint', { workspaceId, checkpoint });
  };

  /** Clean up a task's resources without emitting agent:done (used by stall monitor). */
  const cleanupTask = (taskId: string) => {
    const handle = activeTasks.get(taskId);
    if (handle) {
      handle.removeAllListeners();
      void handle.stop();
    }
    activeTasks.delete(taskId);
    taskSessions.delete(taskId);
    taskWorkspaceStatusMap.delete(taskId);
    taskWorkspaceMap.delete(taskId);
    taskRetryCounts.delete(taskId);
    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    cleaningUp.delete(taskId);
  };

  /** Stop the current agent and respawn with conversation context. */
  const triggerAutoRecovery = async (
    taskId: string,
    sessionId: string,
    agentId: AgentId,
    originalOptions: SpawnTaskRunOptions,
  ) => {
    const retryCount = taskRetryCounts.get(taskId) ?? 0;
    taskRetryCounts.set(taskId, retryCount + 1);

    const monitor = taskStallMonitors.get(taskId);
    if (monitor) {
      monitor.recordRestart();
      monitor.dispose();
    }

    emitTaskMessage(taskId, sessionId, {
      type: 'status',
      role: 'system',
      statusKind: 'progress',
      content: `Auto-recovering stalled session (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})...`,
      timestamp: Date.now(),
    });

    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
    }
    activeTasks.delete(taskId);
    taskSessions.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }

    await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));

    try {
      const context = buildConversationContext(sessionId, sessionStore);
      await spawnTaskRun({
        ...originalOptions,
        sessionId,
        fallbackContext: context || undefined,
        prompt: '[Resuming previous session]',
      });
    } catch (err) {
      sendToRenderer('agent:done', {
        taskId,
        error: `Recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      cleanupTask(taskId);
    }
  };

  const spawnTaskRun = async (
    options: SpawnTaskRunOptions,
  ): Promise<{ taskId: string; session: any }> => {
    requireFields(options as unknown as Record<string, unknown>, 'taskId', 'prompt', 'cwd');
    const agentId = (options.agentId ?? 'claude-code') as AgentId;
    const sshHost = getSshHost();
    const localCwd = getLocalCwd();
    const workspace = options.workspaceId
      ? workspaceStore.get(options.workspaceId)
      : workspaceStore.get(options.taskId);
    if (activeTasks.has(options.taskId)) {
      for (const [subagentId, subagent] of activeSubagents.entries()) {
        if (subagent.parentTaskId !== options.taskId) continue;
        await subagent.handle.stop();
        subagent.handle.removeAllListeners();
        activeSubagents.delete(subagentId);
        activeTasks.delete(subagentId);
        taskSessions.delete(subagentId);
      }
      const staleHandle = activeTasks.get(options.taskId)!;
      await staleHandle.stop();
      await new Promise(resolve => setTimeout(resolve, 500));
      staleHandle.removeAllListeners();
      activeTasks.delete(options.taskId);
      taskSessions.delete(options.taskId);
      taskWorkspaceStatusMap.delete(options.taskId);
      taskWorkspaceMap.delete(options.taskId);
      cleaningUp.delete(options.taskId);
      if (taskIdleHeartbeats.has(options.taskId)) {
        clearInterval(taskIdleHeartbeats.get(options.taskId)!);
        taskIdleHeartbeats.delete(options.taskId);
      }
    }

    let effectivePrompt = await buildPromptWithAttachments(options.prompt, options.attachments, sshHost);

    const repoMapConfig = configManager.get().repoMap;
    if (repoMapConfig.enabled && repoMapConfig.perAgentEnabled[agentId] !== false) {
      try {
        const repoMap = await repoMapService.getMap(effectivePrompt, repoMapConfig.maxTokens);
        if (repoMap) {
          options.contextBlock = repoMap;
          effectivePrompt = repoMap + '\n\n' + effectivePrompt;
        }
      } catch {
        // Repo map generation failed — continue without it
      }
    }

    const existingSession = options.sessionId ? sessionStore.get(options.sessionId) : null;
    const session = existingSession ?? sessionStore.create({
      title: workspace ? `[WS] ${workspace.name}` : buildSessionTitle(options.prompt),
      agentId,
      model: options.model ?? '',
      mode: options.mode,
      cwd: options.cwd,
      metadata: workspace ? { workspaceId: workspace.id } : {},
    });
    const startedAt = Date.now();
    const existingAgentSessionId = readAgentSessionId(existingSession?.metadata, agentId);
    const spawnCwd = sshHost ? localCwd : options.cwd;

    const claudeResumeId = sshHost
      ? existingAgentSessionId
      : session.id;

    const fallbackContext = existingSession
      ? buildConversationContext(session.id, sessionStore)
      : undefined;

    if (workspace && !existingSession) {
      const wsContext = buildWorkspaceSystemContext(workspace, options.mode, options.workspaceAction, agentId);
      if (wsContext) {
        effectivePrompt = `${wsContext}\n\n${effectivePrompt}`;
      }
    }

    const spawnOptions: SpawnOptions = {
      ...options,
      cwd: spawnCwd,
      remoteCwd: sshHost ? options.cwd : undefined,
      sshHost: sshHost ?? undefined,
      dangerouslyBypassPermissions: agentId === 'claude-code'
        || (agentId === 'codex' && options.mode === 'act')
        || options.workspaceAction === 'merge',
      prompt: effectivePrompt,
      sessionId: agentId === 'claude-code' ? session.id : options.sessionId,
      resumeSessionId: agentId === 'codex'
        ? existingAgentSessionId
        : agentId === 'claude-code'
          ? claudeResumeId
          : undefined,
      fallbackContext: fallbackContext || undefined,
    };
    let detectedCodexSessionId: string | undefined = existingAgentSessionId;

    if (sshHost) {
      try {
        await execFileAsync(
          resolveSshCommand(),
          ['-o', 'ConnectTimeout=3', '-o', 'BatchMode=yes', sshHost, 'echo', 'ok'],
          { timeout: 5000, env: extendedEnv() },
        );
      } catch (err: any) {
        const info = classifySpawnError(err as Error, { command: 'ssh', sshHost });
        if (!existingSession) {
          sessionStore.delete(session.id);
        }
        throw new Error(`SSH connection failed: ${info.userMessage}${info.suggestion ? `. ${info.suggestion}` : ''}`);
      }
    }

    const resumeMessages = (agentId === 'openai' && existingSession)
      ? sessionStore.getMessages(session.id)
      : undefined;

    let pendingTodoItems: Array<{ id: number; label: string; status: 'pending' | 'in_progress' | 'done' }> | null = null;

    const isAgentSwitch = existingSession && existingSession.agentId !== agentId;
    if (isAgentSwitch) {
      const fromAgent = getAgentLabel(existingSession.agentId as AgentId);
      if (existingSession.mode === 'plan' && options.mode === 'act') {
        const planText = extractFullPlanText(sessionStore, session.id);
        const planPath = await writePlanFile(options.cwd, planText);
        const planSteps = extractPlanTodoItems(sessionStore, session.id);
        const stepTracking = buildStepTrackingPrompt(planSteps, agentId);
        spawnOptions.prompt = [
          `You are implementing a plan created by ${fromAgent}. The approved plan is below.`,
          planPath ? `The full plan is also saved at \`${planPath}\`.` : '',
          '',
          planText ? `## Approved Plan\n\n${planText}` : '',
          stepTracking,
          '',
          `## User instruction`,
          spawnOptions.prompt,
        ].filter(Boolean).join('\n');

        if (planSteps.length > 0) {
          pendingTodoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
        }
      } else {
        const context = buildConversationContext(session.id, sessionStore);
        if (context) {
          spawnOptions.prompt = [
            `You are continuing a conversation previously handled by ${fromAgent}. Here is the context:`,
            '',
            context,
            '',
            `## Current request`,
            spawnOptions.prompt,
          ].join('\n');
        }
      }
    }

    const hasWorkingResume = AGENTS_WITH_NATIVE_RESUME.has(agentId) && !!spawnOptions.resumeSessionId;
    if (existingSession && !isAgentSwitch && !hasWorkingResume) {
      const isPlanToAct = existingSession.mode === 'plan' && options.mode === 'act';
      if (isPlanToAct) {
        const planText = extractFullPlanText(sessionStore, session.id);
        const planPath = await writePlanFile(options.cwd, planText);
        const planSteps = extractPlanTodoItems(sessionStore, session.id);
        const stepTracking = buildStepTrackingPrompt(planSteps, agentId);
        spawnOptions.prompt = [
          'You are implementing an approved plan. The full plan is below.',
          planPath ? `The plan is also saved at \`${planPath}\`.` : '',
          '',
          planText ? `## Approved Plan\n\n${planText}` : '',
          stepTracking,
          '',
          `## Current request`,
          spawnOptions.prompt,
        ].filter(Boolean).join('\n');

        if (planSteps.length > 0) {
          pendingTodoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
        }
      } else {
        const context = buildConversationContext(session.id, sessionStore);
        if (context) {
          spawnOptions.prompt = [
            `You are continuing a previous conversation. Here is the context:`,
            '',
            context,
            '',
            `## Current request`,
            spawnOptions.prompt,
          ].join('\n');
        }
      }
    }

    if (existingSession && !isAgentSwitch && existingSession.mode === 'plan' && options.mode === 'act' && hasWorkingResume) {
      const planText = extractFullPlanText(sessionStore, session.id);
      const planPath = await writePlanFile(options.cwd, planText);
      const planSteps = extractPlanTodoItems(sessionStore, session.id);
      const stepTracking = buildStepTrackingPrompt(planSteps, agentId);
      spawnOptions.prompt = [
        'The user reviewed and approved the plan above. Implement each step now.',
        planPath ? `The full plan is also saved at \`${planPath}\`.` : '',
        stepTracking,
        '',
        spawnOptions.prompt,
      ].filter(Boolean).join('\n');

      if (planSteps.length > 0) {
        pendingTodoItems = planSteps.map((s, i) => ({ id: i + 1, label: s.label, status: 'pending' as const }));
      }
    }

    if (existingSession && !isAgentSwitch && AGENTS_WITH_NATIVE_RESUME.has(agentId) && !spawnOptions.resumeSessionId) {
      emitTaskMessage(options.taskId, session.id, {
        type: 'status',
        role: 'system',
        statusKind: 'progress',
        content: 'Continuing with conversation context (session resume unavailable)',
        timestamp: Date.now(),
      });
    }

    const preRunRef = await captureGitSnapshot(options.cwd);

    const qualityGateBaseline = new Map<string, boolean>();
    if (options.mode === 'act' && !sshHost) {
      const baselineCommands = await resolveQualityGateCommands(options.cwd);
      for (const cmd of baselineCommands) {
        const baseResult = await runShellCommand(cmd, options.cwd, sshHost);
        qualityGateBaseline.set(cmd, baseResult.exitCode === 0);
      }
    }

    let handle: AgentHandle;
    try {
      handle = agentManager.spawn(agentId, spawnOptions, resumeMessages);
    } catch (err) {
      if (!existingSession) {
        sessionStore.delete(session.id);
      }
      throw err;
    }

    if (existingSession) {
      sessionStore.update(session.id, {
        agentId,
        model: options.model ?? session.model,
        mode: options.mode,
        cwd: options.cwd,
        metadata: workspace ? { ...(session.metadata ?? {}), workspaceId: workspace.id } : session.metadata,
      });
    }

    if (workspace) {
      updateWorkspaceTaskStatus(options.taskId, workspace.id, 'running', { sessionId: session.id });
      if (
        options.workspaceAction !== 'merge'
        && options.mode === 'act'
        && (workspace.outcome === 'merged' || workspace.outcome === 'ready_to_archive')
      ) {
        emitWorkspaceOutcome(workspace.id, 'in_progress');
      }
    }

    if (options.prompt !== '[Resuming previous session]') {
      sessionStore.addMessage(
        session.id,
        buildStoredUserMessage(options.prompt, options.images, options.attachments),
      );
    }

    activeTasks.set(options.taskId, handle);
    taskSessions.set(options.taskId, session.id);
    if (workspace) {
      taskWorkspaceMap.set(options.taskId, workspace.id);
      taskWorkspaceStatusMap.set(options.taskId, 'running');
      workspaceStore.addSession(workspace.id, session.id, options.taskId);
    }

    // Emit deferred todo items now that the task is registered in the renderer
    let todoInitialized = false;
    const pendingTodoUpdates: Array<{ stepId: number; status: 'in_progress' | 'done' }> = [];

    const emitTodoUpdate = (taskId: string, stepId: number, status: 'in_progress' | 'done') => {
      if (!todoInitialized) {
        pendingTodoUpdates.push({ stepId, status });
        return;
      }
      sendToRenderer('agent:todo-update', { taskId, stepId, status });
    };

    const flushTodoUpdates = (taskId: string) => {
      todoInitialized = true;
      for (const update of pendingTodoUpdates) {
        sendToRenderer('agent:todo-update', { taskId, stepId: update.stepId, status: update.status });
      }
      pendingTodoUpdates.length = 0;
    };

    if (pendingTodoItems) {
      sendToRenderer('agent:todo', { taskId: options.taskId, todoItems: pendingTodoItems });
      flushTodoUpdates(options.taskId);
    }

    const idleHeartbeat = setInterval(() => {
      if (!activeTasks.has(options.taskId) || cleaningUp.has(options.taskId)) {
        clearInterval(idleHeartbeat);
        taskIdleHeartbeats.delete(options.taskId);
        return;
      }
      sendToRenderer('agent:message', {
        taskId: options.taskId,
        message: {
          type: 'status',
          role: 'system',
          statusKind: 'progress',
          content: 'Agent is working...',
          timestamp: Date.now(),
        } satisfies AgentMessage,
      });
    }, 10_000);
    taskIdleHeartbeats.set(options.taskId, idleHeartbeat);

    taskStallMonitors.get(options.taskId)?.dispose();
    const priorRetries = taskRetryCounts.get(options.taskId) ?? 0;
    const stallMonitor = new StallMonitor({
      taskId: options.taskId,
      maxAutoRestarts: Math.max(0, MAX_AUTO_RETRIES - priorRetries),
      onStallDetected: (info) => {
        const currentStatus = taskWorkspaceStatusMap.get(options.taskId);
        if (currentStatus === 'waiting_input' || currentStatus === 'waiting_approval') {
          stallMonitor.pause();
          return;
        }

        const label = info.type === 'tool_timeout'
          ? `${info.toolName ?? 'Tool'} timed out after ${Math.round(info.durationMs / 1000)}s`
          : `No activity for ${Math.round(info.durationMs / 1000)}s`;
        emitTaskMessage(options.taskId, session.id, {
          type: 'status',
          role: 'system',
          statusKind: 'diagnostic',
          content: `Stall detected: ${label}`,
          timestamp: Date.now(),
        });
        sendToRenderer('agent:stall', {
          taskId: options.taskId,
          stallInfo: info,
        });
        if (info.autoRestartsRemaining > 0) {
          void triggerAutoRecovery(options.taskId, session.id, agentId, options);
        }
      },
      onProcessDead: () => {
        if (!cleaningUp.has(options.taskId) && activeTasks.has(options.taskId)) {
          emitTaskMessage(options.taskId, session.id, {
            type: 'error',
            role: 'system',
            content: 'Agent process died unexpectedly',
            timestamp: Date.now(),
          });
          sendToRenderer('agent:done', { taskId: options.taskId, error: 'Agent process died unexpectedly' });
          cleanupTask(options.taskId);
        }
      },
    });
    taskStallMonitors.set(options.taskId, stallMonitor);

    stallMonitor.startHealthCheck(() => handle.isAlive());

    emitTaskMessage(options.taskId, session.id, {
      type: 'status',
      role: 'system',
      statusKind: 'spawn',
      content: `Starting ${getAgentLabel(agentId)}...`,
      timestamp: Date.now(),
    });

    handle.on('session-meta', (meta) => {
      if (!meta || typeof meta !== 'object') return;
      const sessionMeta = meta as { id?: string };
      if (typeof sessionMeta.id !== 'string') return;
      if (agentId === 'codex') {
        detectedCodexSessionId = sessionMeta.id;
      }
      persistAgentSessionId(session.id, agentId, sessionMeta.id);
    });

    let agentUsedTodoWrite = false;

    handle.on('agent-todo', (payload: { todos: any[] }) => {
      agentUsedTodoWrite = true;
      const todoItems = (payload.todos ?? [])
        .filter((t: any) => t && typeof t === 'object' && typeof t.content === 'string')
        .map((t: any, i: number) => ({
          id: i + 1,
          label: t.content,
          status: t.status === 'completed' ? 'done' as const
            : t.status === 'in_progress' ? 'in_progress' as const
            : 'pending' as const,
        }));
      sendToRenderer('agent:todo', { taskId: options.taskId, todoItems });
      flushTodoUpdates(options.taskId);
    });

    const toolHeartbeats = new Map<string, NodeJS.Timeout>();

    handle.on('message', (message) => {
      if (message.type === 'tool_call' && message.toolCallId) {
        if (isInteractiveToolName(message.toolName)) {
          stallMonitor.pause();
        } else {
          stallMonitor.trackToolCall(message.toolCallId, message.toolName);
        }
      } else if (message.type === 'tool_result' && message.toolCallId) {
        stallMonitor.trackToolResult(message.toolCallId);
        stallMonitor.resume();
      }
      if (message.type !== 'status' && message.type !== 'rate_limit') {
        stallMonitor.markActivity();
      }

      if (message.type === 'question_request') {
        stallMonitor.pause();
      }

      if (message.type === 'rate_limit') {
        const normalized = (agentId === 'claude-code' || agentId === 'codex')
          ? normalizeRateLimitInfo(
            message.rateLimitInfo as Record<string, any> | undefined,
            agentId,
          )
          : null;
        if (normalized) {
          cachedRateLimits.set(`${normalized.providerId}:${normalized.rateLimitType}`, normalized);
        }
      }

      sessionStore.addMessage(session.id, toStoredMessage(message));

      if (!agentUsedTodoWrite) {
        const trackable = getStepTrackableContent(message);
        if (trackable) {
          const markers = parseStepMarkers(trackable);
          for (const marker of markers) {
            emitTodoUpdate(options.taskId, marker.stepId, marker.status);
          }
        }
      }

      if (
        message.type === 'tool_call'
        && message.toolName
        && message.toolName.toLowerCase().includes('todo')
        && message.toolInput
        && Array.isArray(message.toolInput.todos)
      ) {
        const todoItems = (message.toolInput.todos as Array<Record<string, unknown>>)
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
          .map((item, i) => {
            const label = typeof item.content === 'string'
              ? item.content
              : typeof item.title === 'string'
                ? item.title
                : String(item.text ?? '');
            const rawStatus = typeof item.status === 'string' ? item.status : 'pending';
            const status: 'pending' | 'in_progress' | 'done' =
              rawStatus === 'completed' ? 'done'
                : rawStatus === 'in_progress' ? 'in_progress'
                  : 'pending';
            return { id: i + 1, label, status };
          })
          .filter((item) => item.label.trim().length > 0);

        if (todoItems.length > 0) {
          sendToRenderer('agent:todo', { taskId: options.taskId, todoItems });
          flushTodoUpdates(options.taskId);
        }
      }

      const autoApprovePermission = Boolean(
        options.autoApprovePermissions
          && message.type === 'permission_request'
          && message.requestId,
      );

      if (workspace) {
        if (message.type === 'permission_request' && !autoApprovePermission) {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'waiting_approval', { sessionId: session.id });
        } else if (message.type === 'question_request') {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'waiting_input', { sessionId: session.id });
        } else if (message.type !== 'rate_limit') {
          updateWorkspaceTaskStatus(options.taskId, workspace.id, 'running', { sessionId: session.id });
        }
      }

      if (message.type === 'permission_request') {
        if (autoApprovePermission) {
          handle.approve(message.requestId!);
          const autoApprovedMessage = {
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: `Auto-approved ${message.toolName ?? 'permission'} for workspace merge`,
            timestamp: Date.now(),
          } satisfies AgentMessage;
          sessionStore.addMessage(session.id, toStoredMessage(autoApprovedMessage));
          sendToRenderer('agent:message', {
            taskId: options.taskId,
            message: autoApprovedMessage,
          });
        } else {
          stallMonitor.pause();
          sendToRenderer('agent:permission', {
            taskId: options.taskId,
            requestId: message.requestId,
            toolName: message.toolName ?? 'unknown',
            description: message.content,
            action: message.action,
            path: message.filePath,
          });
        }
      }
      if (!(message.type === 'permission_request' && autoApprovePermission)) {
        sendToRenderer('agent:message', { taskId: options.taskId, message });
      }

      if (message.subagentId && toolHeartbeats.size > 0) {
        for (const interval of toolHeartbeats.values()) {
          clearInterval(interval);
        }
        toolHeartbeats.clear();
      }

      if (message.type === 'tool_call' && message.toolCallId) {
        const heartbeatInterval = setInterval(() => {
          sendToRenderer('agent:message', {
            taskId: options.taskId,
            message: {
              type: 'status',
              role: 'system',
              statusKind: 'progress',
              content: `Running tool: ${message.toolName ?? 'unknown'}...`,
              timestamp: Date.now(),
            } satisfies AgentMessage,
          });
        }, 15_000);
        toolHeartbeats.set(message.toolCallId, heartbeatInterval);
      }

      if (message.type === 'tool_result' && message.toolCallId) {
        const interval = toolHeartbeats.get(message.toolCallId);
        if (interval) {
          clearInterval(interval);
          toolHeartbeats.delete(message.toolCallId);
        }
      }
    });

    handle.on('done', (result) => {
      void (async () => {
        if (cleaningUp.has(options.taskId)) return;

        stallMonitor.dispose();
        taskStallMonitors.delete(options.taskId);

        for (const interval of toolHeartbeats.values()) clearInterval(interval);
        toolHeartbeats.clear();

        if (taskIdleHeartbeats.has(options.taskId)) {
          clearInterval(taskIdleHeartbeats.get(options.taskId)!);
          taskIdleHeartbeats.delete(options.taskId);
        }

        const retryCount = taskRetryCounts.get(options.taskId) ?? 0;
        const shouldAutoRetry = result?.error
          && !cleaningUp.has(options.taskId)
          && retryCount < MAX_AUTO_RETRIES
          && !result.error.includes('authentication')
          && !result.error.includes('rate limit')
          && !result.error.includes('timed out');
        if (shouldAutoRetry) {
          taskRetryCounts.set(options.taskId, retryCount + 1);
          emitTaskMessage(options.taskId, session.id, {
            type: 'status',
            role: 'system',
            statusKind: 'progress',
            content: `Agent crashed — auto-retrying (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})...`,
            timestamp: Date.now(),
          });
          handle.removeAllListeners();
          activeTasks.delete(options.taskId);
          taskSessions.delete(options.taskId);
          await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));
          try {
            const context = buildConversationContext(session.id, sessionStore);
            await spawnTaskRun({
              ...options,
              sessionId: session.id,
              fallbackContext: context || undefined,
              prompt: '[Resuming previous session]',
            });
            return;
          } catch {
            // Retry failed — fall through to normal done handling
          }
        }

        cleaningUp.add(options.taskId);
        try {
          let finalError = result?.error;

          for (const interval of toolHeartbeats.values()) clearInterval(interval);
          toolHeartbeats.clear();
          if (taskIdleHeartbeats.has(options.taskId)) {
            clearInterval(taskIdleHeartbeats.get(options.taskId)!);
            taskIdleHeartbeats.delete(options.taskId);
          }

          if (agentId === 'codex' && !detectedCodexSessionId) {
            const detectedSession = findLatestCodexSession(options.cwd, startedAt);
            if (detectedSession?.id) {
              detectedCodexSessionId = detectedSession.id;
              persistAgentSessionId(session.id, agentId, detectedSession.id);
            }
          }

          if (!finalError && options.mode === 'act') {
            const commands = await resolveQualityGateCommands(options.cwd);
            const maxRetries = configManager.get().qualityGateMaxRetries ?? 2;

            for (const command of commands) {
              let passed = false;
              let lastResult: { stdout: string; stderr: string; exitCode: number } = { stdout: '', stderr: '', exitCode: 0 };

              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const gateResult = await runShellCommand(command, options.cwd, sshHost);
                passed = gateResult.exitCode === 0;
                lastResult = gateResult;

                const gateMsg: AgentMessage = {
                  type: 'quality_gate',
                  role: 'system',
                  content: passed ? `Quality gate passed: ${command}` : `Quality gate failed: ${command}`,
                  timestamp: Date.now(),
                  command,
                  exitCode: gateResult.exitCode,
                  passed,
                  stdout: gateResult.stdout,
                  stderr: gateResult.stderr,
                  retryAttempt: attempt > 0 ? attempt : undefined,
                  maxRetries: attempt > 0 ? maxRetries : undefined,
                };
                emitQualityGateMessage(options.taskId, session.id, gateMsg);

                if (passed || attempt >= maxRetries) break;

                const fixTaskId = crypto.randomUUID();
                const errorOutput = (gateResult.stderr || gateResult.stdout || '').trim();
                const fixPrompt = `The quality gate command \`${command}\` failed with these errors:\n\n\`\`\`\n${errorOutput}\n\`\`\`\n\nPlease fix these issues so the command passes.`;

                emitTaskMessage(options.taskId, session.id, {
                  type: 'status',
                  role: 'system',
                  statusKind: 'progress',
                  content: `Quality gate failed — attempting fix (${attempt + 1}/${maxRetries})...`,
                  timestamp: Date.now(),
                });

                const fixHandle = agentManager.spawn(agentId, {
                  taskId: fixTaskId,
                  prompt: fixPrompt,
                  cwd: spawnOptions.cwd,
                  mode: 'act',
                  model: spawnOptions.model,
                  binaryPath: spawnOptions.binaryPath,
                  sshHost: spawnOptions.sshHost,
                  remoteCwd: spawnOptions.remoteCwd,
                }, undefined);

                await new Promise<void>((resolve) => {
                  const safetyTimer = setTimeout(() => {
                    fixHandle.removeAllListeners();
                    resolve();
                  }, 120_000);

                  fixHandle.on('message', (msg: AgentMessage) => {
                    if (msg.type === 'permission_request' && msg.requestId) {
                      fixHandle.approve(msg.requestId);
                    } else if (msg.type !== 'result' && msg.type !== 'rate_limit') {
                      emitTaskMessage(options.taskId, session.id, msg);
                    }
                  });

                  fixHandle.on('done', () => {
                    clearTimeout(safetyTimer);
                    fixHandle.removeAllListeners();
                    resolve();
                  });
                });
              }

              if (!passed) {
                const baselinePassed = qualityGateBaseline.get(command);
                if (baselinePassed === false) {
                  const preExistingMsg: AgentMessage = {
                    type: 'quality_gate',
                    role: 'system',
                    content: `Quality gate pre-existing failure (existed before agent ran): ${command}`,
                    timestamp: Date.now(),
                    command,
                    exitCode: lastResult.exitCode,
                    passed: false,
                    isPreExisting: true,
                    stdout: lastResult.stdout,
                    stderr: lastResult.stderr,
                  };
                  emitQualityGateMessage(options.taskId, session.id, preExistingMsg);
                } else {
                  finalError = `Quality gate failed: ${command}`;
                  break;
                }
              }
            }
          }

          if (preRunRef && !sshHost) {
            try {
              const diffData = await captureGitDiff(options.cwd, preRunRef);
              if (diffData && diffData.files.length > 0) {
                const msgCount = (await (() => {
                  try { return sessionStore.getMessages(session.id).length; } catch { return 0; }
                })());
                const key = `0-${msgCount}`;
                sendToRenderer('agent:diff', {
                  taskId: options.taskId,
                  key,
                  diff: diffData,
                });
              }
            } catch {
              // Diff capture is best-effort
            }
          }

          sendToRenderer('agent:done', { taskId: options.taskId, error: finalError });

          if (workspace) {
            const nextStatus: WorkspaceStatus = finalError ? 'error' : 'done';
            updateWorkspaceTaskStatus(options.taskId, workspace.id, nextStatus, { sessionId: session.id });

            // Detect if the agent renamed the branch (e.g. via `git branch -m`)
            // and sync the workspace record so the UI shows the correct name.
            try {
              const { stdout: actualBranch } = await execFileAsync(
                'git', ['branch', '--show-current'],
                { cwd: workspace.worktreePath, timeout: 5000 },
              );
              const trimmedBranch = actualBranch.trim();
              if (trimmedBranch && trimmedBranch !== workspace.branch) {
                const nameSlug = trimmedBranch
                  .replace(/^[^/]*\//, '')       // strip prefix like flux/ or user/
                  .replace(/-[a-z0-9]{4,8}$/, '') // strip trailing random suffix
                  .replace(/[_-]+/g, ' ')
                  .trim();
                const newName = nameSlug
                  ? nameSlug.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 40)
                  : trimmedBranch;
                workspaceStore.update(workspace.id, { branch: trimmedBranch, name: newName });
                sendToRenderer('workspace:updated', {
                  workspaceId: workspace.id,
                  branch: trimmedBranch,
                  name: newName,
                });
              }
            } catch {
              // Best-effort branch detection
            }

            if (options.mode === 'act') {
              if (options.workspaceAction === 'merge') {
                if (!finalError) {
                  emitWorkspaceOutcome(workspace.id, 'merged');
                }
              } else {
                if (!finalError) {
                  await recordWorkspaceCheckpoint(workspace.id, options.prompt, session.id).catch(() => {});
                }

                // Determine outcome from actual git state rather than relying
                // on the previous outcome value.  This makes the lifecycle
                // resilient to external merges, manual git operations, and
                // repeated task runs.
                const currentWs = workspaceStore.get(workspace.id);
                const currentOutcome = currentWs?.outcome ?? 'in_progress';

                // Don't downgrade user-promoted outcomes
                const userPromotedOutcomes = new Set(['ready_to_merge', 'merged', 'ready_to_archive']);
                if (!userPromotedOutcomes.has(currentOutcome)) {
                  const merged = await isWorkspaceBranchMerged(workspace);
                  if (merged) {
                    emitWorkspaceOutcome(workspace.id, 'merged');
                  } else {
                    const { hasPendingChanges } = await workspaceHasPendingChanges(workspace);
                    if (hasPendingChanges) {
                      emitWorkspaceOutcome(workspace.id, 'ready_for_pr');
                    }
                  }
                }

                try {
                  const { stdout: branchOut } = await execFileAsync('git', ['branch', '--show-current'], { cwd: workspace.parentRepo });
                  const suggestedMergeTarget = branchOut.trim() || 'main';
                  sendToRenderer('workspace:completion', {
                    workspaceId: workspace.id,
                    taskId: options.taskId,
                    suggestedMergeTarget,
                  });
                } catch {
                  // Best-effort
                }
              }
            }
          }
        } finally {
          handle.removeAllListeners();
          activeTasks.delete(options.taskId);
          taskSessions.delete(options.taskId);
          taskWorkspaceStatusMap.delete(options.taskId);
          taskWorkspaceMap.delete(options.taskId);
          cleaningUp.delete(options.taskId);
          taskRetryCounts.delete(options.taskId);
          taskStallMonitors.get(options.taskId)?.dispose();
          taskStallMonitors.delete(options.taskId);
        }
      })();
    });

    return { taskId: options.taskId, session: sessionStore.get(session.id) ?? session };
  };

  // --- Task IPC handlers ---

  ipcMain.handle(
    'task:spawn',
    async (
      _event,
      options: SpawnTaskRunOptions,
    ) => {
      return spawnTaskRun(options);
    },
  );

  ipcMain.handle('task:stop', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    if (cleaningUp.has(taskId)) return;
    cleaningUp.add(taskId);
    for (const [subagentId, subagent] of activeSubagents.entries()) {
      if (subagent.parentTaskId !== taskId) continue;
      await subagent.handle.stop();
      subagent.handle.removeAllListeners();
      activeSubagents.delete(subagentId);
      activeTasks.delete(subagentId);
      taskSessions.delete(subagentId);
    }
    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
      activeTasks.delete(taskId);
    }
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    taskRetryCounts.delete(taskId);
    taskSessions.delete(taskId);
    cleaningUp.delete(taskId);
    sendToRenderer('agent:done', { taskId, error: undefined });
    releaseWorkspaceTask(taskId, 'done');
  });

  ipcMain.handle('task:restart', async (_event, { taskId }: { taskId: string }) => {
    requireFields({ taskId }, 'taskId');
    const sessionId = taskSessions.get(taskId);
    if (!sessionId) throw new Error('No session for task');
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error('Session not found');

    taskStallMonitors.get(taskId)?.dispose();
    taskStallMonitors.delete(taskId);
    const handle = activeTasks.get(taskId);
    if (handle) {
      await handle.stop();
      handle.removeAllListeners();
    }
    activeTasks.delete(taskId);
    if (taskIdleHeartbeats.has(taskId)) {
      clearInterval(taskIdleHeartbeats.get(taskId)!);
      taskIdleHeartbeats.delete(taskId);
    }
    taskSessions.delete(taskId);
    taskRetryCounts.delete(taskId);

    await new Promise(resolve => setTimeout(resolve, RECOVERY_DELAY_MS));

    const context = buildConversationContext(sessionId, sessionStore);
    return spawnTaskRun({
      taskId,
      sessionId,
      prompt: '[Resuming previous session]',
      cwd: session.cwd,
      mode: session.mode as 'plan' | 'act',
      model: session.model,
      agentId: session.agentId,
      fallbackContext: context || undefined,
    });
  });

  ipcMain.handle('subagent:spawn', async (_event, options: {
    parentTaskId: string;
    prompt: string;
    model?: string;
    name: string;
    cwd?: string;
  }) => {
    requireFields(options as unknown as Record<string, unknown>, 'parentTaskId', 'prompt', 'name');

    const parentHandle = activeTasks.get(options.parentTaskId);
    if (!parentHandle) {
      throw new Error(`Task ${options.parentTaskId} does not have an active run`);
    }

    const parentSessionId = taskSessions.get(options.parentTaskId);
    const parentSession = parentSessionId ? sessionStore.get(parentSessionId) : null;
    const parentAgentId = parentHandle.agentId;
    const config = configManager.get();
    const model = options.model || config.subagentModel || parentSession?.model || config.defaultModel;
    const subagentId = `${options.parentTaskId}:sub-${crypto.randomUUID().slice(0, 8)}`;
    const session = sessionStore.create({
      title: `[Subagent] ${options.name}`,
      agentId: parentAgentId,
      model,
      mode: 'plan',
      cwd: options.cwd ?? parentSession?.cwd ?? getCurrentCwd(),
      metadata: {
        parentTaskId: options.parentTaskId,
        subagentId,
        subagentName: options.name,
      },
    });

    const subSpawnOptions: SpawnOptions = {
      taskId: subagentId,
      prompt: options.prompt,
      model,
      mode: 'plan',
      thinking: 'low',
      cwd: options.cwd ?? parentSession?.cwd ?? getCurrentCwd(),
      sessionId: parentAgentId === 'claude-code' ? session.id : undefined,
      parentTaskId: options.parentTaskId,
      subagentName: options.name,
    };

    let subHandle: AgentHandle;
    try {
      subHandle = agentManager.spawn(parentAgentId, subSpawnOptions);
    } catch (error) {
      sessionStore.delete(session.id);
      throw error;
    }

    activeTasks.set(subagentId, subHandle);
    taskSessions.set(subagentId, session.id);
    activeSubagents.set(subagentId, {
      parentTaskId: options.parentTaskId,
      handle: subHandle,
      name: options.name,
      toolCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      sessionId: session.id,
    });

    emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
      type: 'status',
      role: 'system',
      content: options.name,
      timestamp: Date.now(),
      statusKind: 'spawn',
      subagentStatus: 'spawning',
      subagentToolCount: 0,
      subagentTokens: {
        input: 0,
        output: 0,
      },
    });

    subHandle.on('session-meta', (meta) => {
      if (!meta || typeof meta !== 'object') return;
      const sessionMeta = meta as { id?: string };
      if (typeof sessionMeta.id !== 'string') return;
      persistAgentSessionId(session.id, parentAgentId, sessionMeta.id);
    });

    subHandle.on('message', (message) => {
      const subagent = activeSubagents.get(subagentId);
      if (!subagent) return;

      if (message.type === 'tool_call') {
        subagent.toolCount += 1;
      }
      if (message.type === 'result') {
        subagent.inputTokens += message.inputTokens ?? 0;
        subagent.outputTokens += message.outputTokens ?? 0;
      }

      sessionStore.addMessage(session.id, toStoredMessage(message));
      emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
        ...message,
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });
    });

    subHandle.on('done', (result) => {
      const subagent = activeSubagents.get(subagentId);
      if (!subagent) return;

      emitSubagentMessage(options.parentTaskId, subagentId, options.name, {
        type: 'status',
        role: 'system',
        content: result?.error ? `${options.name} failed` : `${options.name} finished`,
        timestamp: Date.now(),
        statusKind: 'progress',
        subagentStatus: result?.error ? 'error' : 'done',
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });

      subHandle.removeAllListeners();
      activeSubagents.delete(subagentId);
      activeTasks.delete(subagentId);
      taskSessions.delete(subagentId);
    });

    return { subagentId };
  });

  ipcMain.handle('subagent:stop', async (_event, { subagentId, parentTaskId }: { subagentId?: string; parentTaskId?: string }) => {
    const targets = subagentId
      ? [subagentId]
      : Array.from(activeSubagents.entries())
        .filter(([, subagent]) => !parentTaskId || subagent.parentTaskId === parentTaskId)
        .map(([id]) => id);

    for (const targetId of targets) {
      const subagent = activeSubagents.get(targetId);
      if (!subagent) continue;
      await subagent.handle.stop();
      subagent.handle.removeAllListeners();
      activeSubagents.delete(targetId);
      activeTasks.delete(targetId);
      taskSessions.delete(targetId);
      emitSubagentMessage(subagent.parentTaskId, targetId, subagent.name, {
        type: 'status',
        role: 'system',
        content: `${subagent.name} stopped`,
        timestamp: Date.now(),
        statusKind: 'progress',
        subagentStatus: 'error',
        subagentToolCount: subagent.toolCount,
        subagentTokens: {
          input: subagent.inputTokens,
          output: subagent.outputTokens,
        },
      });
    }
  });

  ipcMain.handle('task:approve', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.approve(requestId);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:deny', async (_event, { taskId, requestId }: { taskId: string; requestId: string }) => {
    const handle = activeTasks.get(taskId);
    if (handle) handle.deny(requestId);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:answer-question', async (_event, { taskId, requestId, response }: {
    taskId: string;
    requestId: string;
    response: string;
  }) => {
    requireFields({ taskId, requestId, response }, 'taskId', 'requestId', 'response');
    const handle = activeTasks.get(taskId);
    if (!handle) {
      throw new Error(`Task ${taskId} does not have an active run`);
    }

    if (!handle.isAlive()) {
      throw new Error('Agent process has exited — answer cannot be delivered');
    }

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      emitTaskMessage(taskId, sessionId, buildUserMessagePayload(response));
    }

    const workspaceId = taskWorkspaceMap.get(taskId);
    if (workspaceId) {
      updateWorkspaceTaskStatus(taskId, workspaceId, 'running', sessionId ? { sessionId } : undefined);
    }

    handle.answerQuestion(requestId, response);
    taskStallMonitors.get(taskId)?.resume();
  });

  ipcMain.handle('task:steer', async (_event, { taskId, prompt, images, attachments }: { taskId: string; prompt: string; images?: string[]; attachments?: FileAttachment[] }) => {
    const handle = activeTasks.get(taskId);
    if (!handle) {
      return { steerFailed: true, reason: 'task_finished' };
    }

    const effectivePrompt = await buildPromptWithAttachments(prompt, attachments, getSshHost());
    handle.steer(effectivePrompt, images);

    const sessionId = taskSessions.get(taskId);
    if (sessionId) {
      sessionStore.addMessage(
        sessionId,
        buildStoredUserMessage(prompt, images, attachments),
      );
    }
    return { steerFailed: false };
  });

  return { spawnTaskRun };
}
