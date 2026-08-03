'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, Check, MonitorSmartphone, Sparkles } from 'lucide-react';
import { formatMoney, type PlanDraft } from '@/components/admin/signup-plan-card';

/** Gap left above and below the rail when it is pinned, in px. Matches `top-6`. */
const PIN_GAP = 24;

/**
 * Pins the preview rail only while it actually fits in the scrollport.
 *
 * A `position: sticky` box that is taller than the scrollport pins its top and
 * then never moves again, so its tail becomes permanently unreachable. The usual
 * fix — `max-height` plus `overflow-y: auto` — is exactly the nested scrollbar
 * this page must not have. Measuring instead means the rail pins whenever it can
 * and falls back to scrolling with the page when a plan's content is too tall,
 * and in neither case is anything unreachable or trapped.
 *
 * Toggling `position: sticky` does not change the element's height, so the
 * ResizeObserver cannot oscillate.
 */
export function usePreviewPinning<T extends HTMLElement>() {
  /*
    A callback ref, not `useRef`. The rail only mounts once the plans have
    loaded, which is several renders after this hook first runs — an effect keyed
    on `[]` would read a null ref, bail out, and never measure anything again.
    Holding the node in state re-runs the effect at the moment it appears.
  */
  const [rail, setRail] = useState<T | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!rail || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      // The layout's <main> is the only scrollport on the page; window height is
      // a safe fallback if this component is ever mounted outside it.
      const port = rail.closest('main');
      const available = (port?.clientHeight ?? window.innerHeight) - PIN_GAP * 2;
      setPinned(rail.offsetHeight <= available);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    const port = rail.closest('main');
    if (port) observer.observe(port);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [rail]);

  return { railRef: setRail, pinned };
}

/* -------------------------------------------------------------------------- */
/*  The public card, in miniature                                              */
/* -------------------------------------------------------------------------- */

/**
 * Purely decorative: every value shown here is already announced by the form
 * inputs it mirrors, so the whole subtree is hidden from assistive tech to avoid
 * reading the same plan twice.
 *
 * The highlighted state is drawn with a BORDER rather than a `ring` so it reads
 * correctly regardless of what clips it.
 */
export function SignupPlanPreview({
  draft,
  currency,
  interval,
  highlighted,
  visible,
  priceCents,
}: {
  draft: PlanDraft;
  currency: string;
  interval: string;
  highlighted: boolean;
  visible: boolean;
  priceCents: number | null;
}) {
  const bullets = draft.bullets.map((bullet) => bullet.trim()).filter(Boolean);

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex flex-col overflow-hidden rounded-2xl border bg-background p-4 transition-colors',
        highlighted ? 'border-primary/50' : 'border-border',
        !visible && 'opacity-50 saturate-50',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent',
          highlighted ? 'via-primary/60' : 'via-primary/20',
        )}
      />

      {highlighted && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
          <Sparkles className="h-3 w-3" /> Most popular
        </span>
      )}

      <p className="break-words pr-24 text-sm font-semibold tracking-tight text-foreground">
        {draft.name.trim() || 'Plan name'}
      </p>
      <p className="mt-1 break-words text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
        {draft.fleet_band.trim() || 'Fleet band'}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tighter text-foreground">
          {priceCents === null ? '—' : formatMoney(priceCents, currency)}
        </span>
        <span className="text-xs text-muted-foreground">/{interval}</span>
      </div>

      <p className="mt-1.5 break-words text-[11px] leading-snug text-muted-foreground">
        {draft.tagline.trim() || 'Tagline appears here.'}
      </p>

      <div className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground">
        Subscribe <ArrowRight className="h-3.5 w-3.5" />
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        {bullets.length === 0 ? (
          <li className="text-[11px] italic text-muted-foreground">No bullets yet.</li>
        ) : (
          bullets.map((bullet, index) => (
            <li
              key={`${index}-${bullet}`}
              className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
            >
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 break-words">{bullet}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The rail itself                                                            */
/* -------------------------------------------------------------------------- */

export function SignupPlanPreviewPanel({
  planName,
  currency,
  interval,
  highlighted,
  visible,
  dirty,
  draft,
  priceCents,
}: {
  planName: string;
  currency: string;
  interval: string;
  highlighted: boolean;
  visible: boolean;
  dirty: boolean;
  draft: PlanDraft;
  priceCents: number | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 shrink-0 text-primary" />
            <CardTitle className="truncate text-lg">Live preview</CardTitle>
          </div>
          {dirty && <Badge variant="warning">Unsaved</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{planName}</span> as it appears on
          the public pricing page, including edits you have not saved yet.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <SignupPlanPreview
          draft={draft}
          currency={currency}
          interval={interval}
          highlighted={highlighted}
          visible={visible}
          priceCents={priceCents}
        />
        {!visible && (
          <p className="text-xs text-warning">
            Hidden — this card is not on the pricing page right now.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
