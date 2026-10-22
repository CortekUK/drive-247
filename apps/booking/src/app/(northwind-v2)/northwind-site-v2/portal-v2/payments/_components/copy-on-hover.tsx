'use client';

/**
 * The operator's CopyOnHover (apps/portal components/finances-v2/copy-on-hover.tsx),
 * on the customer portal's tokens: a small copy button that appears while its
 * surrounding `group/copy` is hovered (or when it takes keyboard focus), copies
 * `value`, and turns into a tick for a moment. The click never reaches the row
 * it sits in, so copying an invoice number does not also open the invoice.
 */

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';

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
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard refused: stay quiet, the number is on screen to select.
        }
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-pv-muted-fg',
        'opacity-0 transition-opacity duration-200 ease-in group-hover/copy:opacity-100 group-hover/copy:ease-out focus-visible:opacity-100',
        'hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none',
        copied && 'text-emerald-600 opacity-100 dark:text-emerald-400',
        className,
      )}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
