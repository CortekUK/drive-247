"use client";

/**
 * Payment plan — a SECTION of the Payments tab. DESIGN SANDBOX; nothing is real.
 *
 * No Supabase, no tenant, no auth, no network, no react-query. Every number is a
 * module constant or a prop, and every change is local state.
 *
 * ── Where this lives now ──────────────────────────────────────────────────
 *
 * This was the right rail's middle tab. It is not any more. Money is the
 * platform's most important surface, and splitting it between a 328px rail and
 * the middle column meant neither half held the whole context: the plan knew
 * the schedule but not how a payment was proved, and the middle column knew the
 * total but not when the next charge went out.
 *
 * So it is a section of `_payments-tab.tsx` now, and the numbers it used to own
 * are OWNED BY THE PARENT:
 *
 *   total    the rental's current demand. It moves — a fine or a damage charge
 *            raised after the booking is a Payments-tab action — so it cannot
 *            be a constant in here.
 *   entries  settled money, in the order it arrived, each carrying the SHAPE it
 *            was taken under so a plan switch can be reported honestly.
 *   declined / linkOut   attempt state, which the ledger also renders.
 *
 * Everything the plan decides — shape, split count, period, up-front or after —
 * is still local. Nothing above needs to know it until money moves, and money
 * only moves through `onCollect` / `onSendLink`.
 *
 * ── The idea ──────────────────────────────────────────────────────────────
 *
 * Drive247 ships four separate billing concepts an operator has to learn:
 * manual extensions, auto-extensions, pay-as-you-go, and installments. They are
 * taught, configured and displayed in four different places, and nobody can say
 * out loud what distinguishes them. This section collapses that to TWO plans and
 * TWO settings:
 *
 *     Fixed term   ends on a date, costs a known total
 *                    · one payment
 *                    · split into N payments
 *
 *     Rolling      no end date, bills per period
 *                    · charge up front
 *                    · charge after each period
 *
 * Which covers all four:
 *
 *     Fixed + one payment          the simple default
 *     Fixed + split                an installment plan
 *     Rolling + up front           auto-extension
 *     Rolling + after each period  pay-as-you-go
 *
 * Two of the originals do not survive, deliberately:
 *
 *  · A MANUAL EXTENSION is not a plan. It is an event — the end date moves and
 *    money follows. It belongs to the dates, so it is not built here.
 *  · INSTALLMENTS is not a sibling of PAYG. It is a fixed rental with the money
 *    spread, which is why it is a setting on Fixed rather than a third card.
 *
 * The whole design rests on the fact that auto-extension and PAYG differ on
 * exactly ONE thing: whether a period is charged before or after it is used.
 * That is a question an operator answers instantly. "Auto-extension vs PAYG" is
 * a question only we can answer, so the old names appear once, in 10px muted
 * text, as a translation aid — never as a label.
 *
 * ── What it must show ─────────────────────────────────────────────────────
 *
 * Picking the plan is half the section. The other half is what the plan MEANS in
 * money and dates, which is where the real product is weakest today:
 *
 *  · Fixed + split recomputes a live schedule as N changes, and hands the odd
 *    cents to the first payment rather than printing $298.6667 three times.
 *  · Rolling shows the period amount, the next charge date, what has been
 *    charged so far, and the next few periods with the date each one is billed
 *    — which is where up-front and after-each-period visibly diverge.
 *  · Money that already moved is never silently recomputed. It is carried
 *    across the switch and said out loud.
 *
 * Grounded in what exists: `scheduled_installments` / `installment_plans`
 * (number_of_installments, installment_amount, due_date, per-row status and
 * last_failure_reason), `payg_accruals` (daily under the hood, sold weekly or
 * monthly), and `rentals.auto_extend_*` (period unit, next_charge_at, charge
 * mode, charge count, and a `chargeNow` that bills the next period early).
 * PAYG is Weekly or Monthly in the real product — never daily — so the period
 * select offers exactly those two.
 *
 * ── House rules kept ──────────────────────────────────────────────────────
 *
 * There is no security deposit in here. It is independent of the plan — the
 * same hold whichever you pick, and it is never revenue — so it has its own
 * card on the tab and one muted line at the bottom points at it.
 *
 * No Save, no Submit, no Create: the plan applies the moment it is chosen. The
 * two buttons that remain take money, which is an action on the rental, not a
 * commit gesture.
 *
 * Amber appears nowhere. In this sandbox amber means "out of date", so a
 * declined payment is `destructive` and a payment due today is `primary`.
 */

