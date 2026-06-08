"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tile } from "./tile";
import { dur, ease } from "@/lib/motion";

/**
 * Required-state components. Spec: DESIGN_SYSTEM.md §9 + ANIMATION.md §3.
 * Every data view ships loading / empty / error states (light + dark).
 */

/** Empty state — friendly tile with icon, one line, and primary action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Tile className={cn("flex flex-col items-center gap-3 py-14 text-center", className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold tracking-tight">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </Tile>
  );
}

/** Error state — danger-tinted tile with a retry. */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Tile
      className={cn(
        "flex flex-col items-center gap-3 py-12 text-center [background:var(--bento-danger-weak)] border-transparent",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background text-[color:var(--bento-danger-fg)]">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-bold tracking-tight text-[color:var(--bento-danger-fg)]">
          {title}
        </h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-[color:var(--bento-danger-fg)]/80">
            {description}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1 gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </Tile>
  );
}

/**
 * Cross-fade wrapper for skeleton → content. Spec: ANIMATION.md §3 (never a
 * hard cut). Render the skeleton while `loading`, content otherwise.
 */
export function StateSwitch({
  loading,
  skeleton,
  children,
}: {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const transition = reduce
    ? { duration: 0.1 }
    : { duration: dur.md, ease: ease.out };
  return (
    <motion.div
      key={loading ? "skeleton" : "content"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition}
    >
      {loading ? skeleton : children}
    </motion.div>
  );
}
