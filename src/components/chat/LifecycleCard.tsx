import React from 'react';
import { motion } from 'framer-motion';
import { CheckSquare, Play, FileText, Eye, GitMerge, Circle } from 'lucide-react';

interface LifecycleCardProps {
  state: string;
  label: string;
}

const stateConfig: Record<string, { icon: React.ElementType; color: string; bg: string; accent: string; shimmer: string }> = {
  working: { icon: Play, color: 'text-accent', bg: 'bg-accent/8', accent: 'bg-accent', shimmer: 'from-accent/0 via-accent/15 to-accent/0' },
  planned: { icon: FileText, color: 'text-info', bg: 'bg-info/8', accent: 'bg-info', shimmer: 'from-info/0 via-info/15 to-info/0' },
  ready_for_review: { icon: CheckSquare, color: 'text-success', bg: 'bg-success/8', accent: 'bg-success', shimmer: 'from-success/0 via-success/15 to-success/0' },
  reviewing: { icon: Eye, color: 'text-warning', bg: 'bg-warning/8', accent: 'bg-warning', shimmer: 'from-warning/0 via-warning/15 to-warning/0' },
  changes_requested: { icon: Eye, color: 'text-error', bg: 'bg-error/8', accent: 'bg-error', shimmer: 'from-error/0 via-error/15 to-error/0' },
  merged: { icon: GitMerge, color: 'text-success', bg: 'bg-success/8', accent: 'bg-success', shimmer: 'from-success/0 via-success/15 to-success/0' },
  completed: { icon: CheckSquare, color: 'text-success', bg: 'bg-success/8', accent: 'bg-success', shimmer: 'from-success/0 via-success/15 to-success/0' },
};

const defaultConfig = { icon: Circle, color: 'text-text-secondary', bg: 'bg-bg-tertiary', accent: 'bg-text-tertiary', shimmer: 'from-white/0 via-white/10 to-white/0' };

const cardTransition = { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const };

export function LifecycleCard({ state, label }: LifecycleCardProps) {
  const config = stateConfig[state] ?? defaultConfig;
  const Icon = config.icon;

  return (
    <motion.div
      className={`my-2 flex items-center gap-2.5 rounded-lg ${config.bg} border border-border-primary px-3 py-2 overflow-hidden relative`}
      initial={{ opacity: 0, y: 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={cardTransition}
    >
      {/* Left accent bar */}
      <motion.div
        className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg ${config.accent}`}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
        style={{ originY: 0.5 }}
      />

      {/* Shimmer overlay */}
      <motion.div
        className={`absolute inset-0 bg-gradient-to-r ${config.shimmer} pointer-events-none`}
        initial={{ x: '-100%' }}
        animate={{ x: '100%', opacity: [0, 0.4, 0] }}
        transition={{ duration: 0.6, ease: 'easeInOut', delay: 0.1 }}
      />

      {/* Icon with pulse */}
      <motion.div
        className="relative z-10 flex items-center"
        initial={{ scale: 0.8 }}
        animate={{ scale: [0.8, 1.1, 1] }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      >
        <Icon size={15} className={config.color} />
      </motion.div>

      <span className={`relative z-10 text-sm font-medium ${config.color}`}>{label}</span>
    </motion.div>
  );
}
