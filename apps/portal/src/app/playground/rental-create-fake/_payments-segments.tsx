"use client";

/**
 * The ladder — the per-period AND whole-rental money view of the Payments
 * stage. DESIGN SANDBOX; nothing here is real.
 *
 * ── The question it answers ──────────────────────────────────────────────
 *
 * "We have the original, then ten extensions, or the rental is extending
 * itself. What is the payment situation per extension, and overall?" Both, on
 * one row, with nothing for the operator to add up:
 *
 *   WHOLE RENTAL   pinned at the left, never scrolls away
 *   one cell per period, left → right in date order
 *   NOT TIED TO A PERIOD   the ad-hoc charges, so nothing on the ledger hides
 *
 * Every figure comes from `_payments-model`'s derivations — `chargedFor`,
 * `paidFor`, `outstandingFor`, `totals` — never from arithmetic done here, so
 * this row and the lists under it cannot disagree about the same rental.
 *
 * ── How it reads at density ──────────────────────────────────────────────
 *
 * Every cell carries the same three figures in the same three places and a
 * fill bar of paid-against-charged, so a rental reads as a SHAPE before it
 * reads as numbers: a run of full bars, a part bar, then empties. Healthy
 * periods go quiet — the outstanding line a dash and the status line BLANK,
 * because "Paid" under a paid figure and an empty outstanding figure is the
 * same fact said three times. The status line is kept for what the figures
 * cannot say: why the money has not arrived, or that some of it went back.
 *
 * Only money outstanding on a period the car is already out on, or on an
 * ad-hoc charge already raised, is `destructive` — the same rule the Extensions
 * rail uses for its Overdue figure, so the two never disagree. The same
 * shortfall on a period that has not started is merely not invoiced, which is
 * why the whole-rental cell states its overdue figure in words: $1,657.00
 * outstanding of which $887.00 is late is two facts, and painting the larger
 * one red would make the ladder disagree with the rail beside it.
 *
 * At ten-plus periods the ladder scrolls horizontally inside its own container.
 * The whole-rental cell sits outside the scroller, so the aggregate stays on
 * screen however long the rental has run, and the selected cell is nudged into
 * view whenever the selection changes from elsewhere.
 *
 * ── Selection ────────────────────────────────────────────────────────────
 *
 * The whole rental is a thing you select, not the absence of a selection:
 * `null` is its id, it has a cell, and the cell rings like any other. The
 * untied charges need an id of their own because `null` is taken — see
 * `UNTIED_SEGMENT_ID`. Which cell is selected is said by the ring alone; the
 * lists under the ladder scope to it, which is the rest of the answer.
 *
 * ── Colour ───────────────────────────────────────────────────────────────
 *
 * Amber appears nowhere — in this sandbox amber means "out of date". Owed and
 * overdue is `destructive`; nothing else is coloured.
 */

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  chargedFor,
  day,
  linkWords,
  outstandingFor,
  paidFor,
  sum,
  totals,
  usd,
  type Ledger,
  type Segment,
} from "./_payments-model";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

/** Fixed so SSR and hydration agree — the same day `_extensions.tsx` uses. */
const TODAY = "2026-09-05";

/**
 * The id the "Not tied to a period" cell selects with. The contract's `null`
 * already means the whole rental, and untied charges are `segmentId === null`
 * in the ledger, so they need a name of their own on the wire. A surface that
 * receives this scopes its lists to `charge.segmentId === null`.
 */
export const UNTIED_SEGMENT_ID = "untied";

/** Where a period sits relative to today — the same rule as the Extensions rail. */
type When = "past" | "current" | "future";

const whenOf = (s: Segment): When => (s.to <= TODAY ? "past" : s.from <= TODAY ? "current" : "future");

/** Three weights, shared with the lists under the ladder: fine recedes,
 *  pending is plain, wrong is the only colour. */
export type Tone = "fine" | "pending" | "wrong";

export const TONE: Record<Tone, string> = {
  fine: "text-muted-foreground/60",
  pending: "text-foreground/80",
  wrong: "font-medium text-destructive",
};

type State = { text: string; tone: Tone };

const span = (from: string, to: string) => `${day(from)} → ${day(to)}`;

/* ══════════════════════════════════════════════════════════════════════════
   What one period's status line says
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Why the money has not arrived — never a restatement of the figures above it.
 * A period that is simply paid says NOTHING here; the figures already did.
 *
 * "Declined" and "Nothing sent" are different facts and must never share a
 * word: one is a customer who tried and could not pay, the other is an
 * operator who has not yet asked. The link's own state comes from the model's
 * `linkWords`, so a period and the links list under it say it identically.
 *
 * `when` is null for untied charges — a fine already raised is owed now, so
 * they read as overdue the moment they are unpaid.
 */
