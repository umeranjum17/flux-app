const ADJECTIVES = [
  'amber', 'arctic', 'azure', 'bold', 'brisk', 'calm', 'cedar', 'clean',
  'clever', 'coral', 'cosmic', 'crisp', 'dawn', 'deep', 'deft', 'eager',
  'fast', 'fresh', 'gentle', 'golden', 'grand', 'keen', 'lunar', 'misty',
  'noble', 'quiet', 'rapid', 'rustic', 'serene', 'silver', 'solar', 'swift',
];

const NOUNS = [
  'anchor', 'arrow', 'atlas', 'beacon', 'birch', 'blade', 'canyon', 'cedar',
  'cliff', 'comet', 'crane', 'delta', 'dune', 'falcon', 'fjord', 'forge',
  'glade', 'grove', 'harbor', 'haven', 'helm', 'mesa', 'orbit', 'peak',
  'pilot', 'prism', 'quill', 'reef', 'ridge', 'ripple', 'tide', 'trail',
];

export function generateWorkspaceName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective}-${noun}`;
}
