"use client";

/**
 * Extensions — the FIRST tab of the right rail. DESIGN SANDBOX, nothing is real.
 *
 * No Supabase, no tenant, no auth, no network, no react-query. Every figure is
 * derived from a module constant and every change is local state.
 *
 * ── The question this tab answers ────────────────────────────────────────────
 *
 * "With five to ten extensions, how does the rail stay readable — and where
 * does the detail of any one of them live?"
 *
 * The answer built here: the rail is a plain STACK OF CARDS, one per period,
 * each saying only which period it is and when it ran. No money, no status
 * words. One small red dot marks a period that needs someone now. Click a card
 * and a DIALOG opens with everything about that one period — dates, money to
 * the cent, agreement, cover, the note, the paperwork trail, who booked it.
 * Extend opens its own small dialog and lands a new card on the stack.
 *
 * The rail is for finding; the dialog is for reading. Nothing on the rail
 * competes with the cards that carry a dot.
 *
 * ── Shape of the tab ─────────────────────────────────────────────────────────
 *
 * A scrolling middle and a pinned footer — the same shape Messages has. The
 * stack can be seven cards or seventy; the two controls an operator reaches
 * for, Extend and the auto-extension switch, never scroll away. Extend sits at
 * the bottom because that is where its result lands: the end of the stack.
 *
 * ── Why it is seeded dense ───────────────────────────────────────────────────
 *
 * GMT ran 110 extensions across 12 rentals; RevTek is the same shape. Six or
 * ten extensions is not the edge case, it is the normal case, so this is seeded
 * with SIX plus the original. A one-extension happy path would have hidden
 * every problem this layout has to solve.
 *
 * What makes it readable at that density: a card carries nothing that could
 * compete with the dot. Scanning seven cards you see the three that need you,
 * and every other fact about a period is one click away.
 *
 * ── Grounded in the real product ─────────────────────────────────────────────
 *
 *   table       `rental_extensions` — `sequence_number`, `previous_end_date`,
 *               `new_end_date`, `extension_days`, `rental_amount`,
 *               `insurance_amount`, `tax_amount`, `total_amount`, `paid_amount`,
 *               `bonzah_policy_id`. Each extension really is a small rental
 *               with its own money, its own paperwork and its own policy —
 *               which is why the dialog carries all three, not one status.
 *               Tax is left out of the sandbox on purpose: the Payments
 *               ledger in `_payments-model.ts` prices the same seven periods,
 *               and the two surfaces have to agree to the dollar.
 *   statuses    the `rental_extension_totals` view's `display_status` is
 *               `paid` / `partial` / `awaiting_payment`; mirrored here as
 *               paid / part / unpaid.
 *   agreements  extensions get their own BoldSign envelope
 *               (ExtensionRequestDialog sends one per extension), so "signed /
 *               out for signature / not sent" is per-period, not per-rental.
 *   auto        `rentals.auto_extend_*` — `period_unit` (Daily/Weekly/Monthly),
 *               `interval_count`, `charge_mode` ('pay_link' | 'auto_charge'),
 *               `next_charge_at`. Deliberately reduced here to PERIOD and
 *               UP FRONT / AFTER; the real section carries cadence exceptions,
 *               reminder ladders and per-occurrence overrides, none of which
 *               belong in 328px.
 *
 * Out of scope on purpose: installments and pay-as-you-go.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 *
 * Amber appears nowhere. In this sandbox amber means "out of date"; the dot,
 * the gap and overlap markers and money owed are `destructive`, and the
 * projected renewal is `primary` at low weight — it has not happened and it is
 * nobody's fault.
 */

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import {
  ActionButton,
  EmptyHint,
  Field,
  fmtDate,
  inputCls,
  money,
  textareaCls,
} from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

/** Fixed so nothing here depends on the wall clock — SSR and hydration agree. */
const TODAY = "2026-09-05";

const DAY_RATE = 110;
const COVER_RATE = 14;

/**
 * Money on this rental that belongs to no period. The ledger in
 * `_payments-model.ts` carries a $75 parking fine passed through on 29 Aug,
 * unpaid, and the overview's totals have to agree with that ledger to the
 * dollar. It gets no card — the stack is periods — so it is folded into the
 * totals only.
 */
const OFF_PERIOD = { charged: 75, paid: 0 };

/** `display_status` on the real `rental_extension_totals` view. */
type Pay = "paid" | "part" | "unpaid";
/** One BoldSign envelope per extension. */
type Doc = "signed" | "sent" | "unsent";
/** `short` = a policy that stops before the period does. It happens whenever an
 *  extension is booked but Bonzah is not re-quoted for the new end date. */
type Cover = "covered" | "short" | "none";

type Segment = {
  id: string;
  kind: "original" | "extension";
  from: string;
  to: string;
  pay: Pay;
  /** Only meaningful when `pay === "part"`. */
  paidAmount?: number;
  doc: Doc;
  cover: Cover;
  /** Only meaningful when `cover === "short"`. */
  coverEnds?: string;
  /** Charges riding on this period besides rental and cover — a child seat,
   *  delivery. Only the original carries any; an extension is days and a policy. */
  extras?: { label: string; amount: number }[];
  bookedOn: string;
  /** Who booked it. Staff names match the Activity tab's. */
  by: string;
  paidOn?: string;
  note?: string;
};

