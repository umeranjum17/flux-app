#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# VS Code remote auto-attach injects a Node bootloader that makes Forge builds
# look stuck with "Debugger attached" / "Waiting for the debugger to disconnect".
unset NODE_OPTIONS
unset VSCODE_INSPECTOR_OPTIONS
unset ELECTRON_RUN_AS_NODE

TARGET="${1:-package}"

case "$TARGET" in
  package)
    npm run package
    echo
    echo "Packaged app:"
    echo "  $ROOT_DIR/out/Flux-linux-x64/Flux"
    ;;
  make)
    npm run make
    echo
    echo "Installers are under:"
    echo "  $ROOT_DIR/out/make"
    ;;
  clean)
    rm -rf out dist .vite
    echo "Cleaned build artifacts."
    ;;
  *)
    echo "Usage: ./build-flux.sh [package|make|clean]" >&2
    exit 1
    ;;
esac