function stateFor(l: Ledger, segmentId: string | null, when: When | null): State {
  const ids = new Set(l.charges.filter((c) => c.segmentId === segmentId).map((c) => c.id));
  if (ids.size === 0) return { text: "Nothing charged", tone: "fine" };

  const touches = (chargeIds: string[]) => chargeIds.some((id) => ids.has(id));

  if (outstandingFor(l, segmentId) === 0) {
    // A refund against this period's money is the one thing a paid period's
    // figures cannot show — it stays paid — so it is the one thing said here.
    const refunded = sum(
      l.payments.filter((p) => touches(p.allocations.map((a) => a.chargeId))).map((p) => p.refundedCents)
    );
    return { text: refunded ? `${usd(refunded)} refunded` : "", tone: "fine" };
  }

  // A period that has not started cannot be overdue; once the car is out on
  // it, the same shortfall is a fault.
  const bad: Tone = when === "future" ? "pending" : "wrong";

  if (l.payments.some((p) => p.status === "pending" && touches(p.allocations.map((a) => a.chargeId)))) {
    return { text: "Payment pending", tone: "pending" };
  }

  const link = l.links
    .filter((k) => touches(k.chargeIds))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  if (!link) return { text: "Nothing sent", tone: bad };
  // The link was paid but the money never reached these charges — an
  // allocation gap, which is the surface's job to close, not the customer's.
  if (link.status === "paid") return { text: "Paid, not applied", tone: "pending" };
  // A card that was refused is a fault wherever the period sits on the
  // calendar; everything else takes the period's own urgency.
  return { text: linkWords(link.status), tone: link.status === "declined" ? "wrong" : bad };
}

/* ══════════════════════════════════════════════════════════════════════════
   The bar
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Paid against charged, as a shape. The shortfall stays as bare track while a
 * period is still running or yet to start; once the period has run, the
 * shortfall is painted `destructive`, so a fully unpaid overdue period reads
 * as a solid red bar rather than as an empty one that could be anything.
 */
