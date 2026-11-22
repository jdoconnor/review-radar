import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * List animation for the PR queues. All of it is cosmetic and none of it
 * delays the data:
 *
 * - Rows that appear pop in with a springy stagger (`phase: "enter"`).
 * - Rows that move glide to their new spot (FLIP, below).
 * - Rows that disappear are gone immediately — the live list, its test ids
 *   and its text are never held back for an animation. Instead a brief
 *   decorative "poof" marker (no row content, aria-hidden) bursts where the
 *   row left, and the surviving rows FLIP-glide to close the gap.
 *
 * Reduced-motion preferences turn the whole thing off.
 */

export type RowPhase = "enter" | "stay";

export interface AnimatedEntry<T> {
  item: T;
  key: string;
  phase: RowPhase;
  /** Position within the batch that entered together; drives the stagger. */
  enterIndex: number;
}

export interface Poof {
  id: number;
  /** Index in the rendered list the departed row left from. */
  index: number;
}

export interface AnimatedList<T> {
  entries: AnimatedEntry<T>[];
  poofs: Poof[];
}

const ENTER_CLEAR_MS = 900;
const POOF_MS = 500;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useAnimatedList<T>(
  items: readonly T[],
  getKey: (item: T) => string,
): AnimatedList<T> {
  const [entering, setEntering] = useState<ReadonlyMap<string, number>>(new Map());
  const [poofs, setPoofs] = useState<Poof[]>([]);
  const prevKeys = useRef<readonly string[]>([]);
  const poofId = useRef(0);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    const prev = prevKeys.current;
    const currentKeys = items.map(getKey);
    const currentSet = new Set(currentKeys);
    const prevSet = new Set(prev);

    const departedIndexes = prev
      .map((key, index) => (currentSet.has(key) ? -1 : index))
      .filter((index) => index >= 0);
    const arrived = items.filter((item) => !prevSet.has(getKey(item)));

    prevKeys.current = currentKeys;

    if (departedIndexes.length > 0 && !prefersReducedMotion()) {
      const fresh = departedIndexes.map((index) => ({ id: ++poofId.current, index }));
      setPoofs((current) => [...current, ...fresh]);
      const freshIds = new Set(fresh.map((poof) => poof.id));
      const timer = setTimeout(() => {
        if (!mounted.current) return;
        setPoofs((current) => current.filter((poof) => !freshIds.has(poof.id)));
      }, POOF_MS);
      timers.current.push(timer);
    }

    if (arrived.length > 0) {
      const arrivedIndex = new Map(arrived.map((item, i) => [getKey(item), i]));
      setEntering((current) => {
        const next = new Map(current);
        for (const [key, index] of arrivedIndex) next.set(key, index);
        return next;
      });
      const arrivedKeys = new Set(arrivedIndex.keys());
      const timer = setTimeout(() => {
        if (!mounted.current) return;
        setEntering((current) => {
          if (![...arrivedKeys].some((key) => current.has(key))) return current;
          const next = new Map(current);
          for (const key of arrivedKeys) next.delete(key);
          return next;
        });
      }, ENTER_CLEAR_MS);
      timers.current.push(timer);
    }
  }, [items, getKey]);

  const entries: AnimatedEntry<T>[] = items.map((item) => {
    const key = getKey(item);
    const enterIndex = entering.get(key);
    return {
      item,
      key,
      phase: enterIndex === undefined ? "stay" : "enter",
      enterIndex: enterIndex ?? 0,
    };
  });
  return { entries, poofs };
}

/**
 * FLIP for reorders: after a render, any row carrying `data-flip-key` whose
 * top moved since the previous render is started at its old position and
 * transitioned home, so a poll that re-sorts the queue — or a departure that
 * pulls the rows below it up — reads as gliding instead of teleporting.
 * Entering rows are skipped; they have their own animation.
 */
export function useFlipAnimation(containerRef: RefObject<HTMLElement | null>): void {
  const prevTops = useRef<ReadonlyMap<string, number>>(new Map());

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const next = new Map<string, number>();
    const reduced = prefersReducedMotion();
    root.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((el) => {
      const key = el.dataset.flipKey;
      if (!key) return;
      const top = el.getBoundingClientRect().top;
      next.set(key, top);
      const prevTop = prevTops.current.get(key);
      if (reduced || prevTop === undefined || el.dataset.phase !== "stay") return;
      const delta = prevTop - top;
      if (Math.abs(delta) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
      raf(() => {
        el.style.transition = "transform 380ms cubic-bezier(0.22, 1.2, 0.36, 1)";
        el.style.transform = "";
        setTimeout(() => {
          el.style.transition = "";
        }, 400);
      });
    });
    prevTops.current = next;
  });
}
