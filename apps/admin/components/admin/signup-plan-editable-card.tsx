'use client';

/**
 * One signup plan as the pricing card itself, edited in place (Oct 17 2026,
 * Ghulam: "editable cards straight away"). The card is drawn the way the public
 * pricing page draws it (signup-plan-preview.tsx), and every piece of text on it
 * is the field: click the name, the fleet band, the price, the tagline or a
 * bullet and type. Nothing the old form offered is gone:
 *
 *   on the card     name, fleet band, price (+ Change price… with the Stripe
 *                   confirmation), tagline, bullets (add, reorder, remove),
 *                   then Save card content / Discard changes while there are edits
 *   settings dialog the gear (or the chips): plan key, Most popular, Show on
 *                   pricing page, max vehicles, free trial (TrialSection)
 *
 * Rules, limits and the save shape are signup-plan-card.tsx's, imported, so the
 * two can never disagree.
 */

import { ArrowDown, ArrowRight, ArrowUp, Check, Eye, EyeOff, Gift, Loader2, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  BULLETS_MAX,
  BULLET_MAX,
  FLEET_BAND_MAX,
  NAME_MAX,
  TAGLINE_MAX,
  TrialSection,
  formatMoney,
  hasContentErrors,
  isContentDirty,
  parsePriceToCents,
  validateContent,
  type PlanDraft,
  type SignupPlan,
} from './signup-plan-card';

/** Text that is also its own field: no box until hovered or focused. */
export const INLINE =
  'w-full min-w-0 rounded-lg bg-transparent px-1.5 -mx-1.5 outline-none transition-[background-color,box-shadow] duration-200 ease-out ' +
  'placeholder:text-muted-foreground/60 hover:bg-muted/60 focus:bg-muted/70 focus:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none';

export interface SignupPlanEditableCardProps {
  plan: SignupPlan;
  draft: PlanDraft;
  busy: boolean;
  pending: string | null;
  lastVisible: boolean;
  onDraftChange: (patch: Partial<PlanDraft>) => void;
  onSaveContent: () => void;
  onDiscard: () => void;
  onRequestPriceChange: () => void;
  onToggleVisibility: (next: boolean) => void;
  onToggleHighlight: (next: boolean) => void;
  onSaveTrial: (days: number) => void;
}

