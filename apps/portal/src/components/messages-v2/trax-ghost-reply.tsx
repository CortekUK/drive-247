"use client";

/**
 * Trax typing a suggested reply into the empty composer.
 *
 * While the box is empty, Trax types its first suggestion as ghost text, holds
 * it for a moment, clears it and types the next — round and round until the
 * operator either starts typing (the ghost steps aside at once) or presses Tab
 * (the WHOLE current suggestion lands in the box, even mid-type).
 *
 * Timing: ~26ms a character reads as somebody typing rather than a reveal, a
 * 2.6s hold is long enough to read a full line, and the erase is quick so the
 * gap between ideas never feels like waiting. Reduced motion skips the typing
 * and simply swaps whole suggestions on the same hold.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRightToLine } from "lucide-react";
import { TraxMark } from "@/components/trax/trax-greeting";

const TYPE_MS = 26;
const ERASE_MS = 9;
const HOLD_MS = 2600;
const GAP_MS = 350;

/**
 * Runs the type → hold → erase → next loop over `suggestions`.
 * Returns what is on screen and the full suggestion it belongs to.
 */
export function useTraxGhost(suggestions: string[], active: boolean) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState("");
  const key = suggestions.join("\u0000");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* A new conversation (or a new last message) starts from the first idea. */
  useEffect(() => {
    setIndex(0);
    setShown("");
  }, [key]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!active || suggestions.length === 0) {
      setShown("");
      return;
    }
    const full = suggestions[index % suggestions.length];
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let cancelled = false;
    const step = (fn: () => void, ms: number) => {
      timer.current = setTimeout(() => { if (!cancelled) fn(); }, ms);
    };

    if (reduce) {
      setShown(full);
      step(() => setIndex((i) => i + 1), HOLD_MS);
      return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
    }

    let n = 0;
    const type = () => {
      n += 1;
      setShown(full.slice(0, n));
      if (n < full.length) step(type, TYPE_MS);
      else step(erase, HOLD_MS);
    };
    const erase = () => {
      n -= 3;
      setShown(full.slice(0, Math.max(0, n)));
      if (n > 0) step(erase, ERASE_MS);
      else step(() => setIndex((i) => i + 1), GAP_MS);
    };
    setShown("");
    step(type, GAP_MS);

    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
    // `key` covers `suggestions`' content; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, key, active]);

  const current = suggestions.length ? suggestions[index % suggestions.length] : "";
  return { shown, current };
}

/**
 * The ghost itself — laid over the textarea with the SAME padding and type
 * size, so the letters sit exactly where the operator's own would. It never
 * takes a click; the textarea underneath stays the real control.
 *
 * The Trax mark is NOT part of this line — it hangs in the composer's left
 * gutter (`TraxGutterMark`), so the real caret, this ghost and the operator's
 * own typing all start at the same x. Only once the line is fully written does
 * it end with the Tab keycap and the variation's label — the key appears at
 * the moment there is a whole reply to take, where the eye already is.
 */
export function TraxGhostText({
  text,
  done,
  label,
  className,
}: {
  text: string;
  /** The whole suggestion is on screen — time to offer Tab. */
  done: boolean;
  /** Which variation this is ("Friendly", "In depth", "Next step"). */
  label?: string;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}>
      <span className="whitespace-pre-wrap break-words text-muted-foreground/70">{text}</span>
      {done ? (
        <>
          <TabKey />
          {label && (
            <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-primary/45 dark:text-[hsl(var(--v2-link,var(--primary))_/_0.55)]">
              {label}
            </span>
          )}
        </>
      ) : (
        <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[3px] animate-pulse bg-primary/60 motion-reduce:animate-none" />
      )}
    </div>
  );
}

/**
 * The dimmed Trax mark in the composer's left gutter — who suggests, sitting
 * beside the line rather than inside it. Positioned to the first line's
 * centre: `top-4` is the textarea's `pt-4`, and the 20px mark matches its
 * 20px line height.
 */
export function TraxGutterMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute left-5 top-4">
      <TraxMark size="xs" className="opacity-40 grayscale-[30%]" />
    </span>
  );
}

/**
 * A keycap, drawn as a key — a light face, a rim and a thicker bottom edge so
 * it reads as something you press — carrying the Tab glyph (→|) beside the
 * word, as printed on the physical key. Fades in rather than popping.
 */
function TabKey() {
  return (
    <kbd className="ml-2 inline-flex h-[18px] -translate-y-px items-center gap-1 rounded-[5px] border border-b-2 border-border bg-card px-1.5 align-middle text-[10px] font-semibold leading-none text-muted-foreground shadow-[0_1px_1px_hsl(var(--foreground)/0.06)] animate-in fade-in duration-200 motion-reduce:animate-none">
      Tab
      <ArrowRightToLine className="h-2.5 w-2.5" strokeWidth={2.5} />
    </kbd>
  );
}
