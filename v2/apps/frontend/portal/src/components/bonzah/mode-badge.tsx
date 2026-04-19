import type { BonzahMode } from '@drive247/shared-types';

const STYLES: Record<string, string> = {
  test: 'bg-[#f1f5f9] text-[#404040] border border-[#e5e7eb]',
  live: 'bg-[#e0e7ff] text-[#6366f1] border border-[#c7d2fe]',
};

export function ModeBadge({ mode }: { mode: BonzahMode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${STYLES[mode] ?? ''}`}
    >
      {mode}
    </span>
  );
}
