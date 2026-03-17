/**
 * Shell integration for Flux terminals.
 *
 * Injects lightweight shell scripts (bash, zsh, fish) that emit
 * OSC 133 (command markers) and OSC 7 (CWD reporting) escape sequences.
 * The main process intercepts these sequences from PTY output and
 * emits structured IPC events to the renderer.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────

export type ShellIntegrationEventType = 'prompt-start' | 'command-start' | 'command-finish' | 'cwd';

export interface ShellIntegrationEvent {
  type: ShellIntegrationEventType;
  exitCode?: number;
  cwd?: string;
}

export interface ShellIntegrationSetup {
  args: string[];
  env: Record<string, string>;
}

// ── Script directory ───────────────────────────────────────────────

const INTEGRATION_DIR = path.join(os.tmpdir(), 'flux-shell-integration');
const ZDOTDIR = path.join(INTEGRATION_DIR, 'zdotdir');
let scriptsReady = false;

// ── Shell integration scripts ──────────────────────────────────────

const BASH_INTEGRATION_SCRIPT = [
  '# Flux Terminal Shell Integration — Bash',
  'if [ "${FLUX_SHELL_INTEGRATION:-}" != "1" ]; then return 0 2>/dev/null || exit 0; fi',
  '__flux_prompt() {',
  '  local e=$?',
  '  builtin printf \'\\e]133;D;%s\\a\' "$e"',
  '  builtin printf \'\\e]7;file://%s%s\\a\' "$(hostname)" "$(pwd)"',
  '  builtin printf \'\\e]133;A\\a\'',
  '}',
  'PROMPT_COMMAND="__flux_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  'builtin printf \'\\e]7;file://%s%s\\a\' "$(hostname)" "$(pwd)"',
  'builtin printf \'\\e]133;A\\a\'',
].join('\n');

const ZSH_INTEGRATION_SCRIPT = [
  '# Flux Terminal Shell Integration — Zsh',
  '__flux_precmd() {',
  '  local e=$?',
  '  printf \'\\e]133;D;%s\\a\' "$e"',
  '  printf \'\\e]7;file://%s%s\\a\' "$(hostname)" "$(pwd)"',
  '  printf \'\\e]133;A\\a\'',
  '}',
  '__flux_preexec() {',
  '  printf \'\\e]133;C\\a\'',
  '}',
  'precmd_functions+=(__flux_precmd)',
  'preexec_functions+=(__flux_preexec)',
  'printf \'\\e]7;file://%s%s\\a\' "$(hostname)" "$(pwd)"',
  'printf \'\\e]133;A\\a\'',
].join('\n');

const FISH_INTEGRATION_SCRIPT = [
  '# Flux Terminal Shell Integration — Fish',
  'function __flux_prompt --on-event fish_prompt',
  '  set -l e $status',
  '  printf \'\\e]133;D;%s\\a\' $e',
  '  printf \'\\e]7;file://%s%s\\a\' (hostname) (pwd)',
  '  printf \'\\e]133;A\\a\'',
  'end',
  'function __flux_preexec --on-event fish_preexec',
  '  printf \'\\e]133;C\\a\'',
  'end',
  'printf \'\\e]7;file://%s%s\\a\' (hostname) (pwd)',
  'printf \'\\e]133;A\\a\'',
].join('\n');

// ── Write integration files to disk ────────────────────────────────

function ensureScripts(): void {
  if (scriptsReady) return;

  fs.mkdirSync(INTEGRATION_DIR, { recursive: true });
  fs.mkdirSync(ZDOTDIR, { recursive: true });

  // Bash integration script
  fs.writeFileSync(
    path.join(INTEGRATION_DIR, 'bash-integration.sh'),
    BASH_INTEGRATION_SCRIPT,
    'utf-8',
  );

  // Bash RC wrapper — sources user's .bashrc then our integration
  const bashRc = [
    '[ -f ~/.bashrc ] && source ~/.bashrc',
    `source "${path.join(INTEGRATION_DIR, 'bash-integration.sh')}"`,
  ].join('\n');
  fs.writeFileSync(path.join(INTEGRATION_DIR, 'bash-rc.sh'), bashRc, 'utf-8');

  // Zsh ZDOTDIR/.zshenv — sources original .zshenv
  const zshenv = [
    'if [ -f "${FLUX_ORIGINAL_ZDOTDIR:-$HOME}/.zshenv" ]; then',
    '  source "${FLUX_ORIGINAL_ZDOTDIR:-$HOME}/.zshenv"',
    'fi',
  ].join('\n');
  fs.writeFileSync(path.join(ZDOTDIR, '.zshenv'), zshenv, 'utf-8');

  // Zsh ZDOTDIR/.zshrc — sources original .zshrc then our integration
  const zshrc = [
    'ZDOTDIR="${FLUX_ORIGINAL_ZDOTDIR:-$HOME}"',
    'if [ -f "${ZDOTDIR}/.zshrc" ]; then',
    '  source "${ZDOTDIR}/.zshrc"',
    'fi',
    ZSH_INTEGRATION_SCRIPT,
  ].join('\n');
  fs.writeFileSync(path.join(ZDOTDIR, '.zshrc'), zshrc, 'utf-8');

  // Fish integration script
  fs.writeFileSync(
    path.join(INTEGRATION_DIR, 'fish-integration.fish'),
    FISH_INTEGRATION_SCRIPT,
    'utf-8',
  );

  scriptsReady = true;
}

// ── Per-shell setup ────────────────────────────────────────────────

export function setupShellIntegration(shellPath: string): ShellIntegrationSetup {
  const shellName = path.basename(shellPath).replace(/\.exe$/i, '');

  ensureScripts();

  const baseEnv = { FLUX_SHELL_INTEGRATION: '1' };

  switch (shellName) {
    case 'bash': {
      const rcPath = path.join(INTEGRATION_DIR, 'bash-rc.sh');
      return {
        args: ['--rcfile', rcPath],
        env: baseEnv,
      };
    }
    case 'zsh': {
      const originalZdotdir = process.env.ZDOTDIR || os.homedir();
      return {
        args: ['-i'],
        env: {
          ...baseEnv,
          ZDOTDIR,
          FLUX_ORIGINAL_ZDOTDIR: originalZdotdir,
        },
      };
    }
    case 'fish': {
      const fishScript = path.join(INTEGRATION_DIR, 'fish-integration.fish');
      return {
        args: ['-C', `source ${fishScript}`, '-i'],
        env: baseEnv,
      };
    }
    default:
      // Unknown shell — skip integration, use plain interactive
      return { args: ['-i'], env: {} };
  }
}

// ── OSC sequence parser ────────────────────────────────────────────

const OSC_RE = /\x1b\](\d+);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

export function parseShellIntegrationEvents(data: string): ShellIntegrationEvent[] {
  const events: ShellIntegrationEvent[] = [];

  OSC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OSC_RE.exec(data)) !== null) {
    const oscId = parseInt(match[1], 10);
    const oscData = match[2];

    if (oscId === 133) {
      // OSC 133 — command markers
      const marker = oscData.charAt(0);
      switch (marker) {
        case 'A':
          events.push({ type: 'prompt-start' });
          break;
        case 'C':
          events.push({ type: 'command-start' });
          break;
        case 'D': {
          const parts = oscData.split(';');
          const exitCode = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          events.push({ type: 'command-finish', exitCode: isNaN(exitCode) ? 0 : exitCode });
          break;
        }
      }
    } else if (oscId === 7) {
      // OSC 7 — CWD reporting (file://hostname/path)
      try {
        const url = new URL(oscData);
        if (url.protocol === 'file:') {
          const cwd = decodeURIComponent(url.pathname);
          if (cwd) {
            events.push({ type: 'cwd', cwd });
          }
        }
      } catch {
        // If URL parsing fails, try extracting path directly
        const filePrefix = oscData.indexOf('file://');
        if (filePrefix !== -1) {
          const afterScheme = oscData.slice(filePrefix + 7);
          // Format: file://hostname/path — skip hostname
          const slashIdx = afterScheme.indexOf('/');
          if (slashIdx !== -1) {
            events.push({ type: 'cwd', cwd: afterScheme.slice(slashIdx) });
          }
        }
      }
    }
  }

  return events;
}
