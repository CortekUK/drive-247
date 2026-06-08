import * as React from "react";
import { cn } from "@/lib/utils";
import { Tile } from "./tile";

/**
 * Section card — header (round icon chip + optional number + title + description),
 * divider, then body. Spec: DESIGN_SYSTEM.md §7 (Section card). Group long forms
 * into these.
 */
export function SectionCard({
  icon,
  number,
  title,
  description,
  action,
  children,
  className,
  ...props
}: {
  icon?: React.ReactNode;
  number?: number | string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Tile>, "title">) {
  return (
    <Tile pad="none" className={cn("overflow-hidden", className)} {...props}>
      <div className="flex items-start gap-3 p-5">
        {(icon || number != null) && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile-sm [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)] text-sm font-bold">
            {icon ?? number}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight">{title}</h3>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children != null && (
        <>
          <div className="border-t border-border" />
          <div className="p-5">{children}</div>
        </>
      )}
    </Tile>
  );
}
