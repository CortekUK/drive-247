"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small copy button that appears when its surrounding `group/copy` is
 * hovered (or when it takes keyboard focus), copies `value`, and turns into a
 * tick for a moment. The click never reaches the row it sits in, so copying an
 * invoice number from the table does not also open the invoice.
 *
 * The parent sets `group/copy` on whatever area should reveal it — a table row,
 * a heading. Motion is the app's: a 200ms opacity fade, both ways.
 */
export function CopyOnHover({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard refused (insecure context, permissions): stay quiet —
          // the number is on screen to select by hand.
        }
      }}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground",
        "opacity-0 transition-opacity duration-200 ease-in group-hover/copy:opacity-100 group-hover/copy:ease-out focus-visible:opacity-100",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        copied && "opacity-100 text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
