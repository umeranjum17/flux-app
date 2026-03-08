# Flux Project Instructions

Use this file for all work under `/home/umera/github/flux-app`.

## Architecture
- Treat `electron/core/` as the Electron main-process runtime, agent orchestration layer, SQLite persistence layer, and git/worktree control plane.
- Treat `src/` as the React renderer. Keep main-process concerns out of renderer components and stores.
- Use the typed IPC boundary in `src/lib/ipc-api.ts` and `electron/core/ipc-handlers.ts`. Add new channels with `domain:action` naming.

## Stack
- Electron `40`
- React `19`
- Zustand with `immer`
- Tailwind CSS `v4`
- Vite
- Vitest
- `better-sqlite3`

## Pathing
- `@/*` maps to `src/*`
- `@electron/*` maps to `electron/*`

## Agent Conventions
- Keep Claude Code and Codex as first-class agent integrations.
- Implement agent backends with the shared `AgentHandle` interface in `electron/core/agents/types.ts`.
- Normalize provider output into the shared `AgentMessage` shape instead of pushing provider-specific payloads into the renderer.
- Prefer resilient subprocess handling: clean up temp files, handle `close` and `error`, and avoid blocking the main thread.

## Renderer Conventions
- Use functional components with named exports.
- Follow existing Zustand store patterns instead of introducing new state libraries.
- Do not use `useEffect` for derived state when a selector or local computation is enough.
- Keep UI changes aligned with the existing visual language unless a task explicitly asks for a redesign.

## TypeScript
- Prefer `satisfies` for object literals that implement a known shape.
- Prefer narrow helper functions over `any`.
- Extend existing shared types before adding parallel one-off types.

## Workflow
- Run `npm run typecheck` after changing `.ts` or `.tsx` files.
- Run targeted Vitest coverage for the files you changed when practical.
- Run `npm test` before declaring larger changes complete.
- Preserve existing user changes in the worktree. Do not revert unrelated modifications.
