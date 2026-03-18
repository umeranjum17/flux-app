import { useEffect, useRef, useState } from 'react';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ANIMATION_DURATION_MS = 540;
const FRAME_MS = 45;

function randomReplacement(char: string): string {
  if (char === ' ') return ' ';
  if (/[A-Z]/.test(char)) {
    return UPPERCASE[Math.floor(Math.random() * UPPERCASE.length)] ?? char;
  }
  if (/[a-z]/.test(char)) {
    return LOWERCASE[Math.floor(Math.random() * LOWERCASE.length)] ?? char;
  }
  if (/[0-9]/.test(char)) {
    return DIGITS[Math.floor(Math.random() * DIGITS.length)] ?? char;
  }
  return char;
}

function buildScrambledLabel(target: string, revealChars: number): string {
  return target
    .split('')
    .map((char, index) => (index < revealChars ? char : randomReplacement(char)))
    .join('');
}

export function AnimatedWorkspaceName({ name }: { name: string }) {
  const [displayName, setDisplayName] = useState(name);
  const previousNameRef = useRef(name);

  useEffect(() => {
    const previousName = previousNameRef.current;
    if (previousName === name) {
      setDisplayName(name);
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / ANIMATION_DURATION_MS);
      const revealChars = Math.floor(name.length * progress);
      setDisplayName(buildScrambledLabel(name, revealChars));

      if (progress >= 1) {
        window.clearInterval(intervalId);
        previousNameRef.current = name;
        setDisplayName(name);
      }
    }, FRAME_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [name]);

  return <>{displayName}</>;
}
