'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BadgeDollarSign,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface SignupPlan {
  id: string;
  plan_key: string;
  name: string;
  tagline: string | null;
  fleet_band: string | null;
  max_vehicles: number | null;
  amount_cents: number;
  currency: string;
  interval: string;
  bullets: string[];
  is_highlighted: boolean;
  is_visible: boolean;
  sort_order: number;
  stripe_price_id: string | null;
  stripe_lookup_key: string | null;
  price_version: number | null;
  updated_at: string;
}

/** Local, editable mirror of one plan. All fields are strings so the inputs stay controlled. */
interface Draft {
  name: string;
  tagline: string;
  fleet_band: string;
  max_vehicles: string;
  bullets: string[];
  price: string;
}

interface ContentErrors {
  name?: string;
  tagline?: string;
  fleet_band?: string;
  max_vehicles?: string;
  bullets?: string;
  bulletAt: Record<number, string>;
}

/** Only the fields the admin can edit through the `update` action. */
interface PlanPatch {
  name?: string;
  tagline?: string | null;
  fleet_band?: string | null;
  max_vehicles?: number;
  bullets?: string[];
}

interface FnFailure {
  message: string;
  code?: string;
}

/* -------------------------------------------------------------------------- */
/*  Validation limits (kept together so the copy and the checks can't drift)   */
/* -------------------------------------------------------------------------- */

const NAME_MIN = 2;
const NAME_MAX = 40;
const TAGLINE_MAX = 160;
const FLEET_BAND_MAX = 40;
const MAX_VEHICLES_MIN = 1;
const MAX_VEHICLES_MAX = 10000;
const BULLETS_MIN = 1;
const BULLETS_MAX = 8;
const BULLET_MAX = 120;
const PRICE_MIN_CENTS = 50;
const PRICE_MAX_CENTS = 99_999_900;

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

function parsePlanList(raw: unknown): SignupPlan[] {
  if (!Array.isArray(raw)) return [];
  const plans: SignupPlan[] = [];
  for (const item of raw) {
    const plan = parsePlan(item);
    if (plan) plans.push(plan);
  }
  return sortPlans(plans);
}

function sortPlans(plans: SignupPlan[]): SignupPlan[] {
  return [...plans].sort(
    (a, b) => a.sort_order - b.sort_order || a.plan_key.localeCompare(b.plan_key),
  );
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

interface FnResult {
  data: unknown;
  failure: FnFailure | null;
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
/*  Formatting & validation helpers                                            */
/* -------------------------------------------------------------------------- */

function formatMoney(cents: number, currency: string): string {
  const code = (currency || 'usd').toUpperCase();
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

type PriceParse = { ok: true; cents: number } | { ok: false; error: string };

function parsePriceToCents(input: string): PriceParse {
  const trimmed = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!trimmed) return { ok: false, error: 'Enter a price.' };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: 'Use dollars with up to 2 decimals, e.g. 199 or 199.50.' };
  }
  const cents = Math.round(Number(trimmed) * 100);
  if (cents < PRICE_MIN_CENTS) return { ok: false, error: 'Price must be at least $0.50.' };
  if (cents > PRICE_MAX_CENTS) return { ok: false, error: 'Price cannot be more than $999,999.' };
  return { ok: true, cents };
}

function draftFromPlan(plan: SignupPlan): Draft {
  return {
    name: plan.name,
    tagline: plan.tagline ?? '',
    fleet_band: plan.fleet_band ?? '',
    max_vehicles: plan.max_vehicles === null ? '' : String(plan.max_vehicles),
    bullets: plan.bullets.length > 0 ? [...plan.bullets] : [''],
    price: (plan.amount_cents / 100).toFixed(plan.amount_cents % 100 === 0 ? 0 : 2),
  };
}

