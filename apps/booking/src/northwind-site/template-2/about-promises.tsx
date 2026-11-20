'use client';

/**
 * Template 2 ("Glass") — About's promises (`about / why_choose_us`), as a
 * picker: the operator's promises listed on the left, the one chosen set
 * large on the right. One at a time, because each is a sentence worth
 * reading, not a tile to skim. Nothing changes until someone picks.
 */

import { useState } from 'react';

import { Editable } from '@nw/lib/cms/editable';
import { resolveIcon } from '@nw/lib/cms/icons';
import { cn } from '@nw/lib/utils';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

export type PromiseItem = { index: number; icon: string; title: string; description: string };

export function AboutPromises({ items }: { items: PromiseItem[] }) {
  const [current, setCurrent] = useState(0);
  const chosen = items[Math.min(current, items.length - 1)];
  if (!chosen) return null;
  const ChosenIcon = resolveIcon(chosen.icon);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div role="tablist" aria-label="Our promises" aria-orientation="vertical" className="g2-well g2-tray flex flex-col gap-1 rounded-[28px] p-2">
        {items.map((item, i) => {
          const Icon = resolveIcon(item.icon);
          const on = i === current;
          return (
            <button
              key={item.index}
              id={`g2-promise-${item.index}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="g2-promise-panel"
              onClick={() => setCurrent(i)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                const next = (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                setCurrent(next);
                document.getElementById(`g2-promise-${items[next].index}`)?.focus();
              }}
              tabIndex={on ? 0 : -1}
              className={cn(
                'flex items-center gap-3.5 rounded-[22px] px-4 py-4 text-left transition-colors duration-200',
                on ? 'bg-white shadow-[0_10px_24px_-14px_rgb(13_12_29/0.5),inset_0_1px_0_#fff]' : 'hover:bg-white/55',
                FOCUS,
              )}
            >
              <span aria-hidden className={cn('grid size-11 shrink-0 place-items-center rounded-full', on ? 'g2-cta' : 'bg-white/80 text-[var(--g2-accent-ink)]')}>
                <Icon className="size-5" strokeWidth={2} />
              </span>
              <span className={cn('text-[16px] font-semibold tracking-[-0.02em]', on ? 'text-[var(--g2-ink)]' : 'text-[var(--g2-ink-soft)]')}>{item.title}</span>
            </button>
          );
        })}
      </div>

      <div
        id="g2-promise-panel"
        role="tabpanel"
        aria-labelledby={`g2-promise-${chosen.index}`}
        className="flex min-h-[260px] flex-col justify-end rounded-[28px] bg-white/70 px-6 py-8 shadow-[inset_0_1px_0_#fff,0_18px_40px_-30px_rgb(13_12_29/0.45)] sm:px-10 sm:py-10"
      >
        <div key={chosen.index} className="g2-msg-in">
          <ChosenIcon aria-hidden className="size-8 text-[var(--g2-accent-ink)]" strokeWidth={1.75} />
          <p className="mt-6 text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[38px]">
            <Editable path={`about.why_choose_us.items.${chosen.index}.title`}>{chosen.title}</Editable>
          </p>
          {chosen.description ? (
            <p className="mt-4 max-w-[34rem] text-[17px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[19px]">
              <Editable path={`about.why_choose_us.items.${chosen.index}.description`}>{chosen.description}</Editable>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
