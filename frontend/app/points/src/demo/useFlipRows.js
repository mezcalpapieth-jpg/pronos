/**
 * FLIP animation for reordering lists.
 *
 * The tournament table re-renders rows in their new order the instant the
 * data changes, which on camera reads as a glitch rather than as someone
 * climbing the rankings. This measures each row before and after the
 * reorder, drops it back where it started, and lets it slide to its new
 * position.
 *
 * Inert unless `enabled` — production traffic keeps the plain instant table.
 */
import { useLayoutEffect, useRef } from 'react';

const SLIDE_MS = 620;
const FLASH_MS = 900;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function useFlipRows(containerRef, orderKey, enabled) {
  const previousTops = useRef(new Map());

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const nodes = container.querySelectorAll('[data-flip-key]');
    const nextTops = new Map();

    // Offsets are measured against the container, not the viewport. Using
    // viewport coordinates means any scroll between two renders is read as
    // a reorder, which produced thousand-pixel slides.
    const containerTop = container.getBoundingClientRect().top;
    const containerHeight = container.getBoundingClientRect().height || 0;

    nodes.forEach(node => {
      const key = node.getAttribute('data-flip-key');
      const top = node.getBoundingClientRect().top - containerTop;
      nextTops.set(key, top);

      const before = previousTops.current.get(key);
      if (before === undefined) return;

      const delta = before - top;
      // Sub-pixel jitter isn't a move; anything taller than the list itself
      // is a remount or layout change, not a rank change.
      if (Math.abs(delta) < 1 || Math.abs(delta) > containerHeight) return;

      // Put it back where it was, then release it on the next frame.
      node.style.transition = 'none';
      node.style.transform = `translateY(${delta}px)`;

      // Climbing rows get a brief tint so the eye follows the movement.
      const climbed = delta > 0;

      requestAnimationFrame(() => {
        node.style.transition = `transform ${SLIDE_MS}ms ${EASING}`;
        node.style.transform = '';
        if (climbed) {
          node.style.backgroundColor = 'rgba(34, 197, 94, 0.14)';
          window.setTimeout(() => {
            node.style.transition = `background-color ${FLASH_MS}ms ease-out`;
            node.style.backgroundColor = '';
          }, SLIDE_MS * 0.5);
        }
      });
    });

    previousTops.current = nextTops;
  }, [containerRef, orderKey, enabled]);
}
