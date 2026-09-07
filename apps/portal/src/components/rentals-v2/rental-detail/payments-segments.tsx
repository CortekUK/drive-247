"use client";

/**
 * The ladder — the per-period AND whole-rental money view of the Payments
 * stage, on real rows.
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
 * Every figure comes from `payments-model`'s derivations — `chargedFor`,
 * `paidFor`, `outstandingFor`, `totals` — never from arithmetic done here, so
 * this row and the lists under it cannot disagree about the same rental.
 *
 * ── How it reads at density ──────────────────────────────────────────────
 *
 * Every cell carries the same figures in the same places and a fill bar of
 * paid-against-charged, so a rental reads as a SHAPE before it reads as
 * numbers: a run of full bars, a part bar, then empties. Healthy periods go
 * quiet — the outstanding line a dash and the status line BLANK, because
 * "Paid" under a paid figure and an empty outstanding figure is the same fact
 * said three times.
 *
 * Only money outstanding on a period the car is already out on, or on an
 * ad-hoc charge already raised, is `destructive`. The same shortfall on a
 * period that has not started is merely not invoiced yet — which is why the
 * whole-rental cell states its overdue figure in words rather than painting
 * the larger figure red.
 *
 * ── Colour ───────────────────────────────────────────────────────────────
 *
 * Amber appears nowhere: on this screen amber means "out of date". Owed and
 * overdue is `destructive`; so is a charge no payment can reach. Nothing else
 * is coloured.
 */

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  chargedFor,
  counts,
  day,
  linkWords,
  outstandingFor,
  paidFor,
  sum,
  totals,
  usd,
  type Ledger,
  type Segment,
} from "./payments-model";

/**
 * The id the "Not tied to a period" cell selects with. The contract's `null`
 * already means the whole rental, and untied charges are `segmentId === null`
 * in the ledger, so they need a name of their own on the wire.
 */
export const UNTIED_SEGMENT_ID = "untied";

/** Groups and scopes share one key space; this is the one translation. */
export const modelIdOf = (key: string | null) =>
  key === null ? null : key === UNTIED_SEGMENT_ID ? null : key;

/** Three weights, shared with the lists under the ladder. */
export type Tone = "fine" | "pending" | "wrong";

export const TONE: Record<Tone, string> = {
  fine: "text-muted-foreground/60",
  pending: "text-foreground/80",
  wrong: "font-medium text-destructive",
};

type State = { text: string; tone: Tone };

/** Where a period sits relative to today. */
type When = "past" | "current" | "future";

const span = (from: string, to: string | null) => `${day(from)} → ${to ? day(to) : "open"}`;

/**
 * What one period's status line says.
 *
 * Never a restatement of the figures above it: a period that is simply paid
 * says NOTHING here. The line is kept for what the figures cannot say — why
 * the money has not arrived, that some of it went back, or that a charge sits
 * in a category the allocator cannot reach.
 */
function stateFor(l: Ledger, segmentId: string | null, when: When | null): State {
  const own = l.charges.filter((c) => c.segmentId === segmentId);
  if (own.length === 0) return { text: "Nothing charged", tone: "fine" };

  const ids = new Set(own.map((c) => c.id));
  const touches = (chargeIds: string[]) => chargeIds.some((id) => ids.has(id));

  if (outstandingFor(l, segmentId) === 0) {
    // A refund against this period's money is the one thing a paid period's
    // figures cannot show — it stays paid — so it is the one thing said here.
    const refunded = sum(
      l.payments.filter((p) => touches(p.allocations.map((a) => a.chargeId))).map((p) => p.refundedCents)
    );
    return { text: refunded ? `${usd(refunded)} refunded` : "", tone: "fine" };
  }

  // A charge no payment can ever settle outranks everything else that could be
  // said about this period — it is not late, it is unreachable.
  const stuck = own.filter((c) => !c.settleable && outstandingFor(l, segmentId) > 0);
  if (stuck.length > 0 && stuck.every((c) => c.amountCents > 0)) {
    const unreachable = sum(stuck.map((c) => Math.max(0, c.amountCents)));
    if (unreachable > 0 && own.every((c) => !c.settleable)) {
      return { text: "No payment can settle this", tone: "wrong" };
    }
  }

  // A period that has not started cannot be overdue; once the car is out on
  // it, the same shortfall is a fault.
  const bad: Tone = when === "future" ? "pending" : "wrong";

  if (l.payments.some((p) => p.status === "pending" && touches(p.allocations.map((a) => a.chargeId)))) {
    return { text: "Payment pending", tone: "pending" };
  }

  // The most recent request that carried any of these charges. A payment link
  // in this schema IS a payment row, so the request and the money are the same
  // object read at two moments.
  const request = l.payments
    .filter((p) => p.proof.source === "link" && touches(p.allocations.map((a) => a.chargeId)))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  if (!request) return { text: "Nothing sent", tone: bad };
  const state = request.proof.source === "link" ? request.proof.state : null;
  if (counts(request)) return { text: "Paid, not applied", tone: "pending" };
  return { text: linkWords(state), tone: request.deadReason === "declined" ? "wrong" : bad };
}

/**
 * Paid against charged, as a shape. The shortfall stays as bare track while a
 * period is still running or yet to start; once the period has run, it is
 * painted `destructive`, so a fully unpaid overdue period reads as a solid red
 * bar rather than as an empty one that could be anything.
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
   * Local calendar day. Not `toISOString().slice(0,10)`, which is UTC and is
   * already tomorrow for a US operator at 8pm — every period would tip into
   * "overdue" an evening early.
   */
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const whenOf = (s: Segment): When =>
    s.to && s.to <= today ? "past" : s.from && s.from <= today ? "current" : "future";

  /**
   * Date order, not insertion order — an extension back-dated to close a gap
   * belongs where it happened on the timeline.
   */
  const rows = useMemo(() => {
    const ordered = [...ledger.segments].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    return ordered
      .map((seg) => {
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
      })
      // A period with no charges at all is an extension nobody billed for. It
      // is worth one cell so it cannot hide, but only if the rental has more
      // than one period to compare it against.
      .filter((r) => r.charged > 0 || ordered.length > 1);
  }, [ledger, today]);

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

  const whole = useMemo(() => {
    const t = totals(ledger);
    // The untied charges are owed the moment they are raised, so they are late
    // in full.
    const overdue = sum(rows.map((r) => r.overdue)) + untied.outstanding;
    const first = rows[0]?.seg.from ?? "";
    const last = rows.reduce<string | null>((latest, r) => (r.seg.to && (!latest || r.seg.to > latest) ? r.seg.to : latest), null);
    /**
     * The one thing the three figures above cannot say: how much of the
     * outstanding money is LATE, as opposed to simply not invoiced yet.
     */
    const state: State =
      overdue > 0
        ? { text: `${usd(overdue)} overdue`, tone: "wrong" }
        : t.outstanding > 0
          ? { text: "Nothing overdue", tone: "fine" }
          : { text: "", tone: "fine" };
    return { ...t, overdue, first, last, state };
  }, [ledger, rows, untied]);

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
              sub={`${span(r.seg.from, r.seg.to)}${r.seg.days != null ? ` · ${r.seg.days}d` : ""}`}
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