import { useState } from "react";
import { AlertCircle, Check, CreditCard, Link2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { money, inputCls } from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   Dates and money — exported, because the Payments tab tells the same story
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything is derived from fixed ISO dates at LOCAL midnight and only ever
 * shifted by whole days, so the server and the browser format the same calendar
 * date in any timezone. `new Date()` is called from click handlers only — never
 * during render, which is how you earn a hydration mismatch for no benefit.
 */
export const D = (isoDate: string) => new Date(`${isoDate}T00:00:00`);

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const short = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "Fri Sep 11" — US ordering like the rest of the app, without the comma. */
export const withDay = (d: Date) => `${d.toLocaleDateString("en-US", { weekday: "short" })} ${short(d)}`;

/** "Sep 11 – 18", or "Sep 28 – Oct 5" across a month boundary. */
const span = (a: Date, b: Date) =>
  a.getMonth() === b.getMonth() ? `${short(a)} – ${b.getDate()}` : `${short(a)} – ${short(b)}`;

/**
 * `money` from the kit drops cents, which is right for a rate and wrong for an
 * instalment — three payments of "$299" that sum to $897 is exactly the lie
 * this design exists to stop telling. Whole amounts still render clean.
 */
export const exact = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(r) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The fake rental
   ══════════════════════════════════════════════════════════════════════════ */

export const TODAY = D("2026-09-04");
/** Booked a fortnight before pickup — instalments run weekly from here. */
export const BOOKED = D("2026-08-28");
export const START = D("2026-09-11");
export const DAYS = 7;

/**
 * The ALL-IN daily figure — what a day of this rental costs once the extras,
 * the delivery, the surcharge, the cover and the promo are in. $896 ÷ 7.
 *
 * It is NOT the headline rate on the vehicle ($98). The Payments tab's
 * breakdown is this number's anatomy, and the two must never be confused: a
 * rolling period is priced off the all-in day, because that is what a week of
 * this rental actually costs.
 *
 * Deliberately a constant while `total` is a prop: a one-off charge added after
 * the booking (a fine, kerbed alloy) moves what is OWED without changing what a
 * week COSTS, so it must not silently reprice every future rolling period.
 */
export const DAILY = 128;
export const DEPOSIT = 200;

const isPast = (d: Date) => d.getTime() < TODAY.getTime();
const isToday = (d: Date) => d.getTime() === TODAY.getTime();

const SPLIT_MIN = 2;
const SPLIT_MAX = 6;
const CAP_MIN = 1;
const CAP_MAX = 26;

/** Weekly or Monthly only — daily rolling billing does not exist in the product. */
const UNITS = [
  { id: "week", label: "week", days: 7, one: "week", many: "weeks" },
  { id: "month", label: "month", days: 30, one: "month", many: "months" },
] as const;

type UnitId = (typeof UNITS)[number]["id"];

/** Which SHAPE money was taken under, so a switch can be reported honestly. */
export type Shape = "one" | "split" | "rolling";

/**
 * The slice of a payment this section needs. The tab's own `Payment` carries a
 * great deal more — provenance, proof, a trail, its allocations — and satisfies
 * this structurally, so nothing has to be mapped across.
 */
export type PlanEntry = { amount: number; shape: Shape; planLabel: string };

/* ══════════════════════════════════════════════════════════════════════════
   Row states
   ══════════════════════════════════════════════════════════════════════════ */

type RowState = "paid" | "part" | "failed" | "due" | "overdue" | "upcoming";

/**
 * Same three-step ramp the Activity tab uses for actors. `failed` and `overdue`
 * are destructive; a payment due today is primary, not a warning — amber in
 * this sandbox means the terms moved, and nothing here has moved.
 */
const ROW_TILE: Record<RowState, string> = {
  paid: "bg-success-light text-success",
  part: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  due: "bg-primary/10 text-primary",
  overdue: "bg-destructive/10 text-destructive",
  upcoming: "bg-muted/60 text-muted-foreground/60",
};

const ROW_TEXT: Record<RowState, string> = {
  paid: "text-muted-foreground",
  part: "text-primary",
  failed: "text-destructive",
  due: "text-primary",
  overdue: "text-destructive",
  upcoming: "text-muted-foreground/60",
};

/* ══════════════════════════════════════════════════════════════════════════
   Bits
   ══════════════════════════════════════════════════════════════════════════ */

/** A group label at the rail's weight. This section sits inside a titled card,
 *  so it does not get <h2>s of its own. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
      {children}
    </p>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-full ring-1 transition-colors",
        on ? "ring-primary" : "ring-foreground/25"
      )}
    >
      {on && <span className="size-1.5 rounded-full bg-primary" />}
    </span>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-md ring-1 transition-colors",
        on ? "bg-primary ring-primary" : "ring-foreground/25"
      )}
    >
      {on && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
    </span>
  );
}

/**
 * A stepper rather than a number input: a keyboard is a worse way to say "one
 * more payment" than a tap, and it cannot be left holding a half-typed value
 * that the schedule below has to pretend to understand.
 */
function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-3xl bg-input/50 ring-1 ring-foreground/5">
      <button
        type="button"
        aria-label="One fewer"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus className="size-3" />
      </button>
      <span className="w-5 text-center text-[12px] font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="One more"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="size-3" />
      </button>
    </span>
  );
}

