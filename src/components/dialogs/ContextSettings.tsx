import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Eye, Plus, Trash2 } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { useIntelligenceStore } from '../../stores/intelligence';
import type { RepoMapConfig } from '../../stores/intelligence';

const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'gemini': 'Gemini',
  'openai': 'OpenAI',
  'ollama': 'Ollama',
};

export function ContextSettings() {
  const { activeOverlay, setOverlay } = useUiStore();
  const { config, status, setConfig, loadConfig, saveConfig, rebuild, preview } = useIntelligenceStore();

  const [localConfig, setLocalConfig] = useState<RepoMapConfig>(config);
  const [previewText, setPreviewText] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newExclude, setNewExclude] = useState('');
  const [rebuilding, setRebuilding] = useState(false);

  const open = activeOverlay === 'context-settings';

  useEffect(() => {
    if (open) {
      loadConfig();
    }
  }, [open, loadConfig]);

  useEffect(() => {
    if (open) {
      setLocalConfig(config);
    }
  }, [open, config]);

  const handleSave = useCallback(async () => {
    await saveConfig(localConfig);
    setOverlay(null);
  }, [localConfig, saveConfig, setOverlay]);

  const handleRebuild = useCallback(async () => {
    setRebuilding(true);
    await rebuild();
    setRebuilding(false);
  }, [rebuild]);

  const handlePreview = useCallback(async () => {
    const text = await preview(previewPrompt || 'Show me the main components');
    setPreviewText(text);
    setShowPreview(true);
  }, [preview, previewPrompt]);

  const updateLocal = (partial: Partial<RepoMapConfig>) => {
    setLocalConfig((prev) => ({ ...prev, ...partial }));
  };

  const toggleAgentEnabled = (agentId: string) => {
    const current = localConfig.perAgentEnabled[agentId];
    updateLocal({
      perAgentEnabled: {
        ...localConfig.perAgentEnabled,
        [agentId]: current === false ? true : current === true ? false : false,
      },
    });
  };

  const addPattern = () => {
    const p = newPattern.trim();
    if (!p) return;
    updateLocal({ indexedFilePatterns: [...localConfig.indexedFilePatterns, p] });
    setNewPattern('');
  };

  const removePattern = (index: number) => {
    updateLocal({ indexedFilePatterns: localConfig.indexedFilePatterns.filter((_, i) => i !== index) });
  };

  const addExclude = () => {
    const p = newExclude.trim();
    if (!p) return;
    updateLocal({ excludePatterns: [...localConfig.excludePatterns, p] });
    setNewExclude('');
  };

  const removeExclude = (index: number) => {
    updateLocal({ excludePatterns: localConfig.excludePatterns.filter((_, i) => i !== index) });
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
              <h2 className="text-lg font-semibold text-text-primary">Context Intelligence</h2>
              <button
                type="button"
                onClick={() => setOverlay(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Master toggle */}
              <section>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">Repo Map</h3>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      Inject ranked code definitions into agent prompts
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateLocal({ enabled: !localConfig.enabled })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      localConfig.enabled ? 'bg-accent' : 'bg-bg-primary border border-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                        localConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </section>

              {localConfig.enabled && (
                <>
                  {/* Token budget */}
                  <section>
                    <h3 className="text-sm font-medium text-text-secondary mb-3">
                      Token Budget: {localConfig.maxTokens}
                    </h3>
                    <input
                      type="range"
                      min={512}
                      max={8192}
                      step={256}
                      value={localConfig.maxTokens}
                      onChange={(e) => updateLocal({ maxTokens: Number(e.target.value) })}
                      className="w-full accent-accent"
                    />
                    <div className="flex justify-between text-xs text-text-tertiary mt-1">
                      <span>512</span>
                      <span>8192</span>
                    </div>
                  </section>

                  {/* Per-agent toggles */}
                  <section>
                    <h3 className="text-sm font-medium text-text-secondary mb-3">Per-Agent</h3>
                    <div className="space-y-2">
                      {Object.entries(AGENT_LABELS).map(([id, label]) => (
                        <div key={id} className="flex items-center justify-between">
                          <span className="text-sm text-text-primary">{label}</span>
                          <button
                            type="button"
                            onClick={() => toggleAgentEnabled(id)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              localConfig.perAgentEnabled[id] !== false
                                ? 'bg-accent'
                                : 'bg-bg-primary border border-border'
                            }`}
                          >
                            <span
                              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                                localConfig.perAgentEnabled[id] !== false ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* File patterns */}
                  <section>
                    <h3 className="text-sm font-medium text-text-secondary mb-3">Include Patterns</h3>
                    <div className="space-y-2">
                      {localConfig.indexedFilePatterns.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 bg-bg-primary border border-border rounded-lg px-3 py-1.5">
                          <code className="flex-1 text-xs text-text-primary font-mono">{p}</code>
                          <button type="button" onClick={() => removePattern(i)} className="p-0.5 text-text-tertiary hover:text-error">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newPattern}
                          onChange={(e) => setNewPattern(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addPattern()}
                          placeholder="**/*.rs"
                          className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus font-mono"
                        />
                        <button type="button" onClick={addPattern} className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-lg">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Exclude patterns */}
                  <section>
                    <h3 className="text-sm font-medium text-text-secondary mb-3">Exclude Patterns</h3>
                    <div className="space-y-2">
                      {localConfig.excludePatterns.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 bg-bg-primary border border-border rounded-lg px-3 py-1.5">
                          <code className="flex-1 text-xs text-text-primary font-mono">{p}</code>
                          <button type="button" onClick={() => removeExclude(i)} className="p-0.5 text-text-tertiary hover:text-error">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newExclude}
                          onChange={(e) => setNewExclude(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addExclude()}
                          placeholder="vendor/**"
                          className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus font-mono"
                        />
                        <button type="button" onClick={addExclude} className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-lg">
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Auto-refresh toggle */}
                  <section>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-text-primary">Auto-refresh</h3>
                        <p className="text-xs text-text-tertiary mt-0.5">Watch files for changes</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateLocal({ autoRefresh: !localConfig.autoRefresh })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          localConfig.autoRefresh ? 'bg-accent' : 'bg-bg-primary border border-border'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                            localConfig.autoRefresh ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </section>

                  {/* Status */}
                  <section>
                    <h3 className="text-sm font-medium text-text-secondary mb-2">Status</h3>
                    <div className="bg-bg-primary border border-border rounded-lg p-3 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-text-tertiary">State</span>
                        <span className={`font-medium ${
                          status.state === 'ready' ? 'text-success' :
                          status.state === 'building' ? 'text-warning' :
                          status.state === 'error' ? 'text-error' : 'text-text-tertiary'
                        }`}>
                          {status.state}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-tertiary">Files</span>
                        <span className="text-text-primary">{status.parsedFiles} / {status.totalFiles}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-tertiary">Tags</span>
                        <span className="text-text-primary">{status.totalTags}</span>
                      </div>
                      {status.lastBuiltAt && (
                        <div className="flex justify-between">
                          <span className="text-text-tertiary">Last built</span>
                          <span className="text-text-primary">{new Date(status.lastBuiltAt).toLocaleTimeString()}</span>
                        </div>
                      )}
                      {status.errorMessage && (
                        <p className="text-error mt-1">{status.errorMessage}</p>
                      )}
                    </div>
                  </section>

                  {/* Actions */}
                  <section className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleRebuild}
                      disabled={rebuilding}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={rebuilding ? 'animate-spin' : ''} />
                      Rebuild
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-xs text-text-primary hover:bg-bg-hover transition-colors"
                    >
                      <Eye size={12} />
                      Preview
                    </button>
                  </section>

                  {/* Preview */}
                  {showPreview && (
                    <section>
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="text"
                          value={previewPrompt}
                          onChange={(e) => setPreviewPrompt(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
                          placeholder="Enter a sample prompt..."
                          className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-focus"
                        />
                        <button
                          type="button"
                          onClick={handlePreview}
                          className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90"
                        >
                          Go
                        </button>
                      </div>
                      {previewText && (
                        <pre className="bg-bg-primary border border-border rounded-lg p-3 text-xs text-text-primary font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                          {previewText}
                        </pre>
                      )}
                    </section>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={handleSave}
                className="w-full px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
