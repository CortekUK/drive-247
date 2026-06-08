"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { springs, ease, dur } from "@/lib/motion";

/**
 * Process overlay — frosted overlay that steps through real backend stages with
 * a spinner→check per step + progress bar, ending on success. Spec:
 * DESIGN_SYSTEM.md §9 (Submitting/processing) + ANIMATION.md §3 (overlays).
 *
 * Drive with `steps` (labels) and the current `activeIndex`; pass
 * `activeIndex >= steps.length` to show the final success state.
 */
export interface ProcessStep {
  label: string;
}

export function ProcessOverlay({
  open,
  steps,
  activeIndex,
  title = "Working…",
  successLabel = "Done!",
}: {
  open: boolean;
  steps: ProcessStep[];
  activeIndex: number;
  title?: string;
  successLabel?: string;
}) {
  const reduce = useReducedMotion();
  const done = activeIndex >= steps.length;
  const progress = Math.min(100, Math.round((activeIndex / steps.length) * 100));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.sm }}
        >
          <motion.div
            className="w-[min(92vw,420px)] rounded-[24px] border border-border bg-card p-6 shadow-bento-hero"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={reduce ? { duration: dur.sm } : springs.pop}
          >
            <h3 className="text-base font-bold tracking-tight">
              {done ? successLabel : title}
            </h3>

            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full [background:var(--bento-tile-2)]">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${done ? 100 : progress}%` }}
                transition={{ duration: dur.md, ease: ease.out }}
              />
            </div>

            <ul className="mt-4 space-y-2.5">
              {steps.map((step, i) => {
                const complete = i < activeIndex || done;
                const active = i === activeIndex && !done;
                return (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                        complete
                          ? "[background:var(--bento-success-weak)] text-[color:var(--bento-success)]"
                          : active
                            ? "[background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]"
                            : "[background:var(--bento-tile-2)] text-[color:var(--bento-text-3)]",
                      )}
                    >
                      {complete ? (
                        <Check className="h-3 w-3" />
                      ) : active ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      )}
                    </span>
                    <span
                      className={cn(
                        complete || active ? "text-foreground" : "text-[color:var(--bento-text-3)]",
                      )}
                    >
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
