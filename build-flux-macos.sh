#!/usr/bin/env bash
set -euo pipefail
#
# Build Flux on macOS from remote source.
#
# Quick start (from your Mac):
#   scp umera@extreme:/home/umera/github/flux-app/build-flux-macos.sh ~/build-flux-macos.sh
#   bash ~/build-flux-macos.sh            # package (default)
#   bash ~/build-flux-macos.sh make       # create DMG
#   bash ~/build-flux-macos.sh test       # typecheck + test only
#
# Environment overrides:
#   REMOTE_HOST   SSH host (default: umera@extreme)
#   REMOTE_REPO   Repo path on remote (default: /home/umera/github/flux-app)
#   LOCAL_ROOT    Local build directory (default: ~/flux-build/flux-app)

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: This script is meant to run on macOS." >&2
  exit 1
fi

REMOTE_HOST="${REMOTE_HOST:-umera@extreme}"
REMOTE_REPO="${REMOTE_REPO:-/home/umera/github/flux-app}"
LOCAL_ROOT="${LOCAL_ROOT:-$HOME/flux-build/flux-app}"
TARGET="${1:-package}"

for cmd in rsync npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: Missing required command: $cmd" >&2
    echo "  Install Node.js from https://nodejs.org (includes npm)" >&2
    exit 1
  fi
done

case "$TARGET" in
  package|make|test) ;;
  *)
    echo "Usage: $0 [package|make|test]" >&2
    exit 1
    ;;
esac

# Clear debugger/remote-shell injection so Electron Forge runs cleanly.
unset NODE_OPTIONS
unset VSCODE_INSPECTOR_OPTIONS
unset ELECTRON_RUN_AS_NODE

# Verify SSH connectivity first
echo "Checking SSH connection to ${REMOTE_HOST}..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$REMOTE_HOST" "echo ok" >/dev/null 2>&1; then
  echo "Error: Cannot reach ${REMOTE_HOST} via SSH." >&2
  echo "  Make sure you can: ssh ${REMOTE_HOST}" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCAL_ROOT")"

echo "Syncing sources from ${REMOTE_HOST}:${REMOTE_REPO} -> ${LOCAL_ROOT}"
if ! rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'out' \
  --exclude '.vite' \
  --exclude 'coverage' \
  --exclude '.DS_Store' \
  "${REMOTE_HOST}:${REMOTE_REPO}/" "${LOCAL_ROOT}/"; then
  echo "Error: rsync failed. Check that ${REMOTE_REPO} exists on ${REMOTE_HOST}." >&2
  exit 1
fi

cd "$LOCAL_ROOT"

echo "Installing dependencies (npm ci)..."
rm -rf node_modules dist out .vite
npm ci

case "$TARGET" in
  package)
    echo "Packaging macOS app..."
    npm run package
    ;;
  make)
    echo "Creating macOS distributable..."
    npm run make
    ;;
  test)
    echo "Running typecheck + tests..."
    npm run typecheck
    npm run test
    ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ELECTRON_ARCH="arm64" ;;
  x86_64)        ELECTRON_ARCH="x64"   ;;
  *)             ELECTRON_ARCH="$ARCH"  ;;
esac

echo
echo "Done."
case "$TARGET" in
  package)
    echo "App bundle:"
    echo "  ${LOCAL_ROOT}/out/Flux-darwin-${ELECTRON_ARCH}/Flux.app"
    echo
    echo "To open:"
    echo "  open '${LOCAL_ROOT}/out/Flux-darwin-${ELECTRON_ARCH}/Flux.app'"
    ;;
  make)
    echo "Artifacts:"
    echo "  ${LOCAL_ROOT}/out/make"
    ;;
esac
