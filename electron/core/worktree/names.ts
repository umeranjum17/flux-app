const adjectives = [
  'bold', 'calm', 'cool', 'dark', 'deep', 'dry', 'fair', 'fast', 'firm',
  'free', 'glad', 'gold', 'gray', 'keen', 'kind', 'late', 'lean', 'live',
  'long', 'loud', 'main', 'mild', 'neat', 'open', 'pale', 'pure', 'rare',
  'raw', 'real', 'rich', 'ripe', 'safe', 'shy', 'slim', 'slow', 'soft',
  'sour', 'tall', 'thin', 'true', 'vast', 'warm', 'wide', 'wild', 'wise',
  'apt', 'big', 'dim', 'dry', 'fit', 'hot', 'icy', 'lit', 'odd', 'red',
  'tan', 'wry', 'zen', 'arid', 'blue', 'cozy', 'deft', 'even', 'flat',
  'gray', 'hazy', 'jade', 'lush', 'mint', 'neon', 'opal', 'pink', 'rosy',
  'rust', 'sage', 'teal', 'wavy', 'ashy', 'bone', 'coal', 'dusk', 'echo',
  'fawn', 'gilt', 'hemp', 'iron', 'java', 'knit', 'lime', 'moss', 'navy',
  'onyx', 'plum', 'reed', 'silk', 'vine', 'wax', 'zinc',
] as const;

const animals = [
  'ant', 'ape', 'bat', 'bee', 'bug', 'cat', 'cod', 'cow', 'cub', 'doe',
  'dog', 'eel', 'elk', 'emu', 'ewe', 'fly', 'fox', 'gnu', 'hen', 'hog',
  'jay', 'kit', 'koi', 'owl', 'ox', 'pig', 'pug', 'ram', 'rat', 'ray',
  'yak', 'bear', 'boar', 'buck', 'bull', 'carp', 'clam', 'colt', 'crab',
  'crow', 'dart', 'deer', 'dove', 'duck', 'fawn', 'fish', 'frog', 'goat',
  'gull', 'hare', 'hawk', 'ibis', 'lamb', 'lark', 'lion', 'lynx', 'mink',
  'mole', 'moth', 'mule', 'newt', 'puma', 'seal', 'slug', 'swan', 'toad',
  'vole', 'wasp', 'wren', 'wolf', 'crane', 'eagle', 'finch', 'gecko',
  'goose', 'heron', 'horse', 'hyena', 'koala', 'lemur', 'llama', 'moose',
  'mouse', 'otter', 'panda', 'quail', 'raven', 'robin', 'shark', 'sheep',
  'skunk', 'sloth', 'snail', 'snake', 'squid', 'stork', 'tiger', 'trout',
  'viper', 'whale', 'zebra',
] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateWorkspaceName(): string {
  const suffix = Math.random().toString(36).slice(2, 4);
  return `${pick(adjectives)}-${pick(animals)}-${suffix}`;
}