/** One line of a schedule — the Activity row's rhythm, a step up in the middle
 *  column because it is no longer competing for 328px. */
function ScheduleRow({
  index,
  title,
  sub,
  amount,
  state,
}: {
  index: number;
  title: string;
  sub: string;
  amount: number;
  state: RowState;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold tabular-nums",
          ROW_TILE[state]
        )}
      >
        {state === "paid" ? (
          <Check className="size-4" strokeWidth={2.5} />
        ) : state === "failed" ? (
          <AlertCircle className="size-4" />
        ) : (
          index
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug">{title}</p>
        <p className={cn("mt-0.5 truncate text-[11px] leading-none", ROW_TEXT[state])}>{sub}</p>
      </div>

      <span
        className={cn(
          "shrink-0 text-[13px] font-semibold tabular-nums",
          state === "upcoming" ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {exact(amount)}
      </span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StatBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 flex gap-4 rounded-3xl bg-muted/40 px-5 py-3 ring-1 ring-foreground/5">{children}</div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 px-0.5 text-[11px] leading-relaxed text-muted-foreground/70">{children}</p>;
}

/* ══════════════════════════════════════════════════════════════════════════
   Section
   ══════════════════════════════════════════════════════════════════════════ */

export function PaymentPlanSection({
  total,
  entries,
  declined,
  linkOut,
  onReshape,
  onCollect,
  onSendLink,
}: {
  /** What the rental currently asks for. Owned by the tab, because a charge
   *  raised after the booking moves it. */
  total: number;
  /** Settled money that counts toward this rental, oldest first. */
  entries: PlanEntry[];
  /** "Sep 3" when the last attempt on the next payment bounced, else null. */
  declined: string | null;
  /** Time label of the link currently out, else null. */
  linkOut: string | null;
  /** The plan's SHAPE changed — the parent voids the declined marker and any
   *  link that is out, both of which were for an amount this plan no longer
   *  asks for. */
  onReshape: () => void;
  /** Charge `amount` to the card on file under this shape. */
  onCollect: (amount: number, shape: Shape, planLabel: string) => void;
  /** Raise a payment link for `amount` under this shape. */
  onSendLink: (amount: number, shape: Shape, planLabel: string) => void;
}) {
  const [plan, setPlan] = useState<"fixed" | "rolling">("fixed");
  /** Remembered separately, so coming back to Fixed restores the sub-choice. */
  const [fixedMode, setFixedMode] = useState<"one" | "split">("split");
  const [splitCount, setSplitCount] = useState(3);

  const [unit, setUnit] = useState<UnitId>("week");
  const [upfront, setUpfront] = useState(true);
  const [capOn, setCapOn] = useState(false);
  const [capCount, setCapCount] = useState(4);

  const shape: Shape = plan === "rolling" ? "rolling" : fixedMode;
  const unitDef = UNITS.find((u) => u.id === unit) ?? UNITS[0];
  const periodAmount = DAILY * unitDef.days;

  const planLabel =
    plan === "rolling"
      ? `Rolling, charged ${upfront ? "up front" : "after each period"}`
      : fixedMode === "one"
        ? "One payment"
        : `Split into ${splitCount} payments`;

  /**
   * Changing the SHAPE invalidates the last attempt and any link that is out.
   * Guarded on an actual change, so re-clicking the plan you are already on does
   * not quietly erase the fact that a card bounced.
   */
  const reshape = (changed: boolean, fn: () => void) => {
    if (!changed) return;
    fn();
    onReshape();
  };

  const collected = entries.reduce((s, e) => s + e.amount, 0);
  const foreign = entries.filter((e) => e.shape !== shape);
  const carry = foreign.reduce((s, e) => s + e.amount, 0);
  const carryFrom = Array.from(new Set(foreign.map((e) => e.planLabel))).join(" and ");

  /* ── Fixed: the schedule, recomputed live ───────────────────────────────
   *
   * All in cents, so three payments of $896 sum to $896 and not to $895.98.
   * The remainder goes on the FIRST payment: the odd cents arrive with the
   * money you already have rather than trailing at the end.
   */
  const count = fixedMode === "one" ? 1 : splitCount;
  const baseC = Math.floor(Math.round(total * 100) / count);
  const extraC = Math.round(total * 100) - baseC * count;

  let poolC = Math.round(collected * 100);
  const fixedRows = Array.from({ length: count }, (_, i) => {
    const amountC = baseC + (i === 0 ? extraC : 0);
    const appliedC = Math.min(poolC, amountC);
    poolC -= appliedC;
    const remainingC = amountC - appliedC;
    /** One payment falls on the booking date; a split runs weekly from it. */
    const due = addDays(BOOKED, i * 7);

    const state: RowState =
      remainingC === 0
        ? "paid"
        : appliedC > 0
          ? "part"
          : isPast(due)
            ? "overdue"
            : isToday(due)
              ? "due"
              : "upcoming";

    return { i, due, amount: amountC / 100, remaining: remainingC / 100, state };
  });

  const firstOpen = fixedRows.find((r) => r.remaining > 0);
  const outstanding = Math.max(0, total - collected);

  /* ── Rolling: what has been billed, and what comes next ─────────────────── */

  const rolled = entries.filter((e) => e.shape === "rolling");
  const rolledTotal = rolled.reduce((s, e) => s + e.amount, 0);
  /**
   * Money taken under the old plan is a credit against the first rolling
   * period, not a refund and not a second charge. Once one period has been
   * billed it has been consumed.
   */
  const credit = rolled.length === 0 ? Math.min(carry, periodAmount) : 0;

  const limit = capOn ? capCount : Infinity;
  const periodAt = (i: number) => {
    const from = addDays(START, i * unitDef.days);
    const to = addDays(from, unitDef.days);
    return { from, to, chargeOn: upfront ? from : to };
  };

  const rollingRows: { i: number; from: Date; to: Date; chargeOn: Date; state: RowState }[] = [];
  for (let i = Math.max(0, rolled.length - 1); i < Math.min(limit, rolled.length + 3); i++) {
    const p = periodAt(i);
    const state: RowState =
      i < rolled.length
        ? "paid"
        : i === rolled.length && (isPast(p.chargeOn) || isToday(p.chargeOn))
          ? "due"
          : "upcoming";
    rollingRows.push({ i, ...p, state });
  }

  const next = periodAt(rolled.length);
  const capReached = capOn && rolled.length >= capCount;
  const capEnd = addDays(START, capCount * unitDef.days);
  /** Billing a not-yet-started period early is a real affordance; billing a
   *  not-yet-finished one is a contradiction, so after-mode simply waits. */
  const canBillNow = !capReached && (upfront || isPast(next.chargeOn) || isToday(next.chargeOn));

  return (
    <>
      {/* ═══ the plan ══════════════════════════════════════════════════════
          Side by side. In the rail these were stacked because 328px left no
          choice; in the middle column the two options are a comparison, and a
          comparison you have to scroll is not one. */}

      <div className="grid grid-cols-2 items-start gap-3">
        {/* ── Fixed term ─────────────────────────────────────────────────── */}
        <div
          className={cn(
            "rounded-3xl px-4 py-3 ring-1 transition-colors",
            plan === "fixed" ? "bg-primary-light ring-primary/40" : "bg-muted/40 ring-foreground/5"
          )}
        >
          <button
            type="button"
            onClick={() => reshape(plan !== "fixed", () => setPlan("fixed"))}
            className="flex w-full cursor-pointer items-start gap-2.5 text-left"
          >
            <span className="pt-0.5">
              <Radio on={plan === "fixed"} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-heading text-sm font-medium leading-tight">Fixed term</span>
              <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">
                Ends {withDay(addDays(START, DAYS))} · {DAYS} days
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[13px] font-semibold leading-tight tabular-nums">{exact(total)}</span>
              <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">total</span>
            </span>
          </button>

          {plan === "fixed" && (
            <div className="mt-3 space-y-2 border-t border-foreground/10 pt-3">
              <button
                type="button"
                onClick={() => reshape(fixedMode !== "one", () => setFixedMode("one"))}
                className="flex cursor-pointer items-center gap-2 text-left"
              >
                <Radio on={fixedMode === "one"} />
                <span className="text-[12px]">One payment</span>
              </button>

              {/* The stepper cannot sit inside the label's <button> — a button
                  inside a button is invalid — so the row is a flex line and the
                  trailing unit word is plain text. */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => reshape(fixedMode !== "split", () => setFixedMode("split"))}
                  className="flex cursor-pointer items-center gap-2 text-left"
                >
                  <Radio on={fixedMode === "split"} />
                  <span className="text-[12px]">Split into</span>
                </button>
                <Stepper
                  value={splitCount}
                  min={SPLIT_MIN}
                  max={SPLIT_MAX}
                  onChange={(n) => {
                    setSplitCount(n);
                    reshape(fixedMode !== "split", () => setFixedMode("split"));
                  }}
                />
                <span className="text-[12px] text-muted-foreground">payments</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Rolling ────────────────────────────────────────────────────── */}
        <div
          className={cn(
            "rounded-3xl px-4 py-3 ring-1 transition-colors",
            plan === "rolling" ? "bg-primary-light ring-primary/40" : "bg-muted/40 ring-foreground/5"
          )}
        >
          <button
            type="button"
            onClick={() => reshape(plan !== "rolling", () => setPlan("rolling"))}
            className="flex w-full cursor-pointer items-start gap-2.5 text-left"
          >
            <span className="pt-0.5">
              <Radio on={plan === "rolling"} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-heading text-sm font-medium leading-tight">Rolling</span>
              <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">
                {capOn ? `Stops after ${capCount} ${capCount === 1 ? unitDef.one : unitDef.many}` : "No end date"} ·
                bills every {unitDef.one}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[13px] font-semibold leading-tight tabular-nums">
                {money(periodAmount)}
              </span>
              <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                a {unitDef.one}
              </span>
            </span>
          </button>

          {plan === "rolling" && (
            <div className="mt-3 border-t border-foreground/10 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px]">every</span>
                <select
                  value={unit}
                  onChange={(e) => reshape(true, () => setUnit(e.target.value as UnitId))}
                  className={cn(inputCls, "block h-7 w-auto cursor-pointer px-2.5 text-[12px]")}
                >
                  {UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">· {money(periodAmount)} each</span>
              </div>

              <p className="mb-1.5 mt-3 text-[11px] text-muted-foreground">charge</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => reshape(!upfront, () => setUpfront(true))}
                  className="flex w-full cursor-pointer items-start gap-2 text-left"
                >
                  <span className="pt-0.5">
                    <Radio on={upfront} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] leading-tight">Up front</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                      Billed before each {unitDef.one} starts. Nothing is used before it is paid for.
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => reshape(upfront, () => setUpfront(false))}
                  className="flex w-full cursor-pointer items-start gap-2 text-left"
                >
                  <span className="pt-0.5">
                    <Radio on={!upfront} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] leading-tight">After each period</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                      Billed when the {unitDef.one} ends, on what was actually used.
                    </span>
                  </span>
                </button>
              </div>

              {/* The one place the old vocabulary is allowed, because operators
                  who learned it need the bridge once. Never as a label. */}
              <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground/60">
                Up front is what you used to call auto-extension. After each period is pay-as-you-go.
              </p>

              {/* Optional cap. Off by default — a rolling plan that quietly
                  stops is not rolling. On, because a long weekly hire and a
                  runaway subscription look identical until one of them isn't. */}
              <div className="mt-3 flex items-center gap-1.5 border-t border-foreground/10 pt-3">
                <button
                  type="button"
                  onClick={() => setCapOn(!capOn)}
                  className="flex cursor-pointer items-center gap-2 text-left"
                >
                  <CheckBox on={capOn} />
                  <span className="text-[12px]">
                    {capOn ? "Stop after" : `Stop after a set number of ${unitDef.many}`}
                  </span>
                </button>
                {capOn && (
                  <>
                    <Stepper value={capCount} min={CAP_MIN} max={CAP_MAX} onChange={setCapCount} />
                    <span className="text-[12px] text-muted-foreground">
                      {capCount === 1 ? unitDef.one : unitDef.many}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ money that moved under a different plan ════════════════════════ */}

      {carry > 0 && (
        <div className="mt-3 rounded-3xl bg-muted/40 px-5 py-3 ring-1 ring-foreground/5">
          <p className="text-[12px] leading-snug">
            <span className="font-medium tabular-nums">{exact(carry)} already collected</span> under {carryFrom}.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {plan !== "rolling"
              ? "Nothing was refunded and nothing is charged twice — it counts toward the schedule below."
              : credit > 0
                ? `Nothing was refunded and nothing is charged twice — it comes off the first ${unitDef.one}.`
                : `Nothing was refunded and nothing is charged twice — it came off the first ${unitDef.one}.`}
          </p>
        </div>
      )}

      {/* ═══ what that means in money and dates ═════════════════════════════ */}

      <SectionLabel>Schedule</SectionLabel>

      {plan === "fixed" ? (
        <>
          <div className="divide-y divide-foreground/5">
            {fixedRows.map((r) => {
              const state: RowState = declined && firstOpen && r.i === firstOpen.i ? "failed" : r.state;
              const base =
                r.state === "paid"
                  ? "Paid"
                  : r.state === "part"
                    ? `Part paid · ${exact(r.remaining)} left`
                    : r.state === "overdue"
                      ? "Overdue"
                      : r.state === "due"
                        ? "Due today"
                        : "Upcoming";
              return (
                <ScheduleRow
                  key={r.i}
                  index={r.i + 1}
                  title={withDay(r.due)}
                  sub={
                    state === "failed"
                      ? `Card declined ${declined} · ${exact(r.remaining)} outstanding`
                      : base
                  }
                  amount={r.amount}
                  state={state}
                />
              );
            })}
          </div>

          {count > 1 ? (
            <Note>
              {exact(total)} across {count} payments, one a week from {short(BOOKED)} — the day it was booked.
              {extraC > 0 && ` The first carries the odd ${extraC}¢ so the ${count} add up to exactly ${exact(total)}.`}
            </Note>
          ) : (
            <Note>
              The whole {exact(total)} on the day it was booked, {short(BOOKED)}. Nothing is scheduled after it.
            </Note>
          )}

          <StatBar>
            <Stat label="Rental total" value={exact(total)} hint={`${DAYS} days`} />
            <Stat
              label="Collected"
              value={exact(collected)}
              hint={collected > 0 ? "applied against charges" : "nothing yet"}
            />
            <Stat
              label="Still to come"
              value={exact(outstanding)}
              hint={outstanding > 0 && firstOpen ? `next ${short(firstOpen.due)}` : "nothing outstanding"}
            />
          </StatBar>

          {firstOpen ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={() => onCollect(firstOpen.remaining, shape, planLabel)}>
                <CreditCard className="size-4" />
                Charge the card · {exact(firstOpen.remaining)}
              </Button>
              <Button variant="outline" onClick={() => onSendLink(firstOpen.remaining, shape, planLabel)}>
                <Link2 className="size-4" />
                {linkOut ? `Link sent ${linkOut} · send again` : "Send a payment link instead"}
              </Button>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 px-0.5 text-[12px] font-medium text-success">
              <Check className="size-4" strokeWidth={2.5} />
              Paid in full — nothing left on this schedule.
            </p>
          )}
        </>
      ) : (
        <>
          <StatBar>
            <Stat label={`Per ${unitDef.one}`} value={money(periodAmount)} hint={`${money(DAILY)} a day, all in`} />
            <Stat
              label="Charged so far"
              value={rolled.length === 0 ? "Nothing yet" : exact(rolledTotal)}
              hint={
                rolled.length === 0
                  ? `no ${unitDef.one} billed on this plan`
                  : `${rolled.length} ${rolled.length === 1 ? unitDef.one : unitDef.many}`
              }
            />
            <Stat
              label="Next charge"
              value={capReached ? "—" : withDay(next.chargeOn)}
              hint={capReached ? `capped at ${capCount}` : `for ${span(next.from, next.to)}`}
            />
          </StatBar>

          <div className="mt-2 divide-y divide-foreground/5">
            {rollingRows.map((r) => (
              <ScheduleRow
                key={r.i}
                index={r.i + 1}
                title={span(r.from, r.to)}
                sub={
                  r.state === "paid"
                    ? `Charged ${short(r.chargeOn)}`
                    : `${r.i === rolled.length ? "Next · c" : "C"}harges ${short(r.chargeOn)}`
                }
                amount={periodAmount}
                state={r.state}
              />
            ))}
          </div>

          {capOn ? (
            <Note>
              Stops after {capCount} {capCount === 1 ? unitDef.one : unitDef.many} — the last one ends{" "}
              {withDay(capEnd)}. Take the cap off and it keeps going.
            </Note>
          ) : (
            <Note>
              Keeps going a {unitDef.one} at a time until you end the rental. There is no total to quote,
              because there is no end date.
            </Note>
          )}

          {capReached ? (
            <p className="mt-3 px-0.5 text-[12px] leading-relaxed text-muted-foreground">
              The cap is reached — {capCount} {capCount === 1 ? unitDef.one : unitDef.many} billed. Nothing
              further will be charged unless you raise it.
            </p>
          ) : canBillNow ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => onCollect(periodAmount - credit, shape, planLabel)}>
                  <CreditCard className="size-4" />
                  Bill the {rolled.length === 0 ? "first" : "next"} {unitDef.one} · {exact(periodAmount - credit)}
                </Button>
                <Button variant="outline" onClick={() => onSendLink(periodAmount - credit, shape, planLabel)}>
                  <Link2 className="size-4" />
                  {linkOut ? `Link sent ${linkOut} · send again` : "Send a payment link instead"}
                </Button>
              </div>
              <p className="mt-2 px-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                Due {withDay(next.chargeOn)} for {span(next.from, next.to)}
                {credit > 0 && ` · ${money(periodAmount)} less the ${exact(credit)} already collected`}
                {isPast(next.chargeOn) || isToday(next.chargeOn) ? "." : " — billing now takes it early."}
              </p>
            </div>
          ) : (
            <p className="mt-3 px-0.5 text-[12px] leading-relaxed text-muted-foreground">
              Nothing to bill yet. This {unitDef.one} is charged on what gets used, so it goes out on{" "}
              {withDay(next.chargeOn)} — the day it ends.
            </p>
          )}
        </>
      )}

      {/* ═══ the thing that is not part of the plan ═════════════════════════ */}

      <p className="mt-5 border-t border-foreground/10 px-0.5 pt-3 text-[11px] leading-relaxed text-muted-foreground/70">
        The {money(DEPOSIT)} security deposit sits outside all of this — the same hold whichever plan you pick,
        and never revenue until some of it is captured. It has its own card above.
      </p>
    </>
  );
}