function Bar({ charged, paid, overdue }: { charged: number; paid: number; overdue: number }) {
  const pct = (n: number) => (charged > 0 ? `${Math.min(100, (n / charged) * 100)}%` : "0%");
  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
      <span className="h-full shrink-0 bg-primary" style={{ width: pct(paid) }} />
      {overdue > 0 && <span className="h-full shrink-0 bg-destructive" style={{ width: pct(overdue) }} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One cell
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The same six slots in every cell — name, dates, charged, bar, paid /
 * outstanding, state — so the eye lands on the same fact in the same place as
 * it scans across, and the bars line up into one row.
 */
function Cell({
  id,
  selected,
  onSelect,
  label,
  sub,
  charged,
  paid,
  outstanding,
  overdue,
  state,
  wide,
}: {
  /** Matched against `selectedSegmentId`; `"whole"` for the aggregate. */
  id: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
  sub: string;
  charged: number;
  paid: number;
  outstanding: number;
  /** Cents outstanding the car is already out on. Colours the bar and the figure. */
  overdue: number;
  state: State;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-segment={id}
      className={cn(
        "flex shrink-0 cursor-pointer flex-col rounded-3xl px-3 py-2.5 text-left transition-colors",
        wide ? "w-[172px]" : "w-[152px]",
        selected ? "bg-primary-light ring-2 ring-primary/40" : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className="block truncate text-[11px] font-medium leading-snug">{label}</span>
      <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground tabular-nums">{sub}</span>

      <span
        className={cn(
          "mt-2 block text-[13px] font-semibold leading-none tabular-nums",
          charged === 0 && "text-muted-foreground"
        )}
      >
        {usd(charged)}
      </span>

      <Bar charged={charged} paid={paid} overdue={overdue} />

      <span className="mt-2 flex items-baseline justify-between gap-2 text-[11px] leading-snug">
        <span className="text-muted-foreground">Paid</span>
        <span className={cn("tabular-nums", paid === 0 && "text-muted-foreground")}>{paid ? usd(paid) : "—"}</span>
      </span>
      <span className="flex items-baseline justify-between gap-2 text-[11px] leading-snug">
        <span className={outstanding ? undefined : "text-muted-foreground"}>Outstanding</span>
        {/* Red says "this is late". On a period all of the shortfall is late or
            none of it is; on the whole rental only part of it can be, and
            painting the whole figure red would overstate it — the status line
            carries the overdue figure there instead. */}
        <span
          className={cn(
            "tabular-nums",
            outstanding ? "font-semibold" : "text-muted-foreground",
            outstanding > 0 && overdue >= outstanding && "text-destructive"
          )}
        >
          {outstanding ? usd(outstanding) : "—"}
        </span>
      </span>

      {state.text && (
        <span className={cn("mt-1.5 block truncate text-[11px] leading-snug", TONE[state.tone])} title={state.text}>
          {state.text}
        </span>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The ladder
   ══════════════════════════════════════════════════════════════════════════ */

export function SegmentMoney({
  ledger,
  selectedSegmentId,
  onSelect,
}: {
  ledger: Ledger;
  /** null = the whole rental. */
  selectedSegmentId: string | null;
  onSelect: (segmentId: string | null) => void;
}) {
  /**
   * Date order, not insertion order — an extension back-dated to close a gap
   * belongs where it happened on the timeline, the same rule the rail uses.
   */
  const rows = useMemo(() => {
    const ordered = [...ledger.segments].sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0
    );
    return ordered.map((seg) => {
      const when = whenOf(seg);
      const outstanding = outstandingFor(ledger, seg.id);
      return {
        seg,
        charged: chargedFor(ledger, seg.id),
        paid: paidFor(ledger, seg.id),
        outstanding,
        // Outstanding once the car is out on the period: the only money that is late.
        overdue: when === "future" ? 0 : outstanding,
        state: stateFor(ledger, seg.id, when),
      };
    });
  }, [ledger]);

  const whole = useMemo(() => {
    const t = totals(ledger);
    // The untied charges are owed the moment they are raised, so they are late
    // in full — the same rule the Extensions rail applies to the parking fine.
    const overdue = sum(rows.map((r) => r.overdue)) + outstandingFor(ledger, null);
    const first = rows[0]?.seg.from ?? "";
    const last = rows.reduce((latest, r) => (r.seg.to > latest ? r.seg.to : latest), rows[0]?.seg.to ?? "");
    /**
     * The one thing the three figures above cannot say: how much of the
     * outstanding money is LATE, as opposed to simply not invoiced yet. Word
     * for word what the Extensions rail says beside it, so the two agree on
     * screen and not just in the arithmetic.
     */
    const state: State =
      overdue > 0
        ? { text: `${usd(overdue)} overdue`, tone: "wrong" }
        : t.outstanding > 0
          ? { text: "Nothing overdue", tone: "fine" }
          : { text: "", tone: "fine" };
    return { ...t, overdue, first, last, state };
  }, [ledger, rows]);

  const untied = useMemo(() => {
    const charges = ledger.charges.filter((c) => c.segmentId === null);
    return {
      count: charges.length,
      sub: charges.length === 1 ? charges[0].label : `${charges.length} charges`,
      charged: chargedFor(ledger, null),
      paid: paidFor(ledger, null),
      outstanding: outstandingFor(ledger, null),
      state: stateFor(ledger, null, null),
    };
  }, [ledger]);

  /* Nudge the selected cell into view when the selection moves from elsewhere. */
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedSegmentId === null) return;
    const el = trackRef.current?.querySelector<HTMLElement>(`[data-segment="${CSS.escape(selectedSegmentId)}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedSegmentId]);

  return (
    <div className="flex items-stretch gap-3">
      <Cell
        id="whole"
        wide
        selected={selectedSegmentId === null}
        onSelect={() => onSelect(null)}
        label="Whole rental"
        sub={whole.first ? span(whole.first, whole.last) : "—"}
        charged={whole.charged}
        paid={whole.applied}
        outstanding={whole.outstanding}
        overdue={whole.overdue}
        state={whole.state}
      />

      <div className="my-2 w-px shrink-0 bg-foreground/10" />

      {/* `min-w-0 flex-1` is load-bearing: without it the track widens the
          column instead of scrolling inside it. */}
      <div className="min-w-0 flex-1 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
        <div ref={trackRef} className="flex w-max items-stretch gap-1.5">
          {rows.map((r) => (
            <Cell
              key={r.seg.id}
              id={r.seg.id}
              selected={selectedSegmentId === r.seg.id}
              onSelect={() => onSelect(r.seg.id)}
              label={r.seg.label}
              sub={`${span(r.seg.from, r.seg.to)} · ${r.seg.days}d`}
              charged={r.charged}
              paid={r.paid}
              outstanding={r.outstanding}
              overdue={r.overdue}
              state={r.state}
            />
          ))}

          {untied.count > 0 && (
            <Cell
              id={UNTIED_SEGMENT_ID}
              selected={selectedSegmentId === UNTIED_SEGMENT_ID}
              onSelect={() => onSelect(UNTIED_SEGMENT_ID)}
              label="Not tied to a period"
              sub={untied.sub}
              charged={untied.charged}
              paid={untied.paid}
              outstanding={untied.outstanding}
              overdue={untied.outstanding}
              state={untied.state}
            />
          )}
        </div>
      </div>
    </div>
  );
}