function validateContent(draft: Draft): ContentErrors {
  const errors: ContentErrors = { bulletAt: {} };

  const name = draft.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    errors.name = `Name must be ${NAME_MIN}–${NAME_MAX} characters.`;
  }

  if (draft.tagline.trim().length > TAGLINE_MAX) {
    errors.tagline = `Tagline must be ${TAGLINE_MAX} characters or fewer.`;
  }

  if (draft.fleet_band.trim().length > FLEET_BAND_MAX) {
    errors.fleet_band = `Fleet band must be ${FLEET_BAND_MAX} characters or fewer.`;
  }

  const rawMax = draft.max_vehicles.trim();
  if (!rawMax) {
    errors.max_vehicles = 'Enter a maximum fleet size.';
  } else if (!/^\d+$/.test(rawMax)) {
    errors.max_vehicles = 'Use a whole number.';
  } else {
    const parsed = Number(rawMax);
    if (parsed < MAX_VEHICLES_MIN || parsed > MAX_VEHICLES_MAX) {
      errors.max_vehicles = `Must be between ${MAX_VEHICLES_MIN} and ${MAX_VEHICLES_MAX.toLocaleString('en-US')}.`;
    }
  }

  if (draft.bullets.length < BULLETS_MIN) {
    errors.bullets = `Add at least ${BULLETS_MIN} bullet.`;
  } else if (draft.bullets.length > BULLETS_MAX) {
    errors.bullets = `No more than ${BULLETS_MAX} bullets.`;
  }

  draft.bullets.forEach((bullet, index) => {
    const value = bullet.trim();
    if (value.length < 1) {
      errors.bulletAt[index] = 'Bullet cannot be empty — write something or remove the row.';
    } else if (value.length > BULLET_MAX) {
      errors.bulletAt[index] = `Bullet must be ${BULLET_MAX} characters or fewer.`;
    }
  });

  return errors;
}

function hasContentErrors(errors: ContentErrors): boolean {
  return Boolean(
    errors.name ||
      errors.tagline ||
      errors.fleet_band ||
      errors.max_vehicles ||
      errors.bullets ||
      Object.keys(errors.bulletAt).length > 0,
  );
}

function buildPatch(plan: SignupPlan, draft: Draft): PlanPatch {
  const patch: PlanPatch = {};

  const name = draft.name.trim();
  if (name !== plan.name) patch.name = name;

  const tagline = draft.tagline.trim();
  const currentTagline = plan.tagline ?? '';
  if (tagline !== currentTagline) patch.tagline = tagline || null;

  const fleetBand = draft.fleet_band.trim();
  const currentFleetBand = plan.fleet_band ?? '';
  if (fleetBand !== currentFleetBand) patch.fleet_band = fleetBand || null;

  const maxVehicles = Number(draft.max_vehicles.trim());
  if (Number.isFinite(maxVehicles) && maxVehicles !== plan.max_vehicles) {
    patch.max_vehicles = maxVehicles;
  }

  const bullets = draft.bullets.map((bullet) => bullet.trim());
  const sameBullets =
    bullets.length === plan.bullets.length &&
    bullets.every((bullet, index) => bullet === plan.bullets[index]);
  if (!sameBullets) patch.bullets = bullets;

  return patch;
}

