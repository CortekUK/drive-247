'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface SignupPlan {
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
export interface PlanDraft {
  name: string;
  tagline: string;
  fleet_band: string;
  max_vehicles: string;
  bullets: string[];
  price: string;
}

export interface PlanContentErrors {
  name?: string;
  tagline?: string;
  fleet_band?: string;
  max_vehicles?: string;
  bullets?: string;
  bulletAt: Record<number, string>;
}

/** Only the fields the admin can edit through the `update` action. */
export interface PlanPatch {
  name?: string;
  tagline?: string | null;
  fleet_band?: string | null;
  max_vehicles?: number;
  bullets?: string[];
}

/* -------------------------------------------------------------------------- */
/*  Validation limits (kept together so the copy and the checks can't drift)   */
/* -------------------------------------------------------------------------- */

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const TAGLINE_MAX = 160;
export const FLEET_BAND_MAX = 40;
export const MAX_VEHICLES_MIN = 1;
export const MAX_VEHICLES_MAX = 10000;
export const BULLETS_MIN = 1;
export const BULLETS_MAX = 8;
export const BULLET_MAX = 120;
const PRICE_MIN_CENTS = 50;
const PRICE_MAX_CENTS = 99_999_900;

/* -------------------------------------------------------------------------- */
/*  Formatting & validation helpers                                            */
/* -------------------------------------------------------------------------- */

