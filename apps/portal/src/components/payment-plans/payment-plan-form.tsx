"use client";

/**
 * THE payment-plan form — one sentence the operator completes (design §9).
 *
 *   Collect  [spread evenly · by days covered · a fixed amount]
 *   every    [Weekly · Every 2 weeks · Twice a week · Monthly · Every N days · Pick dates]
 *   on       [weekday(s) / day of month]
 *   starting [the rental start · a date]
 *   until    [the rental ends · after N payments · a date]
 *   by       [card auto-charge · emailed link · I'll record it]
 *   Remind   [2 days before · On the day · 2 days after]
 *
 * "until" has a fourth answer where the caller offers it (`ctx.renewal`):
 * **keeps renewing until stopped**, which reveals, in the same style,
 *
 *   renew    every [N] [days · weeks · months]
 *   cover    each renewal with [the rental's coverage · no insurance]   — only when the tenant sells Bonzah
 *   send     an extension agreement each period [yes · no]              — default no
 *
 * and folds the rhythm lines away: a renewal is collected when its period
 * starts, so "renew every" IS the rhythm, and each period is priced by the
 * server when it starts, so "Collect" stops being a choice.
 *
 * Not a menu of plan types. The lead rejected exactly that — "It shouldn't be
 * that I click payment plan and it gives me three options" — so what the
 * business calls "pay as you go" and "installments" are just two ways of
 * finishing this sentence, and neither is ever named on screen.
 *
 * Stateless: the parent owns `PlanFormState` (so the create flow can validate
 * it on submit with the same function the preview uses) and passes the
 * current error, which lands under the line it belongs to.
 */

import { X } from "lucide-react";
import type { CollectionMethod, Weekday } from "@/lib/payment-plans/types";
import { Calendar } from "@/components/ui-v2/calendar";
import {
  AMOUNT_CHOICES,
  MAX_COUNT,
  MAX_EVERY,
  METHOD_CHOICES,
  REMINDER_CHOICES,
  RHYTHM_CHOICES,
  anchorOf,
  selectRhythm,
  toggleReminder,
  toggleWeekday,
  updateForm,
  type FormField,
  type IntervalUnit,
  type PlanContext,
  type PlanFormState,
} from "@/lib/payment-plans-ui/plan-form-model";
import {
  WEEKDAY_SHORT,
  dateToIso,
  formatDay,
  formatMoney,
  isoToDate,
  isoWeekday,
  ordinal,
  reminderLabel,
} from "@/lib/payment-plans-ui/format";
import {
  BONZAH_START_RULE,
  MAX_RENEW_EVERY,
  RENEWAL_UNITS,
  describeCoverage,
  describeEvery,
  hasCoverage,
  renewalPriceWords,
  renewalUnitWarning,
  type RenewalQuote,
} from "@/lib/payment-plans-ui/renewal";
import { Chip, InlineDate, InlineNumber, SentenceLine, inlineInputCls, swallowEnter } from "./sentence-kit";
import { cn } from "@/lib/utils";

export interface PaymentPlanFormProps {
  state: PlanFormState;
  onChange: (next: PlanFormState) => void;
  ctx: PlanContext;
  currency: string;
  /** The current problem, if any — shown under the line it belongs to. */
  error?: { field: FormField | null; message: string } | null;
  /** The earliest date a plan may start (an edit starts from today). */
  minStart?: string | null;
  /** One renewal period's price, from the server (PlanDraft.summary.renewal). */
  renewalQuote?: RenewalQuote | null;
}

const LINE_OF: Record<FormField, string> = {
  amount: "collect",
  fixedAmount: "collect",
  rhythm: "every",
  every: "every",
  weekdays: "on",
  monthDay: "on",
  dates: "on",
  startDate: "starting",
  endBy: "until",
  count: "until",
  until: "until",
  method: "by",
  renewEvery: "renew",
};