function isContentDirty(plan: SignupPlan, draft: Draft): boolean {
  return Object.keys(buildPatch(plan, draft)).length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Live preview — a faithful mini of apps/web's public PlanCard               */
/* -------------------------------------------------------------------------- */

/**
 * Purely decorative: every value shown here is already announced by the form
 * inputs it mirrors, so the whole subtree is hidden from assistive tech to
 * avoid reading the same plan twice.
 */
function PlanPreview({
  draft,
  currency,
  interval,
  highlighted,
  visible,
  priceCents,
}: {
  draft: Draft;
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
        'relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 transition-all',
        highlighted
          ? 'border-indigo-400/40 ring-1 ring-indigo-400/20'
          : 'border-border',
        !visible && 'opacity-50 saturate-50',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent',
          highlighted ? 'via-indigo-400/50' : 'via-indigo-400/20',
        )}
      />

      {highlighted && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-semibold text-white">
          <Sparkles className="h-3 w-3" /> Most popular
        </span>
      )}

      <p className="pr-24 text-sm font-semibold tracking-tight text-foreground">
        {draft.name.trim() || 'Plan name'}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-indigo-400">
        {draft.fleet_band.trim() || 'Fleet band'}
      </p>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tighter text-foreground">
          {priceCents === null ? '—' : formatMoney(priceCents, currency)}
        </span>
        <span className="text-xs text-muted-foreground">/{interval}</span>
      </div>

      <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
        {draft.tagline.trim() || 'Tagline appears here.'}
      </p>

      <div className="mt-5 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-indigo-500 text-sm font-medium text-white">
        Subscribe <ArrowRight className="h-4 w-4" />
      </div>

      <ul className="mt-5 space-y-2 border-t border-border pt-5">
        {bullets.length === 0 ? (
          <li className="text-xs italic text-muted-foreground">No bullets yet.</li>
        ) : (
          bullets.map((bullet, index) => (
            <li
              key={`${index}-${bullet}`}
              className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
              {bullet}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function SignupPlansPage() {
  const [plans, setPlans] = useState<SignupPlan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleWrite, setStaleWrite] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /** `${planId}:${action}` while a mutation is in flight. Blocks every mutating control. */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;

  const [pricePlanId, setPricePlanId] = useState<string | null>(null);
  const cancelPriceRef = useRef<HTMLButtonElement>(null);

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

  /** Replace one row in place, leaving every other plan's unsaved draft untouched. */
  const replacePlan = useCallback((next: SignupPlan) => {
    setPlans((current) =>
      sortPlans(current.map((plan) => (plan.id === next.id ? next : plan))),
    );
  }, []);

  const updateDraft = useCallback((planId: string, patch: Partial<Draft>) => {
    setDrafts((current) => {
      const existing = current[planId];
      if (!existing) return current;
      return { ...current, [planId]: { ...existing, ...patch } };
    });
  }, []);

  /** STALE_WRITE must not silently reload — that would eat whatever the admin just typed. */
  const handleFailure = useCallback((plan: SignupPlan, failure: FnFailure) => {
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
  }, [load]);

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

  const handleHighlight = async (plan: SignupPlan) => {
    if (busy || plan.is_highlighted) return;

    setPending(`${plan.id}:highlight`);
    setStatus(`Marking ${plan.name} as most popular…`);

    const { data, failure } = await callPlansFn(
      { action: 'set-highlighted', id: plan.id, updated_at: plan.updated_at },
      `Could not mark "${plan.name}" as most popular.`,
    );

    if (failure) {
      handleFailure(plan, failure);
      setPending(null);
      return;
    }

    const next = parsePlanList(isRecord(data) ? data.plans : null);
    if (next.length > 0) setPlans(next);

    setStatus(`${plan.name} is now the most popular plan.`);
    toast.success(`"${plan.name}" is now the Most popular plan — the badge moved to it.`);
    setPending(null);
  };

  /* ------------------------------ bullets -------------------------------- */

  const setBullets = (planId: string, bullets: string[]) => {
    updateDraft(planId, { bullets });
  };

  const moveBullet = (planId: string, index: number, delta: number) => {
    const draft = drafts[planId];
    if (!draft) return;
    const target = index + delta;
    if (target < 0 || target >= draft.bullets.length) return;
    const bullets = [...draft.bullets];
    const [moved] = bullets.splice(index, 1);
    bullets.splice(target, 0, moved);
    setBullets(planId, bullets);
  };

  /* ------------------------------- render -------------------------------- */

  const priceDraft = pricePlan ? drafts[pricePlan.id] : undefined;
  const priceParsed = priceDraft ? parsePriceToCents(priceDraft.price) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 glow-purple-sm">
            <BadgeDollarSign className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Signup Plans</h1>
            {/*
              This used to read "Changes go live immediately", which is not true and
              cost real debugging time: the public page is ISR-cached, so an admin
              toggled a plan, reloaded drive-247.com, still saw the old grid, and
              concluded the toggle was broken when the database had in fact updated
              correctly. Say what actually happens instead.
            */}
            <p className="text-sm text-muted-foreground">
              The three self-serve plans on the public pricing page. Saved changes
              reach drive-247.com within about 10 seconds — you may need to reload
              twice, as the first visit after that window is what triggers the
              refresh.
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
          <div className="flex-1 min-w-0">
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
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Could not load signup plans</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{loadError}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                  <Skeleton className="h-[340px] w-full rounded-2xl" />
                </div>
              </CardContent>
            </Card>
          ))}
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

      {/* Plans */}
      {!loading && plans.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Most popular plan"
          aria-describedby="highlight-help"
          className="space-y-4"
        >
          <p id="highlight-help" className="text-sm text-muted-foreground">
            Only one plan can be marked most popular &mdash; picking another clears the
            current one.
          </p>

          {plans.map((plan) => {
            const draft = drafts[plan.id];
            if (!draft) return null;

            const errors = validateContent(draft);
            const invalid = hasContentErrors(errors);
            const contentDirty = isContentDirty(plan, draft);

            const price = parsePriceToCents(draft.price);
            const priceCents = price.ok ? price.cents : null;
            const priceDirty = price.ok && price.cents !== plan.amount_cents;

            const lastVisible = plan.is_visible && visibleCount <= 1;
            const savingContent = pending === `${plan.id}:content`;
            const savingVisibility = pending === `${plan.id}:visibility`;
            const savingHighlight = pending === `${plan.id}:highlight`;

            const visibleReasonId = `visible-reason-${plan.id}`;

            return (
              <Card key={plan.id}>
                <CardHeader className="gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-tight">{plan.name}</h2>
                      <Badge variant="outline" className="font-mono lowercase">
                        {plan.plan_key}
                      </Badge>
                      <Badge variant={plan.is_visible ? 'success' : 'secondary'}>
                        {plan.is_visible ? 'Visible' : 'Hidden'}
                      </Badge>
                      {plan.is_highlighted && (
                        <Badge variant="default" className="gap-1">
                          <Sparkles className="h-3 w-3" /> Most popular
                        </Badge>
                      )}
                    </div>

                    {/* Visibility */}
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <div className="flex items-center gap-2.5">
                        {savingVisibility ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : plan.is_visible ? (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        )}
                        <Label
                          htmlFor={`visible-${plan.id}`}
                          className="text-sm text-muted-foreground"
                        >
                          Show on pricing page
                        </Label>
                        <Switch
                          id={`visible-${plan.id}`}
                          checked={plan.is_visible}
                          disabled={busy || lastVisible}
                          aria-describedby={lastVisible ? visibleReasonId : undefined}
                          onCheckedChange={(next) => void handleVisibility(plan, next)}
                        />
                      </div>
                      {lastVisible && (
                        <p id={visibleReasonId} className="text-xs text-warning">
                          At least one plan must stay visible
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Most popular — radio semantics, single-select across all plans */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={plan.is_highlighted}
                    disabled={busy}
                    onClick={() => void handleHighlight(plan)}
                    className={cn(
                      'inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      plan.is_highlighted
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {savingHighlight ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border',
                          plan.is_highlighted ? 'border-primary' : 'border-input',
                        )}
                      >
                        {plan.is_highlighted && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </span>
                    )}
                    Most popular
                  </button>
                </CardHeader>

                <CardContent>
                  <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                    {/* ------------------------------ Editor ------------------------------ */}
                    <div className="space-y-6">
                      {/* Price */}
                      <section className="space-y-2" aria-labelledby={`price-heading-${plan.id}`}>
                        <h3
                          id={`price-heading-${plan.id}`}
                          className="text-sm font-semibold"
                        >
                          Price
                        </h3>
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`price-${plan.id}`} className="text-xs text-muted-foreground">
                              Amount in US dollars
                            </Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">$</span>
                              <Input
                                id={`price-${plan.id}`}
                                inputMode="decimal"
                                value={draft.price}
                                disabled={busy}
                                aria-invalid={!price.ok}
                                aria-describedby={`price-help-${plan.id}`}
                                onChange={(event) =>
                                  updateDraft(plan.id, { price: event.target.value })
                                }
                                className="w-32 tabular-nums"
                              />
                              <span className="text-sm text-muted-foreground">
                                /{plan.interval}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            disabled={busy || !priceDirty}
                            onClick={() => setPricePlanId(plan.id)}
                          >
                            Change price&hellip;
                          </Button>
                        </div>
                        <p id={`price-help-${plan.id}`} className="text-xs">
                          {!price.ok ? (
                            <span className="text-red-400">{price.error}</span>
                          ) : priceDirty ? (
                            <span className="text-warning">
                              Unsaved. Changing the price mints a new Stripe Price and does
                              not change what existing subscribers pay.
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Currently {formatMoney(plan.amount_cents, plan.currency)} per{' '}
                              {plan.interval}
                              {plan.price_version !== null && ` · price v${plan.price_version}`}
                              {plan.stripe_price_id && (
                                <>
                                  {' · '}
                                  <span className="font-mono">{plan.stripe_price_id}</span>
                                </>
                              )}
                            </span>
                          )}
                        </p>
                      </section>

                      <Separator />

                      {/* Card content */}
                      <section className="space-y-4" aria-labelledby={`content-heading-${plan.id}`}>
                        <h3 id={`content-heading-${plan.id}`} className="text-sm font-semibold">
                          Card content
                        </h3>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`name-${plan.id}`}>Name</Label>
                            <Input
                              id={`name-${plan.id}`}
                              value={draft.name}
                              maxLength={NAME_MAX}
                              disabled={busy}
                              aria-invalid={Boolean(errors.name)}
                              aria-describedby={`name-help-${plan.id}`}
                              onChange={(event) =>
                                updateDraft(plan.id, { name: event.target.value })
                              }
                            />
                            <p id={`name-help-${plan.id}`} className="text-xs">
                              {errors.name ? (
                                <span className="text-red-400">{errors.name}</span>
                              ) : (
                                <span className="text-muted-foreground">
                                  {NAME_MIN}&ndash;{NAME_MAX} characters.
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`fleet-${plan.id}`}>Fleet band</Label>
                            <Input
                              id={`fleet-${plan.id}`}
                              value={draft.fleet_band}
                              maxLength={FLEET_BAND_MAX}
                              placeholder="1–4 vehicles"
                              disabled={busy}
                              aria-invalid={Boolean(errors.fleet_band)}
                              aria-describedby={`fleet-help-${plan.id}`}
                              onChange={(event) =>
                                updateDraft(plan.id, { fleet_band: event.target.value })
                              }
                            />
                            <p id={`fleet-help-${plan.id}`} className="text-xs">
                              {errors.fleet_band ? (
                                <span className="text-red-400">{errors.fleet_band}</span>
                              ) : (
                                <span className="text-muted-foreground">
                                  Shown above the price, in uppercase.
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`tagline-${plan.id}`}>Tagline</Label>
                          <Textarea
                            id={`tagline-${plan.id}`}
                            value={draft.tagline}
                            maxLength={TAGLINE_MAX}
                            rows={2}
                            disabled={busy}
                            aria-invalid={Boolean(errors.tagline)}
                            aria-describedby={`tagline-help-${plan.id}`}
                            className="min-h-[64px]"
                            onChange={(event) =>
                              updateDraft(plan.id, { tagline: event.target.value })
                            }
                          />
                          <p id={`tagline-help-${plan.id}`} className="text-xs">
                            {errors.tagline ? (
                              <span className="text-red-400">{errors.tagline}</span>
                            ) : (
                              <span className="text-muted-foreground">
                                {draft.tagline.trim().length}/{TAGLINE_MAX} characters.
                              </span>
                            )}
                          </p>
                        </div>

                        <div className="space-y-1.5 sm:max-w-[220px]">
                          <Label htmlFor={`max-${plan.id}`}>Max vehicles</Label>
                          <Input
                            id={`max-${plan.id}`}
                            inputMode="numeric"
                            value={draft.max_vehicles}
                            disabled={busy}
                            aria-invalid={Boolean(errors.max_vehicles)}
                            aria-describedby={`max-help-${plan.id}`}
                            className="tabular-nums"
                            onChange={(event) =>
                              updateDraft(plan.id, { max_vehicles: event.target.value })
                            }
                          />
                          <p id={`max-help-${plan.id}`} className="text-xs">
                            {errors.max_vehicles ? (
                              <span className="text-red-400">{errors.max_vehicles}</span>
                            ) : (
                              <span className="text-muted-foreground">
                                Enforced at signup. {MAX_VEHICLES_MIN}&ndash;
                                {MAX_VEHICLES_MAX.toLocaleString('en-US')}.
                              </span>
                            )}
                          </p>
                        </div>
                      </section>

                      <Separator />

                      {/* Bullets */}
                      <section className="space-y-3" aria-labelledby={`bullets-heading-${plan.id}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 id={`bullets-heading-${plan.id}`} className="text-sm font-semibold">
                            Bullets
                          </h3>
                          <span className="text-xs text-muted-foreground">
                            {draft.bullets.length}/{BULLETS_MAX}
                          </span>
                        </div>

                        <ul className="space-y-2">
                          {draft.bullets.map((bullet, index) => {
                            const bulletError = errors.bulletAt[index];
                            const bulletId = `bullet-${plan.id}-${index}`;
                            return (
                              <li key={bulletId} className="space-y-1">
                                <div className="flex items-start gap-2">
                                  <Label htmlFor={bulletId} className="sr-only">
                                    Bullet {index + 1} of {plan.name}
                                  </Label>
                                  <Input
                                    id={bulletId}
                                    value={bullet}
                                    maxLength={BULLET_MAX}
                                    disabled={busy}
                                    aria-invalid={Boolean(bulletError)}
                                    aria-describedby={
                                      bulletError ? `${bulletId}-error` : undefined
                                    }
                                    onChange={(event) => {
                                      const next = [...draft.bullets];
                                      next[index] = event.target.value;
                                      setBullets(plan.id, next);
                                    }}
                                  />
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-8"
                                      disabled={busy || index === 0}
                                      aria-label={`Move bullet ${index + 1} up`}
                                      onClick={() => moveBullet(plan.id, index, -1)}
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-8"
                                      disabled={busy || index === draft.bullets.length - 1}
                                      aria-label={`Move bullet ${index + 1} down`}
                                      onClick={() => moveBullet(plan.id, index, 1)}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-10 w-8 text-red-400 hover:text-red-300"
                                      disabled={busy || draft.bullets.length <= BULLETS_MIN}
                                      aria-label={`Remove bullet ${index + 1}`}
                                      onClick={() =>
                                        setBullets(
                                          plan.id,
                                          draft.bullets.filter((_, i) => i !== index),
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                                {bulletError && (
                                  <p id={`${bulletId}-error`} className="text-xs text-red-400">
                                    {bulletError}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        {errors.bullets && (
                          <p className="text-xs text-red-400">{errors.bullets}</p>
                        )}

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || draft.bullets.length >= BULLETS_MAX}
                          onClick={() => setBullets(plan.id, [...draft.bullets, ''])}
                        >
                          <Plus className="h-4 w-4" />
                          Add bullet
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {BULLETS_MIN}&ndash;{BULLETS_MAX} bullets, up to {BULLET_MAX}{' '}
                          characters each.
                        </p>
                      </section>

                      {/* Save */}
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <Button
                          disabled={busy || !contentDirty || invalid}
                          onClick={() => void handleSaveContent(plan)}
                        >
                          {savingContent && <Loader2 className="h-4 w-4 animate-spin" />}
                          {savingContent ? 'Saving…' : 'Save card content'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !contentDirty}
                          onClick={() =>
                            setDrafts((current) => ({
                              ...current,
                              [plan.id]: draftFromPlan(plan),
                            }))
                          }
                        >
                          Discard changes
                        </Button>
                        {contentDirty && !savingContent && (
                          <span className="text-xs text-warning">Unsaved changes</span>
                        )}
                      </div>
                    </div>

                    {/*
                      ----------------------------- Preview -----------------------------
                      `top-0` rather than `top-4`: the scroll container is the layout's
                      `<main class="overflow-y-auto">`, so the offset is measured from
                      the top of that scrollport, which already sits below the header —
                      an extra inset only wasted vertical space.

                      TWO elements, not one, and that is the whole fix.

                      Putting `sticky` directly on the grid item did not work. A grid
                      item's sticky travel is bounded by its own box, so it needs a
                      box TALLER than itself to move inside — but `self-start` shrinks
                      the item to its content, leaving zero travel, while the default
                      `stretch` makes the item fill the row so there is again nothing
                      to move within. Either way it scrolls away with the page.

                      So: the OUTER div stretches to the full row height (no
                      `self-start`, so it inherits `align-self: stretch` and matches
                      the much taller editor column beside it), and the INNER div is
                      the sticky one, travelling inside that tall box. This is the
                      canonical sidebar-sticky pattern and does not depend on how the
                      grid sizes the row.

                      `top-0` because the scrollport is the layout's
                      `<main class="overflow-y-auto">`, whose top edge already sits
                      below the header — any inset would just waste space.

                      `max-h` + `overflow-y-auto` on the inner box keep a plan with
                      eight bullets from growing taller than the viewport, which would
                      reintroduce the same "no room to travel" problem.
                    */}
                    <div className="lg:h-full">
                      <div className="lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pb-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold">Live preview</h3>
                          {!plan.is_visible && (
                            <span className="text-xs text-muted-foreground">
                              Hidden from customers
                            </span>
                          )}
                        </div>
                        <PlanPreview
                          draft={draft}
                          currency={plan.currency}
                          interval={plan.interval}
                          highlighted={plan.is_highlighted}
                          visible={plan.is_visible}
                          priceCents={priceCents}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          Reflects what you have typed, including unsaved edits.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
