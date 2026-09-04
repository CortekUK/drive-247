'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  BadgeDollarSign,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  SignupPlanCard,
  buildPatch,
  draftFromPlan,
  formatMoney,
  hasContentErrors,
  isDirty,
  parsePriceToCents,
  validateContent,
  type PlanDraft,
  type SignupPlan,
} from '@/components/admin/signup-plan-card';
import {
  SignupPlanPreviewPanel,
  usePreviewPinning,
} from '@/components/admin/signup-plan-preview';

/* -------------------------------------------------------------------------- */
/*  Types local to the page                                                    */
/* -------------------------------------------------------------------------- */

interface FnFailure {
  message: string;
  code?: string;
}

interface FnResult {
  data: unknown;
  failure: FnFailure | null;
}

/* -------------------------------------------------------------------------- */
/*  Safe parsing — the edge response is `unknown`, never trusted as a shape     */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `bullets` is jsonb. Postgres may hand it back as an array or, via some clients, a JSON string. */
function asBullets(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      // not JSON — treat as no bullets rather than crashing the page
    }
  }
  return [];
}

function parsePlan(raw: unknown): SignupPlan | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;
  return {
    id,
    plan_key: asString(raw.plan_key),
    name: asString(raw.name),
    tagline: asNullableString(raw.tagline),
    fleet_band: asNullableString(raw.fleet_band),
    max_vehicles: asNullableNumber(raw.max_vehicles),
    amount_cents: asNumber(raw.amount_cents, 0),
    currency: asString(raw.currency) || 'usd',
    interval: asString(raw.interval) || 'month',
    bullets: asBullets(raw.bullets),
    is_highlighted: raw.is_highlighted === true,
    is_visible: raw.is_visible === true,
    sort_order: asNumber(raw.sort_order, 0),
    stripe_price_id: asNullableString(raw.stripe_price_id),
    stripe_lookup_key: asNullableString(raw.stripe_lookup_key),
    price_version: asNullableNumber(raw.price_version),
    updated_at: asString(raw.updated_at),
  };
}

function sortPlans(plans: SignupPlan[]): SignupPlan[] {
  return [...plans].sort(
    (a, b) => a.sort_order - b.sort_order || a.plan_key.localeCompare(b.plan_key),
  );
}

function parsePlanList(raw: unknown): SignupPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: SignupPlan[] = [];
  for (const item of raw) {
    const plan = parsePlan(item);
    if (plan) plans.push(plan);
  }
  return sortPlans(plans);
}

/* -------------------------------------------------------------------------- */
/*  Edge function plumbing                                                     */
/* -------------------------------------------------------------------------- */

/**
 * supabase-js returns a generic FunctionsHttpError on a non-2xx response; the real
 * `{ error, code }` body lives on `.context` (the raw Response). Same trick the
 * tenant-detail page uses — extended here to also surface `code`, because
 * STALE_WRITE and LAST_VISIBLE need distinct handling, not a generic red toast.
 */
async function readFnFailure(err: unknown, fallback: string): Promise<FnFailure> {
  if (isRecord(err)) {
    const context = err.context;
    if (isRecord(context) && typeof context.json === 'function') {
      try {
        const json = context.json as () => Promise<unknown>;
        const body: unknown = await json();
        if (isRecord(body)) {
          const message = typeof body.error === 'string' ? body.error : undefined;
          const code = typeof body.code === 'string' ? body.code : undefined;
          if (message || code) return { message: message ?? fallback, code };
        }
      } catch {
        // body already consumed or not JSON — fall through
      }
    }
  }
  if (err instanceof Error && err.message) return { message: err.message };
  return { message: fallback };
}

