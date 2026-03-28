import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, RefreshCw, Copy, Smartphone, Shield } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import type { FluxConfig, RemoteClientInfo, RemotePairingCode, RemoteServerStatus } from '../../lib/ipc-api';
import type { AgentId, ThinkingLevel } from '../../lib/types';

const defaultConfig: FluxConfig = {
  theme: 'dark',
  fontSize: 14,
  sendKey: 'cmd+enter',
  preferredIde: 'code',
  defaultAgent: 'claude-code',
  defaultModel: 'sonnet',
  subagentModel: 'haiku',
  defaultThinking: 'medium',
  defaultMode: 'act' as const,
  quickCreateDirect: false,
  zoomLevel: 1.0,
  qualityGateCommands: [],
  qualityGateMaxRetries: 2,
  customAgentPaths: {},
  recentProjects: [],
  recentHosts: [],
};

const thinkingOptions: { value: ThinkingLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

const AGENT_IDS: AgentId[] = ['claude-code', 'codex', 'gemini', 'openai', 'ollama'];
const IDE_OPTIONS = [
  { value: 'code' as const, label: 'VS Code' },
  { value: 'cursor' as const, label: 'Cursor' },
  { value: 'zed' as const, label: 'Zed' },
];

export function SettingsPanel() {
  const activeOverlay = useUiStore((s) => s.activeOverlay);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const setTheme = useUiStore((s) => s.setTheme);
  const setSendKey = useUiStore((s) => s.setSendKey);
  const [config, setConfig] = useState<FluxConfig>(defaultConfig);
  const [newCommand, setNewCommand] = useState('');
  const [loading, setLoading] = useState(true);
  const [remoteStatus, setRemoteStatus] = useState<RemoteServerStatus | null>(null);
  const [remoteClients, setRemoteClients] = useState<RemoteClientInfo[]>([]);
  const [pairingCode, setPairingCode] = useState<RemotePairingCode | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const open = activeOverlay === 'settings';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setRemoteError(null);
    Promise.all([
      window.api.invoke('config:get') as Promise<FluxConfig>,
      window.api.invoke('remote:status') as Promise<RemoteServerStatus>,
      window.api.invoke('remote:active-pairing-code') as Promise<RemotePairingCode | null>,
      window.api.invoke('remote:list-clients') as Promise<RemoteClientInfo[]>,
    ]).then(([cfg, status, activePairingCode, clients]) => {
      setConfig(cfg);
      setRemoteStatus(status);
      setPairingCode(activePairingCode);
      setRemoteClients(clients);
      setLoading(false);
    }).catch((error) => {
      setRemoteError(error instanceof Error ? error.message : 'Failed to load Flux Mobile settings');
      setLoading(false);
    });
  }, [open]);

  const updateConfig = (partial: Partial<FluxConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = async () => {
    await window.api.invoke('config:set', config);
    setTheme(config.theme);
    setSendKey(config.sendKey);
    if (config.zoomLevel) {
      window.api.invoke('zoom:set', { level: config.zoomLevel });
    }
    useAgentStore.getState().setSelectedThinking(config.defaultThinking);
    if (AGENT_IDS.includes(config.defaultAgent as AgentId)) {
      useAgentStore.getState().setSelectedAgent(config.defaultAgent as AgentId);
    }
    if (config.defaultModel.trim()) {
      useAgentStore.getState().setSelectedModel(config.defaultModel.trim());
    }
    setOverlay(null);
  };

  const addQualityGateCommand = () => {
    const cmd = newCommand.trim();
    if (!cmd) return;
    updateConfig({
      qualityGateCommands: [...config.qualityGateCommands, cmd],
    });
    setNewCommand('');
  };

  const removeQualityGateCommand = (index: number) => {
    updateConfig({
      qualityGateCommands: config.qualityGateCommands.filter((_, i) => i !== index),
    });
  };

  const refreshRemoteStatus = async () => {
    try {
      setRemoteError(null);
      const [status, activePairingCode, clients] = await Promise.all([
        window.api.invoke('remote:status') as Promise<RemoteServerStatus>,
        window.api.invoke('remote:active-pairing-code') as Promise<RemotePairingCode | null>,
        window.api.invoke('remote:list-clients') as Promise<RemoteClientInfo[]>,
      ]);
      setRemoteStatus(status);
      setPairingCode(activePairingCode);
      setRemoteClients(clients);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Failed to refresh Flux Mobile status');
    }
  };

  const generatePairingCode = async () => {
    try {
      setRemoteError(null);
      const next = await window.api.invoke('remote:create-pairing-code') as RemotePairingCode;
      setPairingCode(next);
      await refreshRemoteStatus();
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Failed to generate pairing code');
    }
  };

  const revokeRemoteClient = async (clientId: string) => {
    try {
      setRemoteError(null);
      await window.api.invoke('remote:revoke-client', { clientId });
      await refreshRemoteStatus();
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : 'Failed to revoke paired client');
    }
  };

  const copyPairingCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode.code);
    } catch {
      // best effort
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOverlay(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="bg-bg-elevated rounded-2xl p-6 max-w-lg w-full mx-4 border border-border shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title="Close settings"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-text-tertiary text-center py-8">Loading...</p>
            ) : (
              <div className="space-y-6">
                {/* Appearance */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Appearance</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Theme</label>
                      <div className="flex gap-1.5">
                        {(['dark', 'light'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => updateConfig({ theme: t })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              config.theme === t
                                ? 'bg-success text-white'
                                : 'bg-bg-primary text-text-secondary border border-border hover:bg-bg-hover'
                            }`}
                          >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">
                        Font Size: {config.fontSize}px
                      </label>
                      <input
                        type="range"
                        min={11}
                        max={18}
                        value={config.fontSize}
                        onChange={(e) => updateConfig({ fontSize: Number(e.target.value) })}
                        className="w-32 accent-accent"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">
                        Zoom: {Math.round((config.zoomLevel ?? 1.0) * 100)}%
                      </label>
                      <input
                        type="range"
                        min={75}
                        max={200}
                        step={5}
                        value={Math.round((config.zoomLevel ?? 1.0) * 100)}
                        onChange={(e) => {
                          const level = Number(e.target.value) / 100;
                          updateConfig({ zoomLevel: level });
                          window.api.invoke('zoom:set', { level });
                        }}
                        className="w-32 accent-accent"
                      />
                    </div>
                  </div>
                </section>

                {/* Input */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Input</h3>
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-text-primary">Send Key</label>
                    <div className="flex gap-1.5">
                      {([
                        { value: 'cmd+enter' as const, label: window.api?.platform === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter' },
                        { value: 'enter' as const, label: 'Enter' },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => updateConfig({ sendKey: opt.value })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            config.sendKey === opt.value
                              ? 'bg-success text-white'
                              : 'bg-bg-primary text-text-secondary border border-border hover:bg-bg-hover'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                {/* Defaults */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Defaults</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm text-text-primary">Quick create mode</label>
                      <div className="flex gap-1.5">
                        {([
                          { value: false, label: 'Isolated' },
                          { value: true, label: 'Direct' },
                        ]).map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => updateConfig({ quickCreateDirect: opt.value })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              Boolean(config.quickCreateDirect) === opt.value
                                ? 'bg-success text-white'
                                : 'bg-bg-primary text-text-secondary border border-border hover:bg-bg-hover'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Default Agent</label>
                      <input
                        type="text"
                        value={config.defaultAgent}
                        onChange={(e) => updateConfig({ defaultAgent: e.target.value })}
                        className="w-40 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Preferred IDE</label>
                      <div className="flex gap-1.5">
                        {IDE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateConfig({ preferredIde: opt.value })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              (config.preferredIde ?? 'code') === opt.value
                                ? 'bg-success text-white'
                                : 'bg-bg-primary text-text-secondary border border-border hover:bg-bg-hover'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Default Model</label>
                      <input
                        type="text"
                        value={config.defaultModel}
                        onChange={(e) => updateConfig({ defaultModel: e.target.value })}
                        className="w-40 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Subagent Model</label>
                      <input
                        type="text"
                        value={config.subagentModel ?? ''}
                        onChange={(e) => updateConfig({ subagentModel: e.target.value })}
                        className="w-40 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus transition-colors"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-sm text-text-primary">Thinking Level</label>
                      <div className="flex gap-1">
                        {thinkingOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateConfig({ defaultThinking: opt.value })}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                              config.defaultThinking === opt.value
                                ? 'bg-success text-white'
                                : 'bg-bg-primary text-text-secondary border border-border hover:bg-bg-hover'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-text-secondary">Flux Mobile</h3>
                    <button
                      type="button"
                      onClick={() => void refreshRemoteStatus()}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                      title="Refresh mobile server status"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-bg-primary/70 p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-sm text-text-primary">
                            <Smartphone size={14} />
                            <span>Remote server</span>
                          </div>
                          <p className="text-xs text-text-tertiary mt-1">
                            {remoteStatus
                              ? `${remoteStatus.hostname}:${remoteStatus.port} · v${remoteStatus.version}`
                              : 'Loading remote status...'}
                          </p>
                          {remoteStatus && (
                            <p className="text-[11px] text-text-tertiary mt-1">
                              {remoteStatus.advertised ? 'mDNS advertised' : 'mDNS unavailable'} · {remoteStatus.connectionCount} active connection{remoteStatus.connectionCount === 1 ? '' : 's'}
                            </p>
                          )}
                          <p className="text-[11px] text-text-tertiary mt-2 max-w-sm">
                            Generate a code here, then enter it on Flux Mobile. Tapping Pair on mobile does not trigger a desktop prompt.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void generatePairingCode()}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-success text-white hover:opacity-90 transition-opacity"
                        >
                          Generate Pairing Code
                        </button>
                      </div>

                      {remoteStatus && remoteStatus.networkAddresses.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-1">LAN addresses</p>
                          <p className="text-xs text-text-secondary font-mono break-all">
                            {remoteStatus.networkAddresses.join(', ')}
                          </p>
                        </div>
                      )}
                    </div>

                    {remoteError && (
                      <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2">
                        <p className="text-xs text-error">{remoteError}</p>
                      </div>
                    )}

                    {pairingCode && (
                      <div className="rounded-xl border border-success/30 bg-success/10 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm text-text-primary">
                              <Shield size={14} />
                              <span>Active pairing code</span>
                            </div>
                            <p className="mt-2 text-lg font-semibold tracking-[0.2em] text-text-primary font-mono">
                              {pairingCode.code}
                            </p>
                            <p className="text-xs text-text-tertiary mt-2">
                              Expires at {new Date(pairingCode.expiresAt).toLocaleTimeString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copyPairingCode()}
                            className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                            title="Copy pairing code"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <p className="text-[11px] text-text-tertiary mt-3">
                          Flux Mobile should store the durable token returned by `auth:pair`. The short-lived pairing code itself is not reusable after pairing.
                        </p>
                      </div>
                    )}

                    <div className="rounded-xl border border-border bg-bg-primary/70 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-medium text-text-secondary">Paired clients</h4>
                        <span className="text-[11px] text-text-tertiary">{remoteClients.length}</span>
                      </div>

                      {remoteClients.length === 0 ? (
                        <p className="text-xs text-text-tertiary">No paired mobile clients yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {remoteClients.map((client) => (
                            <div key={client.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-elevated px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm text-text-primary truncate">{client.clientName}</p>
                                <p className="text-[11px] text-text-tertiary font-mono">
                                  {client.tokenPreview}{client.lastAddress ? ` · ${client.lastAddress}` : ''}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void revokeRemoteClient(client.id)}
                                className="text-[11px] text-red-400 hover:opacity-80 transition-opacity"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Quality Gates */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Quality Gates</h3>
                  <div className="space-y-2">
                    {config.qualityGateCommands.map((cmd, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 bg-bg-primary border border-border rounded-lg px-3 py-2"
                      >
                        <code className="flex-1 text-sm text-text-primary font-mono">{cmd}</code>
                        <button
                          type="button"
                          onClick={() => removeQualityGateCommand(index)}
                          className="p-1 rounded text-text-tertiary hover:text-error transition-colors"
                          title="Remove quality gate command"
                          aria-label="Remove quality gate command"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newCommand}
                        onChange={(e) => setNewCommand(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addQualityGateCommand()}
                        placeholder="npm run test"
                        className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus transition-colors font-mono"
                      />
                      <button
                        type="button"
                        onClick={addQualityGateCommand}
                        className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                        title="Add quality gate command"
                        aria-label="Add quality gate command"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </section>

                <button
                  type="button"
                  onClick={handleSave}
                  className="w-full px-4 py-2 bg-success text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Save
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