/** Where a segment sits relative to today. Drives emphasis, not colour alone. */
type When = "past" | "current" | "future";

/* ══════════════════════════════════════════════════════════════════════════
   Dates and money
   ══════════════════════════════════════════════════════════════════════════ */

const at = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

const daysBetween = (from: string, to: string) => Math.round((at(to) - at(from)) / 86_400_000);

/**
 * Read a Date back as a plain YYYY-MM-DD in LOCAL time.
 *
 * Not `toISOString().slice(0, 10)`, which is the classic off-by-one: these
 * dates are parsed as local midnight, and in any timezone east of UTC local
 * midnight is still the previous day in UTC — so an extension added in Karachi
 * would have come back a day short.
 */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (from: string, n: number) => {
  const d = new Date(`${from}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const addMonths = (from: string, n: number) => {
  const d = new Date(`${from}T00:00:00`);
  d.setMonth(d.getMonth() + n);
  return iso(d);
};

const dayCount = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Cents shown, for the dialog. The rail's `money` rounds to the dollar. */
const exact = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * "Sat, Sep 5, 2026" — the full date with its weekday.
 *
 * The weekday is not decoration on a rental: half of what an operator checks
 * when reading a period is whether it runs over a weekend, and "Sep 10" alone
 * never answers that.
 */
const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * A date span the way a person says it: "5 – 10 Aug", "31 Aug – 5 Sep", and
 * only when a period crosses a year, "28 Dec 2026 – 4 Jan 2027". The full
 * dates with the year live in the dialog.
 */
const span = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  if (a.getFullYear() !== b.getFullYear()) {
    return `${a.getDate()} ${mon(a)} ${a.getFullYear()} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  }
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
  return `${a.getDate()} – ${b.getDate()} ${mon(a)}`;
};

/**
 * One period's money, the way the real row stores it: rental and insurance as
 * separate columns that add up to `total_amount`. Derived rather than typed
 * into the seed so a segment the operator adds during the demo prices itself
 * by exactly the same rule the seeded ones did — and the same rule the
 * Payments ledger uses, so the two never disagree about a period.
 */
const priceOf = (s: Pick<Segment, "from" | "to" | "cover" | "coverEnds" | "extras">) => {
  const days = Math.max(0, daysBetween(s.from, s.to));
  const rental = days * DAY_RATE;
  // Cover is bought per covered day. A `short` policy was bought for fewer
  // days than the period runs — it costs less, and reads as a fault all the same.
  const coveredDays =
    s.cover === "none" ? 0 : s.cover === "short" && s.coverEnds ? Math.max(0, daysBetween(s.from, s.coverEnds)) : days;
  const insurance = coveredDays * COVER_RATE;
  const extras = (s.extras ?? []).reduce((n, e) => n + e.amount, 0);
  return { days, coveredDays, rental, insurance, extras, total: rental + insurance + extras };
};

const paidOf = (s: Segment) => {
  if (s.pay === "paid") return priceOf(s).total;
  if (s.pay === "part") return s.paidAmount ?? 0;
  return 0;
};

const whenOf = (s: { from: string; to: string }): When =>
  s.to <= TODAY ? "past" : s.from <= TODAY ? "current" : "future";

/* ══════════════════════════════════════════════════════════════════════════
   Seed — one rental that has been extended six times
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A month-old rental at $110/day, running now, with every failure mode an
 * operator actually meets sitting somewhere in it:
 *
 *   s3   booked a day late     → a GAP: 24→25 Aug, car out, nothing on it
 *   s3   no policy             → that week was never insured
 *   s4   part paid             → $400 against $620
 *   s5   running now, unpaid, agreement still out, and the policy stops
 *        8 Sep while the period runs to the 10th
 *   s6   starts 9 Sep          → an OVERLAP: 9→10 Sep is billed twice
 *
 * Everything before that is clean, which is the point — the clean ones have to
 * recede or the broken ones cannot be found.
 */
