/**
 * PID tracker for agent processes.
 *
 * Writes active agent PIDs to ~/.flux/agent-pids.json so that on startup
 * we can detect and kill orphaned processes from a previous crash.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AgentPidEntry {
  pid: number;
  taskId: string;
  agentId: string;
  startedAt: number;
}

const PID_FILE = path.join(os.homedir(), '.flux', 'agent-pids.json');

function readPidFile(): AgentPidEntry[] {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePidFile(entries: AgentPidEntry[]): void {
  try {
    const dir = path.dirname(PID_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PID_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.warn('[pid-tracker] Failed to write PID file:', err);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Register a spawned agent process. */
export function trackAgentPid(entry: AgentPidEntry): void {
  const entries = readPidFile();
  // Remove any stale entry for the same taskId
  const filtered = entries.filter(e => e.taskId !== entry.taskId);
  filtered.push(entry);
  writePidFile(filtered);
}

/** Remove a tracked agent process (normal exit). */
export function untrackAgentPid(taskId: string): void {
  const entries = readPidFile();
  const filtered = entries.filter(e => e.taskId !== taskId);
  writePidFile(filtered);
}

/**
 * Kill any orphaned agent processes from a previous crash.
 * Should be called during startup reconciliation.
 */
export function killOrphanedAgents(): void {
  const entries = readPidFile();
  if (entries.length === 0) return;

  for (const entry of entries) {
    if (isProcessAlive(entry.pid)) {
      console.log(
        `[pid-tracker] Killing orphaned agent process: pid=${entry.pid} task=${entry.taskId} agent=${entry.agentId}`,
      );
      try {
        process.kill(entry.pid, 'SIGTERM');
      } catch {
        // Already dead or permission denied
      }

      // Schedule a SIGKILL fallback
      setTimeout(() => {
        if (isProcessAlive(entry.pid)) {
          try {
            process.kill(entry.pid, 'SIGKILL');
          } catch {}
        }
      }, 5000);
    }
  }

  // Clear the PID file
  writePidFile([]);
}