async function callPlansFn(
  body: Record<string, unknown>,
  fallback: string,
): Promise<FnResult> {
  const { data, error } = await supabase.functions.invoke<unknown>(
    'manage-signup-plans',
    { body },
  );

  if (error) {
    return { data: null, failure: await readFnFailure(error, fallback) };
  }

  // A 200 can still carry `{ error, code }`.
  if (isRecord(data) && typeof data.error === 'string') {
    return {
      data: null,
      failure: {
        message: data.error,
        code: typeof data.code === 'string' ? data.code : undefined,
      },
    };
  }

  return { data, failure: null };
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function SignupPlansPage() {
  const [plans, setPlans] = useState<SignupPlan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleWrite, setStaleWrite] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /** Which plan the preview rail mirrors. Never stored as a fallback — see `activePlan`. */
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  /** `${planId}:${action}` while a mutation is in flight. Blocks every mutating control. */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;

  const [pricePlanId, setPricePlanId] = useState<string | null>(null);
  const cancelPriceRef = useRef<HTMLButtonElement>(null);

  /** Pins the rail while it fits the scrollport; never introduces a scroll region. */
  const { railRef, pinned } = usePreviewPinning<HTMLElement>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setStatus('Loading signup plans…');

    const { data, failure } = await callPlansFn(
      { action: 'list' },
      'Could not load signup plans.',
    );

    if (failure) {
      setLoadError(failure.message);
      setStatus(`Could not load signup plans. ${failure.message}`);
      setLoading(false);
      return;
    }

    const parsed = parsePlanList(isRecord(data) ? data.plans : null);
    setPlans(parsed);
    setDrafts(
      Object.fromEntries(parsed.map((plan) => [plan.id, draftFromPlan(plan)])),
    );
    setStaleWrite(null);
    setStatus(`Loaded ${parsed.length} signup plan${parsed.length === 1 ? '' : 's'}.`);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleCount = useMemo(
    () => plans.filter((plan) => plan.is_visible).length,
    [plans],
  );

  const pricePlan = useMemo(
    () => plans.find((plan) => plan.id === pricePlanId) ?? null,
    [plans, pricePlanId],
  );

  /**
   * Resolved rather than stored, so a reload that renames or drops a plan can never
   * leave the rail pointing at an id that no longer exists.
   */
  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? plans[0] ?? null,
    [plans, activePlanId],
  );

  /** Replace one row in place, leaving every other plan's unsaved draft untouched. */
  const replacePlan = useCallback((next: SignupPlan) => {
    setPlans((current) =>
      sortPlans(current.map((plan) => (plan.id === next.id ? next : plan))),
    );
  }, []);

  const updateDraft = useCallback((planId: string, patch: Partial<PlanDraft>) => {
    setDrafts((current) => {
      const existing = current[planId];
      if (!existing) return current;
      return { ...current, [planId]: { ...existing, ...patch } };
    });
  }, []);

  /** STALE_WRITE must not silently reload — that would eat whatever the admin just typed. */
  const handleFailure = useCallback(
    (plan: SignupPlan, failure: FnFailure) => {
      if (failure.code === 'STALE_WRITE') {
        setStaleWrite(plan.name || plan.plan_key);
        setStatus(
          `Could not save ${plan.name}. Another admin changed this plan since you loaded it.`,
        );
        toast.error(`"${plan.name}" changed while you were editing it.`, {
          description:
            'Another admin saved this plan since you loaded the page. Reload to get their version — your unsaved edits here will be replaced.',
          duration: 10000,
        });
        return;
      }

      if (failure.code === 'LAST_VISIBLE') {
        setStatus(`Could not hide ${plan.name}. ${failure.message}`);
        toast.error(failure.message || 'At least one plan must stay visible.');
        void load();
        return;
      }

      setStatus(`Could not update ${plan.name}. ${failure.message}`);
      toast.error(failure.message);
    },
    [load],
  );

  /* ---------------------------- mutations -------------------------------- */

  const handleSaveContent = async (plan: SignupPlan) => {
    const draft = drafts[plan.id];
    if (!draft || busy) return;

    const errors = validateContent(draft);
    if (hasContentErrors(errors)) {
      setStatus(`${plan.name} was not saved — fix the highlighted fields.`);
      toast.error('Fix the highlighted fields before saving.');
      return;
    }

    const patch = buildPatch(plan, draft);
    if (Object.keys(patch).length === 0) return;

    setPending(`${plan.id}:content`);
    setStatus(`Saving ${plan.name}…`);

    const { data, failure } = await callPlansFn(
      { action: 'update', id: plan.id, patch, updated_at: plan.updated_at },
      `Could not save "${plan.name}".`,
    );

    if (failure) {
      handleFailure(plan, failure);
      setPending(null);
      return;
    }

    const next = parsePlan(isRecord(data) ? data.plan : null);
    if (next) {
      replacePlan(next);
      // Resync the content fields from the server's canonical row, but keep whatever
      // price the admin has typed — price is a separate action and saving the card
      // must not silently throw away a pending price edit.
      setDrafts((current) => ({
        ...current,
        [next.id]: { ...draftFromPlan(next), price: draft.price },
      }));
    }

    setStatus(`${plan.name} saved.`);
    toast.success(`"${next?.name ?? plan.name}" updated — the pricing page shows it now.`);
    setPending(null);
  };

  const handleConfirmPrice = async () => {
    if (!pricePlan || busy) return;
    const draft = drafts[pricePlan.id];
    if (!draft) return;

    const parsed = parsePriceToCents(draft.price);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    setPending(`${pricePlan.id}:price`);
    setStatus(`Creating a new Stripe price for ${pricePlan.name}…`);

    const { data, failure } = await callPlansFn(
      {
        action: 'update-price',
        id: pricePlan.id,
        amount_cents: parsed.cents,
        updated_at: pricePlan.updated_at,
      },
      `Could not change the price of "${pricePlan.name}".`,
    );

    if (failure) {
      handleFailure(pricePlan, failure);
      setPending(null);
      // Close the dialog: it covers the stale-write banner, which is the only place
      // the Reload affordance lives. The typed price stays in the field.
      setPricePlanId(null);
      return;
    }

    const next = parsePlan(isRecord(data) ? data.plan : null);
    if (next) {
      replacePlan(next);
      // Only the price is authoritative here — any unsaved card-content edits stay put.
      setDrafts((current) => {
        const existing = current[next.id];
        const fresh = draftFromPlan(next);
        return {
          ...current,
          [next.id]: existing ? { ...existing, price: fresh.price } : fresh,
        };
      });
    }

    const amount = formatMoney(parsed.cents, pricePlan.currency);
    setStatus(`${pricePlan.name} is now ${amount} per ${pricePlan.interval} for new signups.`);
    toast.success(
      `New price saved for new signups only — "${pricePlan.name}" is now ${amount}/${pricePlan.interval}.`,
      {
        description:
          'Everyone already subscribed keeps being billed the old amount — move them in Stripe to change it.',
        duration: 9000,
      },
    );
    setPending(null);
    setPricePlanId(null);
  };

  const handleVisibility = async (plan: SignupPlan, nextVisible: boolean) => {
    if (busy) return;

    setPending(`${plan.id}:visibility`);
    setStatus(`${nextVisible ? 'Showing' : 'Hiding'} ${plan.name}…`);

    const { data, failure } = await callPlansFn(
      {
        action: 'set-visibility',
        id: plan.id,
        is_visible: nextVisible,
        updated_at: plan.updated_at,
      },
      `Could not change visibility for "${plan.name}".`,
    );

    if (failure) {
      handleFailure(plan, failure);
      setPending(null);
      return;
    }

    const next = parsePlan(isRecord(data) ? data.plan : null);
    if (next) replacePlan(next);

    setStatus(
      nextVisible
        ? `${plan.name} is now on the public pricing page.`
        : `${plan.name} is hidden from the public pricing page.`,
    );
    toast.success(
      nextVisible
        ? `"${plan.name}" is live on the pricing page.`
        : `"${plan.name}" is hidden — new customers can no longer pick it.`,
    );
    setPending(null);
  };

  /**
   * A toggle in both directions. `set-highlighted` takes an optional
   * `is_highlighted`; sending `false` clears the badge, and zero highlighted plans
   * is a legitimate state. Without this the control could only ever select — which
   * is exactly the "selects but will not deselect" the admins hit.
   */
  const handleToggleHighlight = async (plan: SignupPlan, nextHighlighted: boolean) => {
    if (busy) return;

    setPending(`${plan.id}:highlight`);
    setStatus(
      nextHighlighted
        ? `Marking ${plan.name} as most popular…`
        : `Removing the most popular badge from ${plan.name}…`,
    );

    const { data, failure } = await callPlansFn(
      {
        action: 'set-highlighted',
        id: plan.id,
        updated_at: plan.updated_at,
        is_highlighted: nextHighlighted,
      },
      nextHighlighted
        ? `Could not mark "${plan.name}" as most popular.`
        : `Could not clear the most popular badge on "${plan.name}".`,
    );

    if (failure) {
      handleFailure(plan, failure);
      setPending(null);
      return;
    }

    // This action rewrites more than one row — the badge moves off whichever plan
    // held it — so the server returns the whole list, not a single plan.
    const next = parsePlanList(isRecord(data) ? data.plans : null);
    if (next.length > 0) setPlans(next);

    setStatus(
      nextHighlighted
        ? `${plan.name} is now the most popular plan.`
        : `No plan is marked most popular.`,
    );
    toast.success(
      nextHighlighted
        ? `"${plan.name}" is now the Most popular plan — the badge moved to it.`
        : `Badge removed — no plan is marked Most popular now.`,
    );
    setPending(null);
  };

  /* ------------------------------- render -------------------------------- */

  const priceDraft = pricePlan ? drafts[pricePlan.id] : undefined;
  const priceParsed = priceDraft ? parsePriceToCents(priceDraft.price) : null;

  const activeDraft = activePlan ? drafts[activePlan.id] : undefined;
  const activePrice = activeDraft ? parsePriceToCents(activeDraft.price) : null;

  return (
    /*
      `relative` is load-bearing, not decoration.
      Tailwind's `.sr-only` is `position: absolute`. With no positioned ancestor its
      containing block is the INITIAL containing block, so it escapes <main>'s
      overflow clip and stretches the document's own scroll height to the full
      length of the page — which is what put a second, useless scrollbar on the
      window next to <main>'s real one. Making the page root a containing block
      keeps every absolutely positioned descendant inside the one scrollport.
    */
    <div className="relative space-y-6">
      {/* ------------------------------- Header ------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 glow-purple-sm">
            <BadgeDollarSign className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Signup Plans</h1>
            {/*
              This used to read "Changes go live immediately", which is not true and
              cost real debugging time: the public page is ISR-cached, so an admin
              toggled a plan, reloaded drive-247.com, still saw the old grid, and
              concluded the toggle was broken when the database had in fact updated
              correctly. Say what actually happens instead.
            */}
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              The self-serve plans on the public pricing page. Saved changes reach
              drive-247.com in about 10 seconds — the first visit after that window is
              what triggers the refresh, so you may need to reload twice.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Async status for screen readers */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {/* Stale-write banner — deliberately manual, so nothing typed gets thrown away */}
      {staleWrite && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Another admin changed &ldquo;{staleWrite}&rdquo; while you were editing it
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your change was refused so it could not overwrite theirs. Reload to pull in
              their version &mdash; any unsaved edits on this page will be replaced.
            </p>
          </div>
          <Button size="sm" onClick={() => void load()} disabled={loading || busy}>
            <RotateCcw className="h-4 w-4" />
            Reload
          </Button>
        </div>
      )}

      {/* Load failure */}
      {loadError && !loading && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Could not load signup plans</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{loadError}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {/* Loading — mirrors the real two-column shape so nothing jumps when data lands */}
      {loading && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardHeader className="pb-4">
                  <Skeleton className="h-6 w-40" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-56" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="hidden xl:block">
            <CardHeader className="pb-4">
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[360px] w-full rounded-2xl" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty */}
      {!loading && !loadError && plans.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No signup plans found. They are seeded in the database &mdash; check
              <code className="mx-1 rounded bg-secondary px-1 py-0.5 text-xs">
                public.signup_plans
              </code>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {/*
        --------------------------- Plans -----------------------------------
        ONE grid, ONE row: the editors on the left, a single preview rail on the
        right. The rail is a direct grid item, so its containing block is a grid
        area that spans the entire row — the full height of the editor column —
        which is what lets `sticky` pin it for the whole page. The previous shape
        put a preview inside every card, where the grid area was one card tall and
        the rail could only ever stick within that card.

        Nothing here sets `overflow`, `max-height` or a viewport-relative height,
        so the layout's <main> stays the only scrollport on the screen.
      */}
      {!loading && plans.length > 0 && activePlan && activeDraft && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            <p id="highlight-help" className="text-xs text-muted-foreground">
              One plan at a time can carry the Most popular badge. Picking another moves
              it; clicking the plan that has it removes the badge altogether.
            </p>

            {plans.map((plan) => {
              const draft = drafts[plan.id];
              if (!draft) return null;

              return (
                <SignupPlanCard
                  key={plan.id}
                  plan={plan}
                  draft={draft}
                  active={plan.id === activePlan.id}
                  busy={busy}
                  pending={pending}
                  lastVisible={plan.is_visible && visibleCount <= 1}
                  onActivate={() => setActivePlanId(plan.id)}
                  onDraftChange={(patch) => updateDraft(plan.id, patch)}
                  onSaveContent={() => void handleSaveContent(plan)}
                  onDiscard={() =>
                    setDrafts((current) => ({
                      ...current,
                      [plan.id]: draftFromPlan(plan),
                    }))
                  }
                  onRequestPriceChange={() => setPricePlanId(plan.id)}
                  onToggleVisibility={(next) => void handleVisibility(plan, next)}
                  onToggleHighlight={(next) => void handleToggleHighlight(plan, next)}
                />
              );
            })}
          </div>

          <aside
            ref={railRef}
            aria-label="Live preview"
            className={cn('min-w-0', pinned && 'xl:sticky xl:top-6')}
          >
            <SignupPlanPreviewPanel
              planName={activePlan.name || activePlan.plan_key}
              draft={activeDraft}
              currency={activePlan.currency}
              interval={activePlan.interval}
              highlighted={activePlan.is_highlighted}
              visible={activePlan.is_visible}
              dirty={isDirty(activePlan, activeDraft)}
              priceCents={activePrice?.ok ? activePrice.cents : null}
            />
          </aside>
        </div>
      )}

      {/* ------------------------- Price confirmation ------------------------- */}
      <Dialog
        open={pricePlan !== null}
        onOpenChange={(open) => {
          if (!open && pending?.endsWith(':price') !== true) setPricePlanId(null);
        }}
      >
        <DialogContent
          className="max-w-lg"
          onOpenAutoFocus={(event) => {
            // Land focus on Cancel, not Confirm — this is the most consequential
            // action on the page and must not be confirmable by a stray Enter.
            event.preventDefault();
            cancelPriceRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pricePlan && priceParsed?.ok
                ? `Change ${pricePlan.name} to ${formatMoney(priceParsed.cents, pricePlan.currency)}/${pricePlan.interval}?`
                : 'Change price?'}
            </DialogTitle>
            <DialogDescription>
              {pricePlan && priceParsed?.ok && (
                <>
                  {formatMoney(pricePlan.amount_cents, pricePlan.currency)} &rarr;{' '}
                  <span className="font-medium text-foreground">
                    {formatMoney(priceParsed.cents, pricePlan.currency)}
                  </span>{' '}
                  per {pricePlan.interval}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-1.5">
                <p className="font-medium">
                  This mints a new Stripe Price and applies to new signups only.
                </p>
                <p className="text-muted-foreground">
                  It does <span className="font-medium text-foreground">not</span> change
                  what existing subscribers already pay. Anyone on this plan today keeps
                  being billed{' '}
                  {pricePlan
                    ? formatMoney(pricePlan.amount_cents, pricePlan.currency)
                    : 'the old amount'}{' '}
                  &mdash; move them in Stripe if you want them on the new amount.
                </p>
              </div>
            </div>
            <p className="text-muted-foreground">
              The public pricing page will show the new amount immediately. The old Stripe
              Price stays in place for everyone already attached to it.
            </p>
          </div>

          <DialogFooter>
            <Button
              ref={cancelPriceRef}
              variant="outline"
              disabled={busy}
              onClick={() => setPricePlanId(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !priceParsed?.ok}
              onClick={() => void handleConfirmPrice()}
            >
              {pending?.endsWith(':price') && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending?.endsWith(':price') ? 'Creating price…' : 'Create new price'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