const UNITS: IntervalUnit[] = ["days", "weeks", "months"];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function PaymentPlanForm({ state, onChange, ctx, currency, error, minStart, renewalQuote }: PaymentPlanFormProps) {
  const set = (patch: Partial<PlanFormState>) => onChange(updateForm(state, patch));
  const errOn = (line: string) => (error && error.field && LINE_OF[error.field] === line ? error.message : null);

  const anchor = anchorOf(state, ctx);
  const renewing = state.endBy === "renewing";
  const renewal = ctx.renewal;
  const weekdayMode =
    !renewing &&
    (state.rhythm === "weekly" ||
    state.rhythm === "every_2_weeks" ||
    state.rhythm === "twice_a_week" ||
    (state.rhythm === "every_n" && state.everyUnit === "weeks"));
  const monthMode = !renewing && (state.rhythm === "monthly" || (state.rhythm === "every_n" && state.everyUnit === "months"));
  const datesMode = !renewing && state.rhythm === "pick_dates";

  // Is the start itself a payment day? If not, ask what happens to the days
  // before the first one — the "rental starts on a Wednesday, payments are
  // Fridays" case the lead drew on the board.
  const startIsRhythmDay = (() => {
    if (!anchor || datesMode || renewing) return true;
    if (state.rhythm === "every_n" && state.everyUnit === "days") return true;
    if (weekdayMode) return state.weekdays.includes(isoWeekday(anchor));
    if (monthMode) {
      const d = Number(anchor.slice(8, 10));
      return state.monthDay === d; // the last-day case is rare enough to ask about
    }
    return true;
  })();
  const firstRhythmWord = weekdayMode
    ? state.weekdays.length
      ? `the first ${WEEKDAY_SHORT[state.weekdays[0] - 1]}`
      : "the first payment day"
    : monthMode
      ? `the ${state.monthDay === -1 ? "last day" : ordinal(state.monthDay)}`
      : "the first payment day";

  const methodHint = (m: CollectionMethod) => METHOD_CHOICES.find((c) => c.id === m)?.hint ?? "";

  // Leaving "keeps renewing": the start the operator had before still stands,
  // unless it is the rental start and that is in the past for a set-up/edit
  // (then from the earliest allowed day).
  const leaveRenewing = (patch: Partial<PlanFormState>) => {
    if (!renewing) return set(patch);
    const past = state.startFrom === "rental_start" && !!minStart && ctx.rentalStart < minStart;
    set({ ...patch, ...(past ? { startFrom: "date" as const, startDate: minStart as string } : {}) });
  };
  const rentalCover = renewal?.rentalCoverage ?? null;
  // D9: the price one renewal period is charged, as the server prices it, and
  // a warning when the period is not one of the rental's own (ONE rental-
  // period rate is charged per renewal, however long it lasts).
  const quoteReady = renewalQuote?.state === "ready" ? renewalQuote.breakdown : null;
  const priceWords = renewalPriceWords(renewalQuote, currency);
  const coverAdded = !!renewal?.bonzahSellable && state.renewInsurance === "rental" && hasCoverage(rentalCover);
  const unitWarning = renewing
    ? renewalUnitWarning(state.renewUnit, state.renewEvery, renewal?.defaultUnit, quoteReady ? formatMoney(quoteReady.totalCents, currency) : null)
    : null;
  return (
    <div className="space-y-4" data-payment-plan-form="">
      {/* ── Collect ─────────────────────────────────────────────────────── */}
      {renewing ? (
        <SentenceLine
          word="Collect"
          id="collect"
          hint={
            <span data-renewal-price-hint={renewalQuote?.state ?? "none"}>
              {priceWords
                ? `${priceWords} `
                : `One ${renewal?.defaultUnit ?? "rental period"}'s rate for each renewal, less the rental's discount, plus tax and fees. `}
              The same price the rental&rsquo;s own renewals are charged
              {coverAdded ? "; each period's Bonzah premium is added once its cover is bought." : "."}
            </span>
          }
        >
          <span
            className="inline-flex h-8 items-center rounded-full bg-muted/70 px-3 text-[13px] font-medium tabular-nums text-foreground/80"
            data-renewal-amount={quoteReady ? String(quoteReady.totalCents) : ""}
          >
            {quoteReady ? `${formatMoney(quoteReady.totalCents, currency)} each period` : "each period\u2019s price"}
          </span>
        </SentenceLine>
      ) : (
      <SentenceLine
        word="Collect"
        id="collect"
        error={errOn("collect")}
        hint={
          state.amount === "fixed"
            ? "The same amount on every date."
            : ctx.balanceCents > 0
              ? `${AMOUNT_CHOICES.find((a) => a.id === state.amount)?.hint} The balance is ${formatMoney(ctx.balanceCents, currency)}.`
              : undefined
        }
      >
        {AMOUNT_CHOICES.map((a) => (
          <Chip key={a.id} active={state.amount === a.id} onClick={() => set({ amount: a.id })}>
            {a.label}
          </Chip>
        ))}
        {state.amount === "fixed" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                inputMode="decimal"
                aria-label="Amount each time"
                aria-invalid={error?.field === "fixedAmount" || undefined}
                placeholder="0.00"
                value={state.fixedAmount}
                onChange={(e) => set({ fixedAmount: e.target.value })}
                onKeyDown={swallowEnter}
                className={cn(inlineInputCls, "w-28 pl-6")}
              />
            </span>
            each time
          </span>
        )}
      </SentenceLine>
      )}

      {/* ── every ───────────────────────────────────────────────────────── */}
      {!renewing && (
      <SentenceLine word="every" id="every" error={errOn("every")}>
        {RHYTHM_CHOICES.map((r) => (
          <Chip key={r.id} active={state.rhythm === r.id} onClick={() => onChange(selectRhythm(state, r.id, ctx))}>
            {r.label}
          </Chip>
        ))}
        {state.rhythm === "every_n" && (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            every
            <InlineNumber
              label="How many apart"
              value={state.every}
              min={1}
              max={MAX_EVERY[state.everyUnit]}
              invalid={error?.field === "every"}
              onChange={(n) => set({ every: n })}
            />
            {UNITS.map((u) => (
              <Chip
                key={u}
                active={state.everyUnit === u}
                onClick={() =>
                  set({
                    everyUnit: u,
                    weekdays: u === "weeks" && state.weekdays.length === 0 && anchor ? [isoWeekday(anchor)] : state.weekdays,
                  })
                }
              >
                {u}
              </Chip>
            ))}
          </span>
        )}
      </SentenceLine>
      )}

      {/* ── on ──────────────────────────────────────────────────────────── */}
      {weekdayMode && (
        <SentenceLine
          word="on"
          id="on"
          error={errOn("on")}
          hint={
            state.rhythm === "twice_a_week"
              ? "Pick two days — for example Monday and Thursday."
              : state.rhythm === "every_n"
                ? "Pick one or more days."
                : undefined
          }
        >
          {WEEKDAYS.map((d) => (
            <Chip
              key={d}
              active={state.weekdays.includes(d)}
              onClick={() => onChange(toggleWeekday(state, d))}
              aria-label={WEEKDAY_SHORT[d - 1]}
            >
              {WEEKDAY_SHORT[d - 1]}
            </Chip>
          ))}
        </SentenceLine>
      )}

      {monthMode && (
        <SentenceLine
          word="on"
          id="on"
          error={errOn("on")}
          hint={
            state.monthDay > 28 || state.monthDay === -1
              ? "Shorter months use their last day, and the next month goes back to this day."
              : undefined
          }
        >
          <span className="text-sm text-muted-foreground">the</span>
          <select
            aria-label="Day of the month"
            value={state.monthDay}
            onChange={(e) => set({ monthDay: Number(e.target.value) })}
            onKeyDown={swallowEnter}
            className={cn(inlineInputCls, "cursor-pointer pr-2")}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {ordinal(d)}
              </option>
            ))}
            <option value={-1}>last day</option>
          </select>
          <span className="text-sm text-muted-foreground">of the month</span>
        </SentenceLine>
      )}

      {datesMode && (
        <SentenceLine word="on" id="on" error={errOn("on")} hint="Tap days on the calendar to add or remove them.">
          <div className="w-full">
            <div className="inline-block rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
              <Calendar
                mode="multiple"
                weekStartsOn={1}
                selected={state.dates.map(isoToDate)}
                defaultMonth={isoToDate(state.dates[0] ?? anchor ?? ctx.rentalStart)}
                disabled={(d: Date) => {
                  const iso = dateToIso(d);
                  return (!!anchor && iso < anchor) || (!!ctx.rentalEnd && iso >= ctx.rentalEnd);
                }}
                onSelect={(days: Date[] | undefined) => set({ dates: (days ?? []).map(dateToIso).sort() })}
              />
            </div>
            {state.dates.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {state.dates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set({ dates: state.dates.filter((x) => x !== d) })}
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/20 dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    aria-label={`Remove ${formatDay(d)}`}
                  >
                    {formatDay(d)}
                    <X className="size-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </SentenceLine>
      )}

      {/* ── starting ────────────────────────────────────────────────────── */}
      <SentenceLine
        word="starting"
        id="starting"
        error={errOn("starting")}
        hint={renewing ? "Renewals always start where the rental ends now. The rental's own dates are priced and collected as they are." : undefined}
      >
        {renewing ? (
          <span className="inline-flex h-8 items-center rounded-full bg-muted/70 px-3 text-[13px] font-medium text-foreground/80" data-renewal-start="">
            when the rental ends{ctx.rentalEnd ? ` · ${formatDay(ctx.rentalEnd)}` : ""}
          </span>
        ) : (
          <>
            <Chip active={state.startFrom === "rental_start"} onClick={() => set({ startFrom: "rental_start" })} disabled={!!minStart && ctx.rentalStart < minStart} title={minStart && ctx.rentalStart < minStart ? "The rental started in the past. A changed plan starts from today or later." : undefined}>
              the rental start · {formatDay(ctx.rentalStart)}
            </Chip>
            <Chip active={state.startFrom === "date"} onClick={() => set({ startFrom: "date", startDate: state.startDate ?? minStart ?? ctx.rentalStart })}>
              a date
            </Chip>
            {state.startFrom === "date" && (
              <InlineDate
                label="Start date"
                value={state.startDate}
                min={minStart ?? undefined}
                max={ctx.rentalEnd ?? undefined}
                invalid={error?.field === "startDate"}
                onChange={(d) => set({ startDate: d })}
              />
            )}
          </>
        )}
      </SentenceLine>

      {!startIsRhythmDay && anchor && (
        <div className="sm:pl-[92px]">
          <p className="mb-1.5 text-xs leading-relaxed text-muted-foreground">
            {formatDay(anchor)} isn&rsquo;t a payment day. The days before {firstRhythmWord} are:
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={state.firstPaymentOnStart} onClick={() => set({ firstPaymentOnStart: true })}>
              a short first payment on {formatDay(anchor)}
            </Chip>
            <Chip active={!state.firstPaymentOnStart} onClick={() => set({ firstPaymentOnStart: false })}>
              added to {firstRhythmWord}
            </Chip>
          </div>
        </div>
      )}

      {/* ── until ───────────────────────────────────────────────────────── */}
      {!datesMode && (
        <SentenceLine word="until" id="until" error={errOn("until")}>
          <Chip
            active={state.endBy === "rental_end"}
            disabled={!ctx.rentalEnd}
            title={!ctx.rentalEnd ? "This rental has no return date." : undefined}
            onClick={() => leaveRenewing({ endBy: "rental_end" })}
          >
            the rental ends{ctx.rentalEnd ? ` · ${formatDay(ctx.rentalEnd)}` : ""}
          </Chip>
          <Chip active={state.endBy === "count"} onClick={() => leaveRenewing({ endBy: "count" })}>
            after a number of payments
          </Chip>
          <Chip active={state.endBy === "until"} onClick={() => leaveRenewing({ endBy: "until", until: state.until ?? ctx.rentalEnd })}>
            a date
          </Chip>
          {renewal && (
            <Chip
              active={renewing}
              disabled={!ctx.rentalEnd}
              title={!ctx.rentalEnd ? "Renewing starts from the return date, and this rental has none." : undefined}
              onClick={() => !renewing && set({ endBy: "renewing" })}
              data-renewing-choice=""
            >
              keeps renewing until stopped
            </Chip>
          )}
          {state.endBy === "count" && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              after
              <InlineNumber
                label="Number of payments"
                value={state.count}
                min={1}
                max={MAX_COUNT}
                invalid={error?.field === "count"}
                onChange={(n) => set({ count: n })}
              />
              payments
            </span>
          )}
          {state.endBy === "until" && (
            <InlineDate
              label="Last payment on or before"
              value={state.until}
              min={anchor}
              invalid={error?.field === "until"}
              onChange={(d) => set({ until: d })}
            />
          )}
        </SentenceLine>
      )}

      {/* ── keeps renewing: the three lines it reveals ───────────────────── */}
      {renewing && (
        <>
          <SentenceLine
            word="renew"
            id="renew"
            error={errOn("renew")}
            hint={
              <>
                {`The return date moves ${describeEvery(state.renewUnit, Math.max(1, state.renewEvery))} until you stop it. Each period is collected when it starts, and its days are added once it is paid.`}
                {unitWarning && (
                  <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400" role="note" data-renewal-unit-warning="">
                    {unitWarning}
                  </span>
                )}
              </>
            }
          >
            <span className="text-sm text-muted-foreground">every</span>
            <InlineNumber
              label="How long each renewal lasts"
              value={state.renewEvery}
              min={1}
              max={MAX_RENEW_EVERY[state.renewUnit]}
              invalid={error?.field === "renewEvery"}
              onChange={(n) => set({ renewEvery: n })}
            />
            {RENEWAL_UNITS.map((u) => (
              <Chip key={u} active={state.renewUnit === u} onClick={() => set({ renewUnit: u })}>
                {u}s
              </Chip>
            ))}
          </SentenceLine>

          {renewal?.bonzahSellable && (
            <SentenceLine
              word="cover"
              id="cover"
              hint={
                <>
                  {!hasCoverage(rentalCover) && "This rental has no Bonzah cover, so its renewals have none either. "}
                  {BONZAH_START_RULE}
                </>
              }
            >
              <span className="text-sm text-muted-foreground">each renewal with</span>
              <Chip
                active={state.renewInsurance === "rental"}
                disabled={!hasCoverage(rentalCover)}
                title={!hasCoverage(rentalCover) ? "This rental has no Bonzah cover." : undefined}
                onClick={() => set({ renewInsurance: "rental" })}
              >
                the rental&rsquo;s coverage{hasCoverage(rentalCover) ? ` · ${describeCoverage(rentalCover)}` : ""}
              </Chip>
              <Chip active={state.renewInsurance === "none"} onClick={() => set({ renewInsurance: "none" })}>
                no insurance
              </Chip>
            </SentenceLine>
          )}

          <SentenceLine
            word="send"
            id="agreement"
            hint={
              state.renewAgreement
                ? "Each new period is sent to the customer to sign, using your extension agreement template."
                : "No agreement is sent when a period renews."
            }
          >
            <span className="text-sm text-muted-foreground">an extension agreement each period</span>
            <Chip active={state.renewAgreement} onClick={() => set({ renewAgreement: true })}>
              yes
            </Chip>
            <Chip active={!state.renewAgreement} onClick={() => set({ renewAgreement: false })}>
              no
            </Chip>
          </SentenceLine>
        </>
      )}

      {/* ── by ──────────────────────────────────────────────────────────── */}
      <SentenceLine word="by" id="by" error={errOn("by")} hint={methodHint(state.method)}>
        {METHOD_CHOICES.map((m) => (
          <Chip key={m.id} active={state.method === m.id} onClick={() => set({ method: m.id })}>
            {m.label}
          </Chip>
        ))}
      </SentenceLine>

      {/* ── reminders ───────────────────────────────────────────────────── */}
      <SentenceLine
        word="Remind"
        id="remind"
        hint={
          state.reminders.length === 0 ? "No reminders will be sent." : "Reminders go out around each payment date."
        }
      >
        {REMINDER_CHOICES.map((o) => (
          <Chip key={o} active={state.reminders.includes(o)} onClick={() => onChange(toggleReminder(state, o))}>
            {reminderLabel(o)}
          </Chip>
        ))}
      </SentenceLine>

      {error && !error.field && (
        <p role="alert" className="text-xs font-medium leading-relaxed text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}