export function SignupPlanEditableCard({
  plan,
  draft,
  busy,
  pending,
  lastVisible,
  onDraftChange,
  onSaveContent,
  onDiscard,
  onRequestPriceChange,
  onToggleVisibility,
  onToggleHighlight,
  onSaveTrial,
}: SignupPlanEditableCardProps) {
  const errors = validateContent(draft);
  const invalid = hasContentErrors(errors);
  const contentDirty = isContentDirty(plan, draft);
  const price = parsePriceToCents(draft.price);
  const priceDirty = price.ok && price.cents !== plan.amount_cents;

  const savingContent = pending === `${plan.id}:content`;
  const setBullets = (bullets: string[]): void => onDraftChange({ bullets });
  const moveBullet = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= draft.bullets.length) return;
    const bullets = [...draft.bullets];
    const [moved] = bullets.splice(index, 1);
    bullets.splice(target, 0, moved);
    setBullets(bullets);
  };

  const [settingsOpen, setSettingsOpen] = useState(false);

  const symbol = formatMoney(0, plan.currency).replace(/[\d.,\s]/g, '') || '$';

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label={`${plan.name || plan.plan_key} plan`} data-plan={plan.plan_key}>
      {/* ---- The card, edited in place ---------------------------------- */}
      <div
        className={cn(
          'relative flex flex-col rounded-3xl border bg-card p-5 transition-colors',
          plan.is_highlighted ? 'border-primary/50 shadow-[0_10px_40px_-18px_hsl(var(--primary)/0.55)]' : 'border-border',
          !plan.is_visible && 'opacity-60',
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent to-transparent',
            plan.is_highlighted ? 'via-primary/60' : 'via-primary/20',
          )}
        />
        {/* Top-left tags: Most popular first, then Off. */}
        {(plan.is_highlighted || !plan.is_visible) && (
          <div className="absolute -top-3 left-5 flex items-center gap-1.5">
            {plan.is_highlighted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                <Sparkles className="size-3" aria-hidden="true" /> Most popular
              </span>
            )}
            {!plan.is_visible && (
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Off
              </span>
            )}
          </div>
        )}

        {/* On/off for the pricing page, then the plan's other settings. */}
        <div className="absolute right-3 top-3 flex items-center gap-1">
          {pending === `${plan.id}:visibility` ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <Switch
              checked={plan.is_visible}
              disabled={busy || lastVisible}
              onCheckedChange={onToggleVisibility}
              aria-label={plan.is_visible ? `Turn ${plan.name || plan.plan_key} off` : `Turn ${plan.name || plan.plan_key} on`}
              title={lastVisible ? 'At least one plan must stay on' : plan.is_visible ? 'On the pricing page' : 'Off the pricing page'}
            />
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={`${plan.name || plan.plan_key} settings`}
            title="Plan settings"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-primary motion-reduce:transition-none"
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Name */}
        <input
          value={draft.name}
          maxLength={NAME_MAX}
          disabled={busy}
          placeholder="Plan name"
          aria-label="Plan name"
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => onDraftChange({ name: e.target.value })}
          className={cn(INLINE, 'h-8 pr-[5.5rem] text-lg font-semibold tracking-tight text-foreground')}
        />
        <FieldIssue>{errors.name}</FieldIssue>

        {/* Fleet band */}
        <input
          value={draft.fleet_band}
          maxLength={FLEET_BAND_MAX}
          disabled={busy}
          placeholder="Fleet band"
          aria-label="Fleet band, shown above the price in uppercase"
          aria-invalid={Boolean(errors.fleet_band)}
          onChange={(e) => onDraftChange({ fleet_band: e.target.value })}
          className={cn(INLINE, 'mt-1 h-6 text-[11px] font-medium uppercase tracking-[0.14em] text-primary')}
        />
        <FieldIssue>{errors.fleet_band}</FieldIssue>

        {/* What the settings dialog holds, at a glance; a click opens it. */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="mt-2 flex flex-wrap items-center gap-1.5 self-start text-[11px] text-muted-foreground"
        >
          <Chip>Up to {draft.max_vehicles || '—'} vehicles</Chip>
          <Chip>{plan.trial_days > 0 ? `${plan.trial_days}-day trial` : 'No trial'}</Chip>
        </button>

        {/* Price */}
        <div className="mt-3 flex items-baseline">
          <span className="text-3xl font-bold tracking-tighter text-foreground">{symbol}</span>
          <input
            inputMode="decimal"
            value={draft.price}
            disabled={busy}
            aria-label={`Price per ${plan.interval}`}
            aria-invalid={!price.ok}
            onChange={(e) => onDraftChange({ price: e.target.value })}
            style={{ width: `calc(${Math.max(1, draft.price.length)}ch + 12px)` }}
            className={cn(INLINE, 'mx-0 h-10 max-w-[10ch] px-1.5 text-3xl font-bold tabular-nums tracking-tighter text-foreground')}
          />
          <span className="text-sm text-muted-foreground">/{plan.interval}</span>
          {priceDirty && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7 rounded-full px-3 text-xs"
              disabled={busy}
              onClick={onRequestPriceChange}
            >
              Change price…
            </Button>
          )}
        </div>
        <p className="mt-0.5 text-[11px]">
          {!price.ok ? (
            <span className="text-destructive">{price.error}</span>
          ) : priceDirty ? (
            <span className="text-warning">Unsaved. A new Stripe Price for new signups only.</span>
          ) : (
            <span className="text-muted-foreground">
              Currently {formatMoney(plan.amount_cents, plan.currency)}
              {plan.price_version !== null && ` · price v${plan.price_version}`}
              {plan.stripe_price_id && (
                <>
                  {' · '}
                  <span className="break-all font-mono">{plan.stripe_price_id}</span>
                </>
              )}
            </span>
          )}
        </p>

        {plan.trial_days > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            <Gift className="size-3" aria-hidden="true" /> {plan.trial_days}-day free trial · card required, cancel anytime
          </p>
        )}

        {/* Tagline */}
        <textarea
          value={draft.tagline}
          maxLength={TAGLINE_MAX}
          disabled={busy}
          rows={2}
          placeholder="Tagline appears here."
          aria-label="Tagline"
          aria-invalid={Boolean(errors.tagline)}
          onChange={(e) => onDraftChange({ tagline: e.target.value })}
          className={cn(INLINE, 'mt-2 resize-none py-1 text-[13px] leading-snug text-muted-foreground')}
        />
        <FieldIssue>{errors.tagline}</FieldIssue>

        {/* The card's own button, as the public page draws it. */}
        <div
          aria-hidden="true"
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-primary text-[13px] font-medium text-primary-foreground"
        >
          {plan.trial_days > 0 ? 'Start free trial' : 'Subscribe'} <ArrowRight className="size-3.5" />
        </div>

        {/* Bullets */}
        <ul className="mt-4 space-y-1 border-t border-border pt-3" aria-label="Bullets">
          {draft.bullets.map((bullet, index) => {
            const issue = errors.bulletAt[index];
            return (
              <li key={index} className="group/bullet">
                <div className="relative flex items-start gap-1.5">
                  <Check className="mt-[7px] size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <input
                    value={bullet}
                    maxLength={BULLET_MAX}
                    disabled={busy}
                    placeholder="A line about the plan"
                    aria-label={`Bullet ${index + 1}`}
                    aria-invalid={Boolean(issue)}
                    onChange={(e) => setBullets(draft.bullets.map((b, i) => (i === index ? e.target.value : b)))}
                    className={cn(INLINE, 'h-7 text-[13px] text-foreground')}
                  />
                  {/* Over the end of the line, only while hovered or focused, so the
                      text keeps the card's full width. */}
                  <span className="pointer-events-none absolute right-0 top-0 flex items-center rounded-full bg-card pl-1 opacity-0 shadow-sm ring-1 ring-border transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/bullet:pointer-events-auto group-hover/bullet:opacity-100 motion-reduce:transition-none">
                    <IconButton label={`Move bullet ${index + 1} up`} disabled={busy || index === 0} onClick={() => moveBullet(index, -1)}>
                      <ArrowUp className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`Move bullet ${index + 1} down`}
                      disabled={busy || index === draft.bullets.length - 1}
                      onClick={() => moveBullet(index, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </IconButton>
                    <IconButton
                      label={`Remove bullet ${index + 1}`}
                      disabled={busy || draft.bullets.length <= 1}
                      onClick={() => setBullets(draft.bullets.filter((_, i) => i !== index))}
                      danger
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </span>
                </div>
                {issue && <p className="pl-5 text-[11px] text-destructive">{issue}</p>}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={busy || draft.bullets.length >= BULLETS_MAX}
          onClick={() => setBullets([...draft.bullets, ''])}
          className="mt-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add bullet
          <span className="font-normal">
            {draft.bullets.length}/{BULLETS_MAX}
          </span>
        </button>
        <FieldIssue>{errors.bullets}</FieldIssue>
        {/* ---- Save, only while there is something to save ------------------ */}
        {(contentDirty || savingContent) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button className="rounded-full" size="sm" disabled={busy || invalid} onClick={onSaveContent}>
              {savingContent && <Loader2 className="size-4 animate-spin" />}
              {savingContent ? 'Saving…' : 'Save card content'}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" disabled={busy} onClick={onDiscard}>
              Discard changes
            </Button>
            {invalid && <span className="text-xs text-destructive">Fix the highlighted fields.</span>}
          </div>
        )}
      </div>

      <PlanSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        plan={plan}
        draft={draft}
        busy={busy}
        pending={pending}
        lastVisible={lastVisible}
        maxVehiclesError={errors.max_vehicles}
        onDraftChange={onDraftChange}
        onToggleVisibility={onToggleVisibility}
        onToggleHighlight={onToggleHighlight}
        onSaveTrial={onSaveTrial}
      />

    </section>
  );
}

function FieldIssue({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="text-[11px] text-destructive">{children}</p>;
}

function IconButton({
  label,
  disabled,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-30',
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted/70 px-2 py-0.5 transition-colors hover:bg-primary/10 hover:text-primary">{children}</span>
  );
}

/** The plan's settings, in a dialog off the card's gear. */
function PlanSettingsDialog({
  open,
  onOpenChange,
  plan,
  draft,
  busy,
  pending,
  lastVisible,
  maxVehiclesError,
  onDraftChange,
  onToggleVisibility,
  onToggleHighlight,
  onSaveTrial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: SignupPlan;
  draft: PlanDraft;
  busy: boolean;
  pending: string | null;
  lastVisible: boolean;
  maxVehiclesError?: string;
  onDraftChange: (patch: Partial<PlanDraft>) => void;
  onToggleVisibility: (next: boolean) => void;
  onToggleHighlight: (next: boolean) => void;
  onSaveTrial: (days: number) => void;
}) {
  const savingVisibility = pending === `${plan.id}:visibility`;
  const savingHighlight = pending === `${plan.id}:highlight`;
  const maxDirty = draft.max_vehicles.trim() !== String(plan.max_vehicles ?? '');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {plan.name || plan.plan_key} settings
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] font-normal lowercase text-muted-foreground">
              {plan.plan_key}
            </span>
          </DialogTitle>
          <DialogDescription>How this plan shows on the pricing page and what it allows.</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border/70">
          <SettingRow
            label="Most popular"
            description={
              plan.is_highlighted
                ? 'This plan carries the badge. Turn off to show no badge.'
                : 'One plan at a time. Turning it on moves the badge here.'
            }
          >
            <div className="flex items-center gap-2">
              {savingHighlight && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={plan.is_highlighted}
                disabled={busy}
                aria-label="Most popular"
                onCheckedChange={(v) => onToggleHighlight(v)}
              />
            </div>
          </SettingRow>
          <SettingRow
            label="Show on pricing page"
            description={lastVisible ? 'At least one plan must stay visible.' : 'Hidden plans can no longer be picked by new customers.'}
            warn={lastVisible}
          >
            <div className="flex items-center gap-2">
              {savingVisibility ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : plan.is_visible ? (
                <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <Switch
                checked={plan.is_visible}
                disabled={busy || lastVisible}
                aria-label="Show on pricing page"
                onCheckedChange={onToggleVisibility}
              />
            </div>
          </SettingRow>
          <SettingRow
            label="Max vehicles"
            description={
              maxVehiclesError ? maxVehiclesError : maxDirty ? 'Saved with Save card content on the card.' : 'Enforced at signup.'
            }
            warn={Boolean(maxVehiclesError) || maxDirty}
          >
            <input
              inputMode="numeric"
              value={draft.max_vehicles}
              disabled={busy}
              aria-label="Max vehicles"
              aria-invalid={Boolean(maxVehiclesError)}
              onChange={(e) => onDraftChange({ max_vehicles: e.target.value })}
              className="h-9 w-24 rounded-full bg-muted/70 px-3.5 text-right text-sm tabular-nums outline-none focus:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)] disabled:opacity-60"
            />
          </SettingRow>
          <div className="pt-4">
            <TrialSection plan={plan} busy={busy} saving={pending === `${plan.id}:trial`} onSave={onSaveTrial} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  label,
  description,
  warn = false,
  children,
}: {
  label: string;
  description: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className={cn('text-[12px]', warn ? 'text-warning' : 'text-muted-foreground')}>{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
