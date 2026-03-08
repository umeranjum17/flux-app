# SSH-First Workflow Fix

> **Goal:** Make SSH behave like VS Code Remote SSH — once connected, everything runs on the remote host seamlessly.

## Root Causes & Fixes Applied

### Critical

1. **`fs:grep` never passed `sshHost`** (ipc-handlers.ts:736) — Grep always ran locally even when SSH connected. All file searches silently returned local results.
   - **Fix:** Pass `sshHost ?? undefined` to `grepFiles()`.

2. **`agent:done` errors invisible** (useAgentStream.ts:13) — When an agent errored, only task status changed. The actual error message was never shown.
   - **Fix:** Add error as a chat message before setting status to 'error'.

3. **No SSH validation on session resume** (ipc-handlers.ts:369) — Resuming an SSH session didn't verify the host was reachable. Tasks spawned into the void.
   - **Fix:** SSH echo test before spawning task when `taskSshHost` is set.

### Medium

4. **Glob patterns broken for SSH** (glob.ts:9) — `**/*.ts` → `*.ts` worked, but `**/*.{ts,tsx}` and `src/**/*.ts` didn't.
   - **Fix:** Proper `globToFindArgs()` with brace expansion and `-path` support.

5. **`fs:readdir` SSH errors swallowed** (ipc-handlers.ts:687) — Remote dir failures returned `[]` with no indication.
   - **Fix:** Log to diagnostics on failure.

6. **Git operations silent on failure** (ipc-handlers.ts:598-613) — Branch/status returned null/empty without logging.
   - **Fix:** Log errors with SSH host and CWD context.

7. **Agent detection drops failures silently** (manager.ts:130) — `Promise.allSettled` rejections ignored.
   - **Fix:** `console.warn` for each rejected detection.

### Design Improvements

8. **SSH health monitoring** — No way to detect dropped connections.
   - **Fix:** Added `ssh:health` IPC handler + 30s polling in AppShell. Auto-disconnects and shows error in chat if connection drops.

9. **macOS build script** — Missing error handling, no SSH pre-check, no usage docs.
   - **Fix:** Added SSH connectivity check, rsync error handling, `open` command hint, SCP usage docs in header.

## Verification

- TypeScript: `npx tsc --noEmit` — clean, zero errors
- Tests: 48/48 store tests pass; 6 pre-existing failures (jsdom env missing in agent.test.ts)
- No regressions introduced

## macOS Build Command

```bash
scp umera@extreme:/home/umera/github/flux-app/build-flux-macos.sh ~/build-flux-macos.sh && bash ~/build-flux-macos.sh
```
