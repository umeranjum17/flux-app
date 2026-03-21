# Flux

Flux is an Electron desktop app for orchestrating AI coding agents (Claude Code, Codex, and others). It manages agent sessions, workspaces, approvals, and review loops from a single UI.

## Requirements

- Node.js 20+
- API keys for the providers you want to use (see [Setup](#setup))
- The CLI for each agent you want to run must be installed and on your `PATH`:
  - **Claude Code** — `npm install -g @anthropic-ai/claude-code`
  - **Codex** — `npm install -g @openai/codex`
  - **GitHub Copilot** — install the [GitHub Copilot CLI](https://githubnext.com/projects/copilot-cli) (`gh extension install github/gh-copilot`)

  Flux only spawns the agents you have installed; missing CLIs simply won't appear as available options.

## Setup

Copy the environment template and fill in your keys:

```sh
cp .env.example .env
```

Required variables are described in `.env.example`.

## Development

```sh
npm install
npm run dev
```

## Build

```sh
# Package the app (no installer)
npm run package

# Create a distributable (DMG on macOS, etc.)
npm run make
```

For cross-platform macOS builds from a remote Linux machine, see `build-flux-macos.sh`.

## Tests

```sh
npm test
# or just typecheck
npm run typecheck
```

## Remote Control

Flux exposes a local-network JSON-RPC server for mobile companion apps. See [docs/remote-control.md](docs/remote-control.md) for details. The server binds to LAN interfaces and uses token-based authentication — do not expose it to untrusted networks.

## License
MIT

https://github.com/user-attachments/assets/05486b31-9be4-46c3-9483-2c76ce3ea6ab






