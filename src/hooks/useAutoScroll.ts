import { useRef, useCallback, useLayoutEffect, useState } from 'react';

/**
 * Auto-scroll hook that keeps the container pinned to the bottom during
 * streaming.  Uses `useLayoutEffect` so the scroll adjustment happens
 * *before* the browser paints, eliminating the visible "snap" that
 * `useEffect` caused (content would render at the old scroll position for
 * one frame, then jump).
 *
 * The scroll is also throttled: at most one `scrollTop` write per animation
 * frame, so rapid Zustand updates (e.g. 30 Hz delta flushes) don't cause
 * layout thrashing.
 */
export function useAutoScroll(deps: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const rafRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    // Throttle: schedule at most one scroll per animation frame
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
  }, []);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  // useLayoutEffect runs synchronously after DOM mutations but before paint,
  // so the scroll correction is invisible to the user.
  useLayoutEffect(() => {
    if (isAtBottom) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Clean up any pending RAF on unmount
  useLayoutEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return { containerRef, isAtBottom, scrollToBottom, handleScroll };
}
