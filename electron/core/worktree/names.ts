const elements = [
  'neon', 'argon', 'zinc', 'iron', 'cobalt', 'nickel', 'copper',
  'silver', 'gold', 'carbon', 'silicon', 'helium', 'lithium', 'boron',
  'titan', 'chrome', 'radium', 'xenon', 'cesium', 'barium', 'osmium',
  'iridium', 'platinum', 'bismuth', 'thorium', 'uranium', 'neptune',
  'pluton', 'krypton', 'sodium',
] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateWorkspaceName(): string {
  const num = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${pick(elements)}-${num}`;
}