const SEED: Segment[] = [
  {
    id: "s0",
    kind: "original",
    from: "2026-08-05",
    to: "2026-08-10",
    pay: "paid",
    doc: "signed",
    cover: "covered",
    extras: [
      { label: "Child seat × 5 days", amount: 40 },
      { label: "Delivery · 14 mi", amount: 45 },
    ],
    bookedOn: "2026-07-28",
    by: "Priya",
    paidOn: "2026-07-28",
  },
  {
    id: "s1",
    kind: "extension",
    from: "2026-08-10",
    to: "2026-08-17",
    pay: "paid",
    doc: "signed",
    cover: "covered",
    bookedOn: "2026-08-09",
    by: "Priya",
    paidOn: "2026-08-09",
  },
  {
    id: "s2",
    kind: "extension",
    from: "2026-08-17",
    to: "2026-08-24",
    pay: "paid",
    doc: "signed",
    cover: "covered",
    bookedOn: "2026-08-16",
    by: "Dan",
    paidOn: "2026-08-16",
  },
  {
    id: "s3",
    kind: "extension",
    from: "2026-08-25",
    to: "2026-08-31",
    pay: "paid",
    doc: "signed",
    cover: "none",
    bookedOn: "2026-08-25",
    by: "Dan",
    paidOn: "2026-08-26",
    note: "Booked on the Tuesday after he'd already kept it over the weekend.",
  },
  {
    id: "s4",
    kind: "extension",
    from: "2026-08-31",
    to: "2026-09-05",
    pay: "part",
    paidAmount: 400,
    doc: "signed",
    cover: "covered",
    bookedOn: "2026-08-30",
    by: "Priya",
  },
  {
    id: "s5",
    kind: "extension",
    from: "2026-09-05",
    to: "2026-09-10",
    pay: "unpaid",
    doc: "sent",
    cover: "short",
    coverEnds: "2026-09-08",
    bookedOn: "2026-09-04",
    by: "Dan",
  },
  {
    id: "s6",
    kind: "extension",
    from: "2026-09-09",
    to: "2026-09-16",
    pay: "unpaid",
    doc: "unsent",
    cover: "none",
    bookedOn: "2026-09-04",
    by: "Priya",
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   Facets
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Three facets — money, paperwork, policy — because an extension is a small
 * rental and one word cannot carry all three. Each carries a tone:
 *
 *   fine      nothing to do
 *   pending   a thing to do on a period that has not started
 *   wrong     money owed on days already used, a car out uncovered, or a
 *             running period nobody has signed for — needs someone NOW
 *
 * The card shows only whether any facet is `wrong`, as one dot. The dialog
 * shows the words.
 */
type Facet = { text: string; tone: "fine" | "pending" | "wrong" };

const facetsOf = (s: Segment, when: When): Facet[] => {
  // A period that has not started yet cannot be overdue or uncovered — it is
  // simply not done. Once the car is out on it, the same gap is a fault.
  const bad = (when === "future" ? "pending" : "wrong") as Facet["tone"];

  const pay: Facet =
    s.pay === "paid"
      ? { text: "Paid", tone: "fine" }
      : s.pay === "part"
        ? { text: "Part paid", tone: bad }
        : { text: "Unpaid", tone: bad };

  const doc: Facet =
    s.doc === "signed"
      ? { text: "Signed", tone: "fine" }
      : s.doc === "sent"
        ? { text: "Out for signature", tone: bad }
        : { text: "Not sent", tone: bad };

  const cover: Facet =
    s.cover === "covered"
      ? { text: "Covered", tone: "fine" }
      : s.cover === "short"
        ? { text: "Cover ends early", tone: "wrong" }
        : { text: "No cover", tone: bad };

  return [pay, doc, cover];
};

/** The dot on the card: any facet that is wrong right now. */
const needsAttention = (s: Segment) => facetsOf(s, whenOf(s)).some((f) => f.tone === "wrong");

/** What has happened to this one period, in order — the dialog's trail. */
const stepsFor = (s: Segment, ordinal: number) => [
  {
    label: s.kind === "original" ? "Rental created" : `Extension ${ordinal} added`,
    at: fmtDate(s.bookedOn),
    done: true,
  },
  { label: "Agreement sent", done: s.doc !== "unsent" },
  { label: "Signed by the customer", done: s.doc === "signed" },
  {
    label:
      s.cover === "covered"
        ? "Insured for the whole period"
        : s.cover === "short"
          ? `Insured only to ${fmtDate(s.coverEnds ?? "")}`
          : "No policy on this period",
    done: s.cover === "covered",
  },
  { label: "Paid in full", at: s.paidOn ? fmtDate(s.paidOn) : undefined, done: s.pay === "paid" },
];

const labelOf = (kind: Segment["kind"], ordinal: number) =>
  kind === "original" ? "Original rental" : `Extension ${ordinal}`;

/* ══════════════════════════════════════════════════════════════════════════
   Gaps and overlaps
   ══════════════════════════════════════════════════════════════════════════ */

type Break = { kind: "gap" | "overlap"; days: number; from: string; to: string };

/**
 * The discontinuity between two consecutive periods, if there is one.
 *
 * Worth its own line between the two cards rather than being quietly closed
 * up: a gap is a day the car was out with nothing covering it, and an overlap
 * is a day billed twice. Both are ordinary operator slips — an extension typed
 * a day late, a from-date left on the wrong day — and both are invisible in
 * every list-of-extensions view, which is exactly why they survive for months.
 */
const breakBetween = (prev: Segment, next: Segment): Break | null => {
  const d = daysBetween(prev.to, next.from);
  if (d > 0) return { kind: "gap", days: d, from: prev.to, to: next.from };
  if (d < 0) return { kind: "overlap", days: -d, from: next.from, to: prev.to };
  return null;
};

/* ══════════════════════════════════════════════════════════════════════════
   One card
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The whole card: which period, when, and — only if it needs someone now — a
 * dot. The running period gets a faint primary fill instead of the muted one
 * and nothing louder.
 */
function PeriodCard({ label, seg, onOpen }: { label: string; seg: Segment; onOpen: () => void }) {
  const current = whenOf(seg) === "current";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-3xl px-3.5 py-2.5 text-left transition-colors",
        current ? "bg-primary/5 hover:bg-primary/10" : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{span(seg.from, seg.to)}</span>
      {/* Always in the layout so the dates line up down the stack; painted
          only when the period needs someone now. */}
      <span className={cn("size-1.5 shrink-0 rounded-full", needsAttention(seg) && "bg-destructive")} />
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One period, in full — the dialog
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ── Why this dialog is shaped the way it is ─────────────────────────────────
 *
 * An extension is a small rental, and there are exactly four questions anyone
 * opens one to answer: WHEN did it run, WHAT did it cost and did that money
 * arrive, was the car INSURED for it, and did anyone SIGN for it. So the
 * dialog is four titled sections in that order and nothing else, with the
 * paperwork trail underneath as the one thing that spans all four.
 *
 * It was previously nine label/value rows in a 448px column — every fact
 * present, none of them findable, because "Charged / Paid / Outstanding" sat
 * in the same undifferentiated stack as "Agreement" and "Insurance". Width is
 * the fix: two columns of ~340px, sections separated by air rather than by
 * rules or boxes. The dialog is already a surface; putting cards inside it
 * would be a surface on a surface.
 *
 * Colour rule, same as the rest of the file: amber is reserved for "out of
 * date" elsewhere on this screen and appears nowhere here. Days already run
 * with money owed, no cover, or nobody's signature are `destructive`. A period
 * that has not started yet cannot be at fault — those read `muted`.
 */

type Tone = "plain" | "muted" | "bad" | "strong";

const TONE: Record<Tone, string> = {
  plain: "",
  muted: "text-muted-foreground",
  bad: "font-medium text-destructive",
  strong: "font-medium",
};

/** A facet's tone as a row tone — `pending` recedes, it never turns red. */
const TONE_OF: Record<Facet["tone"], Tone> = { fine: "plain", pending: "muted", wrong: "bad" };

/**
 * A titled group of facts. No ring, no fill, no rule — the gap above the title
 * is what makes it a section, and 10px uppercase tracking-widest is the same
 * title the rail groups wear, so the two read as one system.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</p>
      {children}
    </section>
  );
}

/**
 * One fact: label left, value right, with real space between them.
 *
 * `sub` is the second line under a value — the qualifier that would have made
 * the value itself too long to scan ("8 days before it started", "with the
 * extension"). It is the smaller of the two fact sizes; nothing else is.
 */
function Row({
  label,
  sub,
  tone = "plain",
  nums,
  children,
}: {
  label: string;
  sub?: string;
  tone?: Tone;
  /** Figures only — every amount and count on this screen lines up. */
  nums?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-8">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={cn("text-[13px]", nums && "tabular-nums", TONE[tone])}>{children}</span>
        {sub && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}

/**
 * The sentence a section ends on — the judgement its rows imply, said in
 * words, because "3 of 5" is a number an operator still has to interpret and
 * "the car is out for two days with nothing on it" is not.
 */
function Verdict({ bad, children }: { bad?: boolean; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-[13px] leading-relaxed",
        bad ? "font-medium text-destructive" : "text-muted-foreground"
      )}
    >
      {bad && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/** A discontinuity, said as a sentence rather than as the rail's short marker. */
const brkLine = (b: Break, side: "before" | "after") =>
  b.kind === "gap"
    ? `${dayCount(b.days)} gap ${side} this period — nothing at all covers ${span(b.from, b.to)}.`
    : `Overlaps the period ${side === "before" ? "before" : "after"} it by ${dayCount(b.days)} — ${span(b.from, b.to)} is billed twice.`;

/** Everything the card does not say. */
function PeriodDetail({
  seg,
  ordinal,
  before,
  after,
}: {
  seg: Segment;
  ordinal: number;
  /** The discontinuity against the period on either side, if there is one. */
  before: Break | null;
  after: Break | null;
}) {
  const when = whenOf(seg);
  const price = priceOf(seg);
  const paid = paidOf(seg);
  const outstanding = price.total - paid;
  const [, doc, cover] = facetsOf(seg, when);

  const isExt = seg.kind === "extension";
  /** Tense, so every sentence in here agrees with where the period sits. */
  const starts = when === "future" ? "starts" : "started";

  const sinceEnd = daysBetween(seg.to, TODAY);
  const untilStart = daysBetween(TODAY, seg.from);
  const standing =
    when === "current"
      ? `Running now — day ${Math.min(price.days, Math.max(1, daysBetween(seg.from, TODAY) + 1))} of ${price.days}`
      : when === "past"
        ? sinceEnd === 0
          ? "Finished today"
          : `Finished ${dayCount(sinceEnd)} ago`
        : untilStart === 0
          ? "Starts today"
          : `Starts in ${dayCount(untilStart)}`;

  // How late the paperwork was against the car. s3 was booked on the day it
  // started — after the customer had already had the car over a weekend — and
  // that is the single most useful fact about it.
  const lead = daysBetween(seg.bookedOn, seg.from);
  const leadText =
    lead > 0
      ? `${dayCount(lead)} before it ${starts}`
      : lead === 0
        ? `On the day it ${starts}`
        : `${dayCount(-lead)} after it ${starts}`;

  // Money against days the car has already been out on is a fault. Money on a
  // period that has not run is simply not collected yet, and reads muted.
  const owed = outstanding > 0 && when !== "future";
  const uncovered = price.days - price.coveredDays;
  const policyEnds = seg.cover === "short" ? (seg.coverEnds ?? seg.to) : seg.to;

  /**
   * When the money landed, said against the two dates that matter: when the
   * period was booked, and when the car actually went out. Both are in the
   * seed and neither is on the row — "$705.00" three days after the customer
   * drove away is a different fact from "$705.00" eight days before.
   */
  const settleLag = seg.paidOn ? daysBetween(seg.bookedOn, seg.paidOn) : 0;
  const settleVsStart = seg.paidOn ? daysBetween(seg.paidOn, seg.from) : 0;
  const lagPhrase =
    settleLag === 0
      ? "the day it was booked"
      : settleLag === 1
        ? "the day after it was booked"
        : `${dayCount(settleLag)} after it was booked`;
  const vsStartPhrase =
    settleVsStart > 0
      ? `${dayCount(settleVsStart)} before the car went out`
      : settleVsStart === 0
        ? "on the day the car went out"
        : `${dayCount(-settleVsStart)} after the car had already gone out`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labelOf(seg.kind, ordinal)}</DialogTitle>
        <DialogDescription>{standing}</DialogDescription>
      </DialogHeader>

      {/* Two columns of real content. Period and Insurance answer "what
          happened to the car"; Payment and Agreement answer "what happened on
          paper" — so each column is one question, top to bottom. Below `sm:`
          they stack in the same order. */}
      <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
        <div className="space-y-9">
          <Section title="Period">
            <dl className="space-y-3">
              <Row label="Starts">{fmtDay(seg.from)}</Row>
              <Row label="Ends">{fmtDay(seg.to)}</Row>
              <Row label="Length" nums>
                {dayCount(price.days)}
              </Row>
              <Row label="Booked" sub={leadText}>
                {fmtDate(seg.bookedOn)} · {seg.by}
              </Row>
            </dl>

            {before && <Verdict bad>{brkLine(before, "before")}</Verdict>}
            {after && <Verdict bad>{brkLine(after, "after")}</Verdict>}

            {seg.note && (
              <p className="text-[13px] italic leading-relaxed text-muted-foreground">“{seg.note}”</p>
            )}
          </Section>

          <Section title="Insurance">
            <dl className="space-y-3">
              <Row label="Premium" nums tone={seg.cover === "none" ? "muted" : "plain"}>
                {seg.cover === "none" ? "Nothing bought" : exact(price.insurance)}
              </Row>
              <Row label="Days covered" nums tone={TONE_OF[cover.tone]}>
                {price.coveredDays} of {price.days}
              </Row>
              {seg.cover !== "none" && (
                <>
                  <Row label="Policy runs" tone={seg.cover === "short" ? "bad" : "plain"}>
                    {fmtDate(seg.from)} → {fmtDate(policyEnds)}
                  </Row>
                  <Row label="Rate" nums>
                    {exact(COVER_RATE)} a day
                  </Row>
                </>
              )}
            </dl>

            {seg.cover === "covered" ? (
              <Verdict>Covered for every day of this period.</Verdict>
            ) : seg.cover === "short" ? (
              <Verdict bad>
                The policy stops {fmtDate(policyEnds)} but the period runs to {fmtDate(seg.to)} — the last{" "}
                {dayCount(uncovered)} {when === "past" ? "had" : "have"} the car out with no cover on it.
              </Verdict>
            ) : when === "future" ? (
              <Verdict>No policy on this period yet. It can still be quoted before {fmtDate(seg.from)}.</Verdict>
            ) : (
              <Verdict bad>
                No policy was ever bought for this period. The car {when === "past" ? "was" : "is"} out for{" "}
                {dayCount(price.days)} with nothing on it.
              </Verdict>
            )}
          </Section>
        </div>

        <div className="space-y-9">
          <Section title="Payment">
            {/* The charge broken into its lines, not one total: an operator
                arguing an invoice needs the day count and the rate, and the
                insurance line is the only place the short policy shows up as
                money. */}
            <dl className="space-y-3">
              <Row label={`Rental · ${dayCount(price.days)} × ${exact(DAY_RATE)}`} nums>
                {exact(price.rental)}
              </Row>
              <Row
                label={
                  seg.cover === "none"
                    ? "Insurance"
                    : `Insurance · ${dayCount(price.coveredDays)} × ${exact(COVER_RATE)}`
                }
                nums
                tone={seg.cover === "none" ? "muted" : "plain"}
              >
                {seg.cover === "none" ? "Not bought" : exact(price.insurance)}
              </Row>
              {seg.extras?.map((x) => (
                <Row key={x.label} label={x.label} nums>
                  {exact(x.amount)}
                </Row>
              ))}
            </dl>

            <dl className="space-y-3 pt-2">
              <Row label="Charged" tone="strong" nums>
                {exact(price.total)}
              </Row>
              <Row label="Received" nums>
                {exact(paid)}
              </Row>
              <Row label="Outstanding" tone={owed ? "bad" : outstanding > 0 ? "muted" : "plain"} nums>
                {exact(outstanding)}
              </Row>
            </dl>

            {seg.pay === "paid" ? (
              <Verdict>
                {seg.paidOn
                  ? `Settled in full on ${fmtDate(seg.paidOn)} — ${lagPhrase}, ${vsStartPhrase}.`
                  : "Settled in full."}
              </Verdict>
            ) : seg.pay === "part" ? (
              <Verdict bad={owed}>
                {exact(paid)} arrived against {exact(price.total)}.{" "}
                {owed
                  ? `${exact(outstanding)} is still owed on days the car ${when === "past" ? "has already been out on" : "is out on right now"}.`
                  : `${exact(outstanding)} is still to collect before this period starts.`}
              </Verdict>
            ) : when === "future" ? (
              <Verdict>Nothing collected yet. This period starts {fmtDate(seg.from)}.</Verdict>
            ) : (
              <Verdict bad>
                Nothing has been received against this period, and the car {when === "past" ? "already ran" : "has been out"} on it{" "}
                {when === "past" ? `from ${fmtDate(seg.from)}` : `since ${fmtDate(seg.from)}`}.
              </Verdict>
            )}
          </Section>

          <Section title="Agreement">
            <dl className="space-y-3">
              <Row label="State" tone={TONE_OF[doc.tone]}>
                {doc.text}
              </Row>
              {seg.doc !== "unsent" && (
                <Row label="Sent" sub={isExt ? "with the extension" : "with the booking"}>
                  {fmtDate(seg.bookedOn)}
                </Row>
              )}
              {seg.doc === "signed" && <Row label="Signed by">The customer</Row>}
              {/* The terms it carries. The envelope was raised against THIS
                  period's figures, so if the period is re-priced the signature
                  on file no longer matches what is owed. */}
              {seg.doc !== "unsent" && (
                <Row
                  label="Issued against"
                  nums
                  sub={`${span(seg.from, seg.to)} · ${dayCount(price.days)}`}
                >
                  {exact(price.total)}
                </Row>
              )}
            </dl>

            {seg.doc === "signed" ? null : seg.doc === "sent" ? (
              when === "future" ? (
                <Verdict>With the customer, waiting on their signature.</Verdict>
              ) : (
                <Verdict bad>
                  The car {when === "past" ? "ran" : "has been out"} on this period on an agreement the customer
                  has never signed.
                </Verdict>
              )
            ) : when === "future" ? (
              <Verdict>Nothing sent yet — this period starts {fmtDate(seg.from)}.</Verdict>
            ) : (
              <Verdict bad>No agreement was ever sent for this period. There is nothing signed behind it.</Verdict>
            )}
          </Section>
        </div>
      </div>

      {/* Full width, because it is the one thing that crosses all four
          sections: the order the paperwork actually happened in. */}
      <Section title="Paperwork trail">
        <ol className="space-y-3">
          {stepsFor(seg, ordinal).map((s) => (
            <li key={s.label} className="flex items-baseline gap-3">
              <span
                className={cn(
                  "size-1.5 shrink-0 -translate-y-px rounded-full",
                  s.done ? "bg-success" : "bg-foreground/20"
                )}
              />
              <span className={cn("min-w-0 flex-1 text-[13px]", !s.done && "text-muted-foreground")}>{s.label}</span>
              {s.at && <span className="shrink-0 text-[11px] text-muted-foreground">{s.at}</span>}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Auto-extension
   ══════════════════════════════════════════════════════════════════════════ */

type Period = "week" | "month";
type Charge = "upfront" | "after";

/**
 * A two-state setting shown as its current value; clicking flips it. Both
 * settings here are binary, so a segmented control would spend 90px showing
 * the option you did NOT pick — which is what kept auto-extension from fitting
 * on one line. The dotted underline is the only affordance, and the title
 * names the other state.
 */
function Flip({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="cursor-pointer text-primary underline decoration-primary/40 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-primary"
    >
      {label}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function ExtensionsTab() {
  const [segments, setSegments] = useState<Segment[]>(SEED);

  /**
   * Which card is open in the dialog, and whether the dialog is open — two
   * states on purpose. Clearing the id on close would blank the facts while
   * the dialog is still fading out.
   */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [autoOn, setAutoOn] = useState(false);
  const [period, setPeriod] = useState<Period>("week");
  const [charge, setCharge] = useState<Charge>("upfront");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [coverToo, setCoverToo] = useState(true);
  const [note, setNote] = useState("");

  /**
   * Sorted by start date, not by insertion — an operator can back-date an
   * extension to close a gap, and it has to land in the right place in the
   * stack rather than at the end of the list.
   */
  const ordered = useMemo(() => {
    const sorted = [...segments].sort((a, b) => at(a.from) - at(b.from) || at(a.to) - at(b.to));
    let n = 0;
    return sorted.map((seg, i) => {
      // Numbered by position, not by insertion order — an extension back-dated
      // to close a gap is extension 3, not extension 8.
      if (seg.kind === "extension") n += 1;
      return {
        seg,
        ordinal: seg.kind === "extension" ? n : 0,
        brk: i > 0 ? breakBetween(sorted[i - 1], seg) : null,
      };
    });
  }, [segments]);

  const overview = useMemo(() => {
    const all = ordered.map((r) => r.seg);
    const startsOn = all[0].from;
    const endsOn = all.reduce((latest, s) => (at(s.to) > at(latest) ? s.to : latest), all[0].to);

    let billedDays = 0;
    let charged = 0;
    let paid = 0;
    let overdue = 0;
    for (const s of all) {
      const p = priceOf(s);
      billedDays += p.days;
      charged += p.total;
      paid += paidOf(s);
      // Money owed on a period the car is already out on. The rest is simply
      // not invoiced yet, which is not the same thing at all.
      if (whenOf(s) !== "future") overdue += p.total - paidOf(s);
    }
    // The fine was raised on 29 Aug and is still unpaid, so it is owed now.
    charged += OFF_PERIOD.charged;
    paid += OFF_PERIOD.paid;
    overdue += OFF_PERIOD.charged - OFF_PERIOD.paid;

    const spanDays = Math.max(1, daysBetween(startsOn, endsOn));

    return {
      startsOn,
      endsOn,
      spanDays,
      dayIn: Math.min(spanDays, Math.max(1, daysBetween(startsOn, TODAY) + 1)),
      billedDays,
      charged,
      outstanding: charged - paid,
      overdue,
      extensions: all.filter((s) => s.kind === "extension").length,
    };
  }, [ordered]);

  /** The next period auto-extension would create, if it is switched on. */
  const projected = useMemo(() => {
    const start = overview.endsOn;
    const end = period === "week" ? addDays(start, 7) : addMonths(start, 1);
    return { from: start, to: end, ...priceOf({ from: start, to: end, cover: "covered" }) };
  }, [overview.endsOn, period]);

  /**
   * The open period, plus the discontinuity on EITHER side of it.
   *
   * A gap or an overlap is a fact about the period, not an annotation on the
   * stack — the dialog is the only place a period is read in full, so it has
   * to carry both. `ordered` already knows the break with the period before;
   * the one after is the next row's.
   */
  const detail = useMemo(() => {
    const i = ordered.findIndex((r) => r.seg.id === detailId);
    if (i < 0) return null;
    return { ...ordered[i], after: i < ordered.length - 1 ? ordered[i + 1].brk : null };
  }, [ordered, detailId]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  /* ── extend dialog ──────────────────────────────────────────────────── */

  const openExtend = () => {
    // Seeded in the handler, not an effect — an effect would paint one frame of
    // last time's dates before correcting itself.
    setFrom(overview.endsOn);
    setTo(addDays(overview.endsOn, 7));
    setCoverToo(true);
    setNote("");
    setDialogOpen(true);
  };

  const draft = useMemo(() => {
    if (!from || !to || at(to) <= at(from)) return null;
    const price = priceOf({ from, to, cover: coverToo ? "covered" : "none" });
    const shift = daysBetween(overview.endsOn, from);
    return { ...price, shift };
  }, [from, to, coverToo, overview.endsOn]);

  const confirmExtend = () => {
    if (!draft) return;
    setSegments((prev) => [
      ...prev,
      {
        id: `x-${Date.now()}`,
        kind: "extension",
        from,
        to,
        // A brand new extension is unpaid and unsigned. Saying otherwise would
        // be the one lie this whole tab exists to stop telling.
        pay: "unpaid",
        doc: "unsent",
        cover: coverToo ? "covered" : "none",
        bookedOn: TODAY,
        by: "You",
        note: note.trim() || undefined,
      },
    ]);
    setDialogOpen(false);
  };

  const nextOrdinal = overview.extensions + 1;

  const headline =
    overview.extensions === 0
      ? "Original rental"
      : `Original + ${overview.extensions} extension${overview.extensions === 1 ? "" : "s"}`;

  /* ── render ─────────────────────────────────────────────────────────── */

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── the whole rental, in three lines ─────────────────────────── */}
        <div className="px-1">
          <p className="text-[13px] font-medium">
            {headline} · {span(overview.startsOn, overview.endsOn)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Day {overview.dayIn} of {overview.spanDays} · {overview.billedDays} days billed
          </p>
          {/* "Outstanding" includes periods that have not run yet and are not
              owed; the figure worth reacting to is the money against days the
              car has already been out on. */}
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {money(overview.charged)} charged · {money(overview.outstanding)} outstanding
            {overview.overdue > 0 && (
              <>
                {" · "}
                <span className="font-medium text-destructive">{money(overview.overdue)} overdue</span>
              </>
            )}
          </p>
        </div>

        {/* ── the stack ────────────────────────────────────────────────── */}
        <div className="mt-3 space-y-1.5">
          {ordered.map(({ seg, ordinal, brk }) => (
            <Fragment key={seg.id}>
              {brk && (
                <p className="px-3.5 text-[11px] leading-snug text-destructive">
                  {dayCount(brk.days)} {brk.kind} · {span(brk.from, brk.to)}
                </p>
              )}
              <PeriodCard label={labelOf(seg.kind, ordinal)} seg={seg} onOpen={() => openDetail(seg.id)} />
            </Fragment>
          ))}

          {/* The next period auto-extension will create. No surface at all —
              it has not happened — and primary, because it is nobody's fault. */}
          {autoOn && (
            <div className="flex items-center gap-3 px-3.5 py-2.5 text-primary/80">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Next auto-renewal</span>
              <span className="shrink-0 text-[11px] tabular-nums">
                {span(projected.from, projected.to)} · {money(projected.total)}
              </span>
              <span className="size-1.5 shrink-0" />
            </div>
          )}
        </div>
      </div>

      {/* ── pinned: the two things an operator reaches for ───────────────
          Extend first, directly under the stack, because that is where the
          new card lands. Auto-extension last, as the one line of settings. */}
      <div className="shrink-0 pt-3">
        <Button className="w-full" onClick={openExtend}>
          Extend this rental
        </Button>

        <div className="mt-2 flex h-8 items-center gap-2 px-1">
          <label htmlFor="auto-extension" className="min-w-0 flex-1 cursor-pointer truncate text-[13px]">
            Auto-extension
          </label>
          {autoOn && (
            <span className="flex shrink-0 items-baseline gap-1 text-[11px] text-muted-foreground/60">
              <Flip
                label={period === "week" ? "weekly" : "monthly"}
                title={`Switch to ${period === "week" ? "monthly" : "weekly"}`}
                onClick={() => setPeriod(period === "week" ? "month" : "week")}
              />
              <span>·</span>
              <Flip
                label={charge === "upfront" ? "charged up front" : "charged after"}
                title={`Switch to ${charge === "upfront" ? "charged after" : "charged up front"}`}
                onClick={() => setCharge(charge === "upfront" ? "after" : "upfront")}
              />
            </span>
          )}
          <Switch id="auto-extension" size="sm" checked={autoOn} onCheckedChange={setAutoOn} />
        </div>
      </div>

      {/* ── one period, in full ────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        {/* Wider than the ui-v2 default of 448px on purpose: four sections of
            real facts in one 448px column is where the unreadable nine-row
            stack came from. 768px is two columns of ~340px, which is enough
            for "Insurance · 3 × $14.00" to sit on one line. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {detail && (
            <PeriodDetail
              seg={detail.seg}
              ordinal={detail.ordinal}
              before={detail.brk}
              after={detail.after}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── the extend dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {/* Tall enough to need a cap: dates, the discontinuity warning, cover,
            a note and the full preview. It scrolls rather than overflowing the
            viewport on a laptop. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Extend this rental</DialogTitle>
            <DialogDescription>
              This becomes extension {nextOrdinal}. It lands on the stack unpaid and unsigned — chase both from
              there.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="From" hint="Defaults to where the rental currently ends.">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
              </Field>
              <Field label="To">
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
              </Field>
            </div>

            {/* Moving the from-date off the current end is legitimate — it is how
                a missed week gets back-filled — but it must never be silent. */}
            {draft && draft.shift !== 0 && (
              <p className="flex items-start gap-2 rounded-3xl bg-destructive-light/60 px-4 py-3 text-xs leading-relaxed text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {draft.shift > 0
                    ? `This leaves ${draft.shift === 1 ? "a day" : `${draft.shift} days`} between ${fmtDate(overview.endsOn)} and ${fmtDate(from)} with nothing covering the car.`
                    : `This overlaps the period already running by ${draft.shift === -1 ? "a day" : `${-draft.shift} days`} — those days get billed twice.`}
                </span>
              </p>
            )}

            <div className="flex items-center gap-3 rounded-3xl bg-muted/40 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Extend the insurance too</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {coverToo
                    ? `A new policy is quoted for the added days at ${money(COVER_RATE)} a day.`
                    : "The car will be out on these days with no policy on it."}
                </p>
              </div>
              <Switch checked={coverToo} onCheckedChange={setCoverToo} aria-label="Extend the insurance" />
            </div>

            <Field label="Note" hint="Only staff see this. It sits on the extension, not on the rental.">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this extension was agreed…"
                className={textareaCls}
              />
            </Field>

            {/* What it will do, before it does it. */}
            {draft ? (
              <div className="rounded-3xl bg-muted/40 p-5">
                <p className="font-heading text-sm font-medium">
                  {fmtDate(from)} → {fmtDate(to)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dayCount(draft.days)} · the rental will end {fmtDate(to)}
                </p>

                <dl className="mt-4 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      Rental · {draft.days} × {money(DAY_RATE)}
                    </dt>
                    <dd className="tabular-nums">{money(draft.rental)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Insurance</dt>
                    <dd className="tabular-nums">{coverToo ? money(draft.insurance) : "Not extended"}</dd>
                  </div>
                  <div className="flex justify-between gap-3 pt-1.5 text-sm font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular-nums">{money(draft.total)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <EmptyHint>Pick an end date after {fmtDate(from)} to see what this will cost.</EmptyHint>
            )}
          </div>

          <DialogFooter>
            <ActionButton variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </ActionButton>
            <ActionButton onClick={confirmExtend} disabled={!draft}>
              {draft ? `Extend to ${fmtDate(to)}` : "Extend"}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
