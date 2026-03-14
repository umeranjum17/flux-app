import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Brain } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useAgentStore } from '../../stores/agent';
import type { FluxConfig } from '../../lib/ipc-api';
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
  zoomLevel: 1.0,
  qualityGateCommands: [],
  qualityGateMaxRetries: 2,
  customAgentPaths: {},
  recentProjects: [],
  recentSshHosts: [],
  repoMap: {
    enabled: false,
    maxTokens: 2048,
    indexedFilePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py'],
    excludePatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
    perAgentEnabled: {},
    autoRefresh: true,
  },
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
  const { activeOverlay, setOverlay, setTheme, setSendKey } = useUiStore();
  const [config, setConfig] = useState<FluxConfig>(defaultConfig);
  const [newCommand, setNewCommand] = useState('');
  const [loading, setLoading] = useState(true);

  const open = activeOverlay === 'settings';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    window.api.invoke('config:get').then((cfg) => {
      setConfig(cfg as FluxConfig);
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

                {/* Context Intelligence */}
                <section>
                  <h3 className="text-sm font-medium text-text-secondary mb-3">Context Intelligence</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setOverlay('context-settings');
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-sm text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    <Brain size={14} />
                    Configure Repo Map
                    <span className="ml-auto text-xs text-text-tertiary">
                      {config.repoMap?.enabled ? 'On' : 'Off'}
                    </span>
                  </button>
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