export function formatMoney(cents: number, currency: string): string {
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

export type PriceParse = { ok: true; cents: number } | { ok: false; error: string };

export function parsePriceToCents(input: string): PriceParse {
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

export function draftFromPlan(plan: SignupPlan): PlanDraft {
  return {
    name: plan.name,
    tagline: plan.tagline ?? '',
    fleet_band: plan.fleet_band ?? '',
    max_vehicles: plan.max_vehicles === null ? '' : String(plan.max_vehicles),
    bullets: plan.bullets.length > 0 ? [...plan.bullets] : [''],
    price: (plan.amount_cents / 100).toFixed(plan.amount_cents % 100 === 0 ? 0 : 2),
  };
}

export function validateContent(draft: PlanDraft): PlanContentErrors {
  const errors: PlanContentErrors = { bulletAt: {} };

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

export function hasContentErrors(errors: PlanContentErrors): boolean {
  return Boolean(
    errors.name ||
      errors.tagline ||
      errors.fleet_band ||
      errors.max_vehicles ||
      errors.bullets ||
      Object.keys(errors.bulletAt).length > 0,
  );
}

export function buildPatch(plan: SignupPlan, draft: PlanDraft): PlanPatch {
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

export function isContentDirty(plan: SignupPlan, draft: PlanDraft): boolean {
  return Object.keys(buildPatch(plan, draft)).length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Live preview — a faithful mini of apps/web's public PlanCard               */
/* -------------------------------------------------------------------------- */

/**
 * Purely decorative: every value shown here is already announced by the form
 * inputs it mirrors, so the whole subtree is hidden from assistive tech to
 * avoid reading the same plan twice.
 *
 * The highlighted state is drawn with a BORDER, not a `ring`.
 *
 * That started as a workaround: the rail used to be a `max-h` +
 * `overflow-y-auto` box, and `overflow` clips anything painted outside the
 * border box, so a ring was sliced along the rail's edges. That box is gone —
 * it produced a second scrollbar inside an already-scrolling page — so a ring
 * would render correctly now. The border stays because it reads identically at
 * this size and needs no clipping assumption to hold.
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
        'relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 transition-colors',
        highlighted ? 'border-indigo-400/60' : 'border-border',
        !visible && 'opacity-50 saturate-50',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent',
          highlighted ? 'via-indigo-400/60' : 'via-indigo-400/20',
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
/*  Editor card for one plan                                                   */
/* -------------------------------------------------------------------------- */

interface SignupPlanCardProps {
  plan: SignupPlan;
  draft: PlanDraft;
  /** This plan is the one the preview rail is currently mirroring. */
  active: boolean;
  /** Any mutation anywhere on the page is in flight — every control locks. */
  busy: boolean;
  /** `${planId}:${action}` of the in-flight mutation, or null. */
  pending: string | null;
  /** Hiding this plan would leave the public pricing page with none. */
  lastVisible: boolean;
  onActivate: () => void;
  onDraftChange: (patch: Partial<PlanDraft>) => void;
  onSaveContent: () => void;
  onDiscard: () => void;
  onRequestPriceChange: () => void;
  onToggleVisibility: (next: boolean) => void;
  onHighlight: () => void;
  /**
   * The rendered public-card preview for THIS plan, placed in normal flow at
   * the end of the card. Passed in rather than rendered here so the page keeps
   * ownership of how a draft becomes a preview, and so this component stays a
   * pure form.
   */
  preview?: React.ReactNode;
}

export function SignupPlanCard({
  plan,
  draft,
  active,
  busy,
  pending,
  lastVisible,
  onActivate,
  onDraftChange,
  onSaveContent,
  onDiscard,
  onRequestPriceChange,
  onToggleVisibility,
  onHighlight,
  preview,
}: SignupPlanCardProps) {
  const errors = validateContent(draft);
  const invalid = hasContentErrors(errors);
  const contentDirty = isContentDirty(plan, draft);

  const price = parsePriceToCents(draft.price);
  const priceDirty = price.ok && price.cents !== plan.amount_cents;

  const savingContent = pending === `${plan.id}:content`;
  const savingVisibility = pending === `${plan.id}:visibility`;
  const savingHighlight = pending === `${plan.id}:highlight`;

  const visibleReasonId = `visible-reason-${plan.id}`;

  const setBullets = (bullets: string[]) => onDraftChange({ bullets });

  const moveBullet = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.bullets.length) return;
    const bullets = [...draft.bullets];
    const [moved] = bullets.splice(index, 1);
    bullets.splice(target, 0, moved);
    setBullets(bullets);
  };

  return (
    <Card
      // Focusing or clicking anywhere in this card makes it the plan the rail
      // mirrors, so the preview always tracks whatever is actually being edited.
      onFocus={onActivate}
      onPointerDown={onActivate}
      className={cn(
        'scroll-mt-6 transition-colors',
        active ? 'border-primary/40' : 'hover:border-primary/20',
      )}
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{plan.name || plan.plan_key}</CardTitle>
            <Badge variant="outline" className="font-mono lowercase">
              {plan.plan_key}
            </Badge>
            {!plan.is_visible && <Badge variant="secondary">Hidden</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* Most popular — radio semantics, single-select across all plans */}
            <button
              type="button"
              role="radio"
              aria-checked={plan.is_highlighted}
              disabled={busy}
              onClick={onHighlight}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:cursor-not-allowed disabled:opacity-50',
                plan.is_highlighted
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {savingHighlight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                    plan.is_highlighted ? 'border-primary' : 'border-input',
                  )}
                >
                  {plan.is_highlighted && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </span>
              )}
              Most popular
            </button>

            {/* Visibility */}
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
                className="text-xs text-muted-foreground"
              >
                Show on pricing page
              </Label>
              <Switch
                id={`visible-${plan.id}`}
                checked={plan.is_visible}
                disabled={busy || lastVisible}
                aria-describedby={lastVisible ? visibleReasonId : undefined}
                onCheckedChange={onToggleVisibility}
              />
            </div>
          </div>
        </div>

        {lastVisible && (
          <p id={visibleReasonId} className="text-xs text-warning">
            At least one plan must stay visible.
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ------------------------------- Price ------------------------------ */}
        <section className="space-y-2" aria-labelledby={`price-heading-${plan.id}`}>
          <h3 id={`price-heading-${plan.id}`} className="text-sm font-semibold">
            Price
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label
                htmlFor={`price-${plan.id}`}
                className="text-sm text-muted-foreground"
              >
                $
              </Label>
              <Input
                id={`price-${plan.id}`}
                inputMode="decimal"
                value={draft.price}
                disabled={busy}
                aria-invalid={!price.ok}
                aria-describedby={`price-help-${plan.id}`}
                onChange={(event) => onDraftChange({ price: event.target.value })}
                className="w-28 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">/{plan.interval}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !priceDirty}
              onClick={onRequestPriceChange}
            >
              Change price&hellip;
            </Button>
          </div>
          <p id={`price-help-${plan.id}`} className="text-xs">
            {!price.ok ? (
              <span className="text-destructive">{price.error}</span>
            ) : priceDirty ? (
              <span className="text-warning">
                Unsaved. Changing the price mints a new Stripe Price and does not change
                what existing subscribers pay.
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

        {/* ---------------------------- Card content -------------------------- */}
        <section className="space-y-4" aria-labelledby={`content-heading-${plan.id}`}>
          <h3 id={`content-heading-${plan.id}`} className="text-sm font-semibold">
            Card content
          </h3>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`name-${plan.id}`}>Name</Label>
              <Input
                id={`name-${plan.id}`}
                value={draft.name}
                maxLength={NAME_MAX}
                disabled={busy}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={`name-help-${plan.id}`}
                onChange={(event) => onDraftChange({ name: event.target.value })}
              />
              <p id={`name-help-${plan.id}`} className="text-xs">
                {errors.name ? (
                  <span className="text-destructive">{errors.name}</span>
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
                onChange={(event) => onDraftChange({ fleet_band: event.target.value })}
              />
              <p id={`fleet-help-${plan.id}`} className="text-xs">
                {errors.fleet_band ? (
                  <span className="text-destructive">{errors.fleet_band}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Shown above the price, in uppercase.
                  </span>
                )}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`max-${plan.id}`}>Max vehicles</Label>
              <Input
                id={`max-${plan.id}`}
                inputMode="numeric"
                value={draft.max_vehicles}
                disabled={busy}
                aria-invalid={Boolean(errors.max_vehicles)}
                aria-describedby={`max-help-${plan.id}`}
                className="tabular-nums"
                onChange={(event) => onDraftChange({ max_vehicles: event.target.value })}
              />
              <p id={`max-help-${plan.id}`} className="text-xs">
                {errors.max_vehicles ? (
                  <span className="text-destructive">{errors.max_vehicles}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Enforced at signup. {MAX_VEHICLES_MIN}&ndash;
                    {MAX_VEHICLES_MAX.toLocaleString('en-US')}.
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
              onChange={(event) => onDraftChange({ tagline: event.target.value })}
            />
            <p id={`tagline-help-${plan.id}`} className="text-xs">
              {errors.tagline ? (
                <span className="text-destructive">{errors.tagline}</span>
              ) : (
                <span className="text-muted-foreground">
                  {draft.tagline.trim().length}/{TAGLINE_MAX} characters.
                </span>
              )}
            </p>
          </div>
        </section>

        <Separator />

        {/* ------------------------------ Bullets ----------------------------- */}
        <section className="space-y-3" aria-labelledby={`bullets-heading-${plan.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h3 id={`bullets-heading-${plan.id}`} className="text-sm font-semibold">
                Bullets
              </h3>
              <span className="text-xs text-muted-foreground">
                {draft.bullets.length}/{BULLETS_MAX} &middot; up to {BULLET_MAX} characters
                each
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || draft.bullets.length >= BULLETS_MAX}
              onClick={() => setBullets([...draft.bullets, ''])}
            >
              <Plus className="h-4 w-4" />
              Add bullet
            </Button>
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
                      aria-describedby={bulletError ? `${bulletId}-error` : undefined}
                      onChange={(event) => {
                        const next = [...draft.bullets];
                        next[index] = event.target.value;
                        setBullets(next);
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
                        onClick={() => moveBullet(index, -1)}
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
                        onClick={() => moveBullet(index, 1)}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busy || draft.bullets.length <= BULLETS_MIN}
                        aria-label={`Remove bullet ${index + 1}`}
                        onClick={() =>
                          setBullets(draft.bullets.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {bulletError && (
                    <p id={`${bulletId}-error`} className="text-xs text-destructive">
                      {bulletError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {errors.bullets && <p className="text-xs text-destructive">{errors.bullets}</p>}
        </section>

        <Separator />

        {preview && (
          <>
            <Separator />
            <section aria-labelledby={`preview-heading-${plan.id}`}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3
                  id={`preview-heading-${plan.id}`}
                  className="text-base font-semibold"
                >
                  Live preview
                </h3>
                <span className="text-xs text-muted-foreground">
                  Reflects what you have typed, including unsaved edits.
                </span>
              </div>
              {/* Capped so the preview reads as a card, not a full-width banner
                  — the public grid renders it in a ~360px column. */}
              <div className="max-w-sm">{preview}</div>
            </section>
          </>
        )}

        {/* -------------------------------- Save ------------------------------ */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || !contentDirty || invalid}
            onClick={onSaveContent}
          >
            {savingContent && <Loader2 className="h-4 w-4 animate-spin" />}
            {savingContent ? 'Saving…' : 'Save card content'}
          </Button>
          <Button variant="ghost" disabled={busy || !contentDirty} onClick={onDiscard}>
            Discard changes
          </Button>
          {contentDirty && !savingContent && (
            <span className="text-xs text-warning">Unsaved changes</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
