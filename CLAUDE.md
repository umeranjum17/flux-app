# Flux Instructions For Claude Code

You are working in `/home/umera/github/flux-app`.

## Project Shape
- `electron/core/` is the Electron main process and orchestration backend.
- `src/` is the React renderer.
- `electron/preload.ts` and `src/lib/ipc-api.ts` define the typed bridge between both sides.

## Priorities
- Optimize for a polished Claude Code + Codex orchestration experience first.
- Prefer improving continuity, correctness, supervision, approvals, workspaces, and review loops over adding more providers.
- Reuse existing abstractions before adding new layers.

## Core Conventions
- Use the shared `AgentHandle`, `AgentMessage`, and `SpawnOptions` types in `electron/core/agents/types.ts`.
- Keep IPC channel names in `domain:action` form.
- Keep renderer logic in Zustand stores and React components; keep subprocess, git, db, and filesystem logic in the main process.
- Use named exports and existing project patterns.
- Prefer `satisfies` for typed object literals.

## Quality Bar
- After TypeScript changes, run `npm run typecheck`.
- Prefer focused tests first, then broader tests as confidence increases.
- Before finishing substantial work, run `npm test` when feasible.
- Fix root causes instead of layering on brittle UI-only patches.

## Agent-Specific Guidance
- Claude Code sessions should remain resumable across Flux runs.
- Codex integrations should use the CLI’s real session model, current model catalog, and reasoning controls.
- Normalize provider-specific output into user-visible `AgentMessage` events and renderer state instead of hiding important errors.

## Practical Notes
- This repository may already be dirty. Never discard unrelated local changes.
- Favor concise comments only when the code would otherwise be hard to parse.
- Keep new instructions and docs short, concrete, and operational.
