'use client';

import { Maximize2 } from 'lucide-react';

/** The expand icon at the top right of a dashboard card: opens its full view. */
export function ExpandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="-mr-2 flex size-7 items-center justify-center rounded-lg text-[var(--pv-ink-3)] transition-colors hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-accent-ink)]"
    >
      <Maximize2 className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}
