"use client";

/**
 * Extensions — the first tab of the right rail. REAL DATA.
 *
 * The design is the playground's `rental-create-fake/_extensions.tsx`, which
 * the user iterated on directly; the data is not. Every figure here comes from
 * a row, and anything that cannot be sourced says so instead of showing a
 * plausible number.
 *
 * ── What the prototype invented, and what replaced it ───────────────────────
 *
 * The sandbox priced every period itself from a `DAY_RATE` constant — $110 a
 * day, $14 a day of cover — because it had no rows to read. On a real rental
 * that arithmetic is a lie: the operator may have overridden the price, applied
 * a promo, or extended across a weekend surcharge. So NOTHING is computed from
 * a rate here. Money comes from `rental_extension_totals`, which is not even
 * the `rental_extensions` table but a view that recomputes each period's total
 * from the LEDGER (`ledger_entries` summed per `extension_id`) — the same
 * source the Payments stage reads, so the two surfaces cannot disagree.
 *
 * The sandbox's 8% tax line is gone with it. `tax_amount` is a real column and
 * it is shown when it carries a figure; it is never derived from a percentage.
 *
 * ── The one period with no row ──────────────────────────────────────────────
 *
 * `rental_extensions` holds EXTENSIONS. The original rental has no row there,
 * so its money genuinely is not available on this tab — it lives in the
 * rental's own charges. The original card is therefore real about its dates
 * (they come from `rentals.start_date` and the first extension's
 * `previous_end_date`) and honest about its money: the dialog says where that
 * money lives rather than inventing a total for it.
 *
 * ── Not crying wolf ─────────────────────────────────────────────────────────
 *
 * The prototype dotted a card red for an unsent agreement or a missing policy.
 * Against real tenants that is a false alarm: northwind sells no Bonzah cover
 * and has no BoldSign envelopes, so every card would light up for states that
 * are simply not part of how the tenant works. So the rules here are:
 *
 *   a MISSING agreement or policy row  → muted. Nothing was promised.
 *   a policy that EXISTS and stops
 *     before its period does           → a fault. Something was promised and
 *                                        it does not cover the car.
 *   money owed on days already run     → a fault.
 *
 * A period that has not started yet is never a fault — an unpaid future period
 * is simply not collected yet. That is the design's rule and it survives
 * contact with real rows unchanged.
 */

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
// The two extend dialogs are v1's and are reused as they stand. They are the
// only working route to `create-extension-checkout`, which is what actually
// inserts the `rental_extensions` row (RLS blocks a client insert) and rolls
// the dates back if it fails. A v2 copy would be a second call-site for that
// edge function that has to be kept in step with the first.
import { AdminExtendRentalDialog } from "@/components/rentals/AdminExtendRentalDialog";
import { ExtensionRequestDialog } from "@/components/rentals/ExtensionRequestDialog";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { fmtDate, money } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Dates
   ══════════════════════════════════════════════════════════════════════════ */

/** Local midnight, never UTC — see `fmtDate` in `_kit`. */
const at = (d: string) => new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime();

const daysBetween = (from: string, to: string) => Math.round((at(to) - at(from)) / 86_400_000);

const dayCount = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Cents, for the dialog. The rail's `money` rounds to the dollar. */
const exact = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * "Sat, Sep 5, 2026". The weekday is not decoration on a rental: half of what
 * an operator checks when reading a period is whether it runs over a weekend,
 * and "Sep 10" alone never answers that.
 */
const fmtDay = (d: string) =>
  new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** A span the way a person says it: "5 – 10 Aug", "31 Aug – 5 Sep". */
const span = (from: string, to: string | null) => {
  if (!to) return `${fmtDate(from)} → open`;
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`);
  const b = new Date(`${String(to).slice(0, 10)}T00:00:00`);
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  if (a.getFullYear() !== b.getFullYear()) {
    return `${a.getDate()} ${mon(a)} ${a.getFullYear()} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  }
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
  return `${a.getDate()} – ${b.getDate()} ${mon(a)}`;
};

/** Today as a plain calendar day, so every comparison is date-to-date. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

type When = "past" | "current" | "future";

/** What the period's money looks like. Null on the original — see the header. */
type Money = {
  rental: number;
  insurance: number;
  tax: number;
  serviceFee: number;
  total: number;
  paid: number;
  outstanding: number;
  /** The view's `display_status`, verbatim. */
  status: string | null;
  paidAt: string | null;
};

/** A real Bonzah policy, when one was bought for this period. */
type Policy = {
  no: string | null;
  status: string | null;
  premium: number | null;
  from: string | null;
  to: string | null;
};

/** A real BoldSign envelope, when one was raised for this period. */
type Agreement = {
  status: string | null;
  sentAt: string | null;
  completedAt: string | null;
  signed: boolean;
};

type Period = {
  id: string;
  kind: "original" | "extension";
  /** `sequence_number` for an extension, 0 for the original. */
  ordinal: number;
  from: string;
  to: string | null;
  money: Money | null;
  policy: Policy | null;
  agreement: Agreement | null;
  /** When the period was booked, where a row records it. */
  bookedAt: string | null;
  /** The extension's own lifecycle status, when it has one. */
  rawStatus: string | null;
};

type Break = { kind: "gap" | "overlap"; days: number; from: string; to: string };

const whenOf = (p: Period, today: string): When => {
  if (p.to && p.to < today) return "past";
  return p.from <= today ? "current" : "future";
};

/**
 * The discontinuity between two consecutive periods, if there is one.
 *
 * Worth its own line between the cards rather than being quietly closed up: a
 * gap is a day the car was out with nothing covering it, and an overlap is a
 * day billed twice. Both are ordinary operator slips — an extension typed a day
 * late, a from-date left on the wrong day — and both are invisible in every
 * list-of-extensions view, which is why they survive for months.
 */
const breakBetween = (prev: Period, next: Period): Break | null => {
  if (!prev.to) return null;
  const d = daysBetween(prev.to, next.from);
  if (d > 0) return { kind: "gap", days: d, from: prev.to, to: next.from };
  if (d < 0) return { kind: "overlap", days: -d, from: next.from, to: prev.to };
  return null;
};

/**
 * Does this period need someone NOW?
 *
 * Only two things qualify, and both are things a row positively asserts:
 * money owed against days the car has already been out on, and a policy that
 * was bought but stops before the period does. A period with no policy row and
 * no agreement row is not a fault — see the header comment.
 */
const needsAttention = (p: Period, today: string): boolean => {
  if (whenOf(p, today) === "future") return false;
  if (p.money && p.money.outstanding > 0) return true;
  if (p.policy?.to && p.to && p.policy.to < p.to) return true;
  return false;
};

const labelOf = (p: Period) => (p.kind === "original" ? "Original rental" : `Extension ${p.ordinal}`);

/* ══════════════════════════════════════════════════════════════════════════
   Reading the rows
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The policies and agreements that hang off this rental's periods.
 *
 * Two small reads rather than a join, because they attach differently:
 * a policy carries `extension_id` (and a null one belongs to the original),
 * while an agreement carries no extension id at all — it is matched by the
 * PERIOD IT WAS RAISED FOR (`period_start_date` / `period_end_date`), which is
 * how `rental_agreements` models an extension envelope.
 */
function usePeriodPaperwork(rentalId: string | null, tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["rental-period-paperwork-v2", rentalId, tenantId],
    queryFn: async () => {
      const [policies, agreements] = await Promise.all([
        supabase
          .from("bonzah_insurance_policies")
          .select("id, extension_id, policy_no, status, premium_amount, trip_start_date, trip_end_date")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
        supabase
          .from("rental_agreements")
          .select("id, agreement_type, document_status, envelope_sent_at, envelope_completed_at, signed_document_id, period_start_date, period_end_date")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenantId!),
      ]);

      if (policies.error) throw policies.error;
      if (agreements.error) throw agreements.error;

      return {
        policies: (policies.data ?? []) as Record<string, any>[],
        agreements: (agreements.data ?? []) as Record<string, any>[],
      };
    },
    enabled: !!rentalId && !!tenantId,
  });
}

/**
 * The rental as a stack of periods, oldest first.
 *
 * The original's END is the first extension's `previous_end_date` — the date
 * the rental ran to before anybody extended it. That is more trustworthy than
 * `rentals.original_end_date`, which is only written on some paths, so the
 * column is used as a fallback rather than as the source.
 */
function buildPeriods(
  rental: Record<string, any>,
  totals: Record<string, any>[],
  policies: Record<string, any>[],
  agreements: Record<string, any>[]
): Period[] {
  // Sorted by the date the period starts, not by insertion: an operator can
  // back-date an extension to close a gap, and it has to land in the right
  // place in the stack rather than at the end of the list.
  const exts = [...totals]
    .filter((t) => !!t.id)
    .sort(
      (a, b) =>
        at(a.previous_end_date ?? a.created_at ?? rental.start_date) -
          at(b.previous_end_date ?? b.created_at ?? rental.start_date) ||
        num(a.sequence_number) - num(b.sequence_number)
    );

  const policyFor = (extensionId: string | null) =>
    policies.find((p) => (extensionId ? p.extension_id === extensionId : !p.extension_id)) ?? null;

  const agreementFor = (from: string, to: string | null) =>
    agreements.find(
      (a) =>
        (to && a.period_end_date && String(a.period_end_date).slice(0, 10) === String(to).slice(0, 10)) ||
        (a.period_start_date && String(a.period_start_date).slice(0, 10) === String(from).slice(0, 10))
    ) ?? null;

  const toPolicy = (row: Record<string, any> | null): Policy | null =>
    row
      ? {
          no: row.policy_no ?? null,
          status: row.status ?? null,
          premium: row.premium_amount === null || row.premium_amount === undefined ? null : num(row.premium_amount),
          from: row.trip_start_date ?? null,
          to: row.trip_end_date ?? null,
        }
      : null;

  const toAgreement = (row: Record<string, any> | null): Agreement | null =>
    row
      ? {
          status: row.document_status ?? null,
          sentAt: row.envelope_sent_at ?? null,
          completedAt: row.envelope_completed_at ?? null,
          signed: !!row.signed_document_id || row.document_status === "completed" || row.document_status === "signed",
        }
      : null;

  const originalEnd: string | null =
    (exts[0]?.previous_end_date as string | null) ??
    (rental.original_end_date as string | null) ??
    (rental.end_date as string | null) ??
    null;

  const original: Period = {
    id: "original",
    kind: "original",
    ordinal: 0,
    from: String(rental.start_date).slice(0, 10),
    to: originalEnd ? String(originalEnd).slice(0, 10) : null,
    // The original rental has no `rental_extensions` row, so its money is
    // genuinely not on this tab. Null, never a guess.
    money: null,
    policy: toPolicy(policyFor(null)),
    agreement: toAgreement(agreementFor(String(rental.start_date).slice(0, 10), originalEnd)),
    bookedAt: rental.created_at ?? null,
    rawStatus: null,
  };

  const rest: Period[] = exts.map((t) => {
    const from = String(t.previous_end_date ?? original.to ?? rental.start_date).slice(0, 10);
    const to = t.new_end_date ? String(t.new_end_date).slice(0, 10) : null;
    return {
      id: String(t.id),
      kind: "extension" as const,
      ordinal: num(t.sequence_number),
      from,
      to,
      money: {
        rental: num(t.rental_amount),
        insurance: num(t.insurance_amount),
        tax: num(t.tax_amount),
        serviceFee: num(t.service_fee_amount),
        total: num(t.total_amount),
        paid: num(t.paid_amount),
        outstanding: num(t.outstanding_amount),
        status: t.display_status ?? null,
        paidAt: t.paid_at ?? null,
      },
      policy: toPolicy(policyFor(String(t.id))),
      agreement: toAgreement(agreementFor(from, to)),
      bookedAt: t.requested_at ?? t.created_at ?? null,
      rawStatus: t.status ?? null,
    };
  });

  return [original, ...rest];
}

/* ══════════════════════════════════════════════════════════════════════════
   One card
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The whole card: which period, when, and — only if it needs someone now — a
 * dot. The running period gets a faint primary fill and nothing louder.
 *
 * This is the design the user landed on after several rounds, and the thing it
 * is protecting is scannability: with seven cards on screen you see the two
 * that need you. Anything else on a card competes with that dot.
 */
function PeriodCard({
  period,
  today,
  onOpen,
}: {
  period: Period;
  today: string;
  onOpen: () => void;
}) {
  const current = whenOf(period, today) === "current";
  const future = whenOf(period, today) === "future";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-3xl px-3.5 py-2.5 text-left transition-colors",
        current ? "bg-primary/5 hover:bg-primary/10" : "bg-muted/40 hover:bg-muted/70"
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", future && "text-muted-foreground")}>
        {labelOf(period)}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{span(period.from, period.to)}</span>
      {/* Always in the layout so the dates line up down the stack; painted
          only when the period needs someone now. */}
      <span
        className={cn("size-1.5 shrink-0 rounded-full", needsAttention(period, today) && "bg-destructive")}
      />
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One period, in full — the dialog
   ══════════════════════════════════════════════════════════════════════════ */

type Tone = "plain" | "muted" | "bad" | "strong";

const TONE: Record<Tone, string> = {
  plain: "",
  muted: "text-muted-foreground",
  bad: "font-medium text-destructive",
  strong: "font-medium",
};

/**
 * A titled group of facts. No ring, no fill, no rule — the gap above the title
 * is what makes it a section, and 10px uppercase tracking-widest is the same
 * title the rail groups wear, so the two read as one system.
 */
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</p>
      {children}
    </section>
  );
}

/** One fact: label left, value right, with real space between them. */
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

const brkLine = (b: Break, side: "before" | "after") =>
  b.kind === "gap"
    ? `${dayCount(b.days)} gap ${side} this period — nothing at all covers ${span(b.from, b.to)}.`
    : `Overlaps the period ${side === "before" ? "before" : "after"} it by ${dayCount(b.days)} — ${span(b.from, b.to)} is billed twice.`;

/** Everything the card does not say. */
function PeriodDetail({
  period,
  before,
  after,
  today,
}: {
  period: Period;
  before: Break | null;
  after: Break | null;
  today: string;
}) {
  const when = whenOf(period, today);
  const { money: m, policy, agreement } = period;

  const days = period.to ? Math.max(0, daysBetween(period.from, period.to)) : null;
  const starts = when === "future" ? "starts" : "started";

  const standing = (() => {
    if (!period.to) return "Open-ended — no end date on this period";
    if (when === "current") {
      const dayIn = Math.min(days ?? 1, Math.max(1, daysBetween(period.from, today) + 1));
      return `Running now — day ${dayIn} of ${days}`;
    }
    if (when === "past") {
      const since = daysBetween(period.to, today);
      return since === 0 ? "Finished today" : `Finished ${dayCount(since)} ago`;
    }
    const until = daysBetween(today, period.from);
    return until === 0 ? "Starts today" : `Starts in ${dayCount(until)}`;
  })();

  // How late the paperwork was against the car. An extension booked on the day
  // it started — after the customer had already had the car over a weekend —
  // is the single most useful fact about it.
  const bookedDay = period.bookedAt ? String(period.bookedAt).slice(0, 10) : null;
  const lead = bookedDay ? daysBetween(bookedDay, period.from) : null;
  const leadText =
    lead === null
      ? undefined
      : lead > 0
        ? `${dayCount(lead)} before it ${starts}`
        : lead === 0
          ? `On the day it ${starts}`
          : `${dayCount(-lead)} after it ${starts}`;

  // Money against days the car has already been out on is a fault. Money on a
  // period that has not run is simply not collected yet, and reads muted.
  const owed = !!m && m.outstanding > 0 && when !== "future";

  // A policy that stops before the period does. Only computable when both the
  // policy and the period carry an end date.
  const coverShort = !!(policy?.to && period.to && policy.to < period.to);
  const uncovered = coverShort ? daysBetween(policy!.to!, period.to!) : 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{labelOf(period)}</DialogTitle>
        <DialogDescription>{standing}</DialogDescription>
      </DialogHeader>

      {/* Two columns of real content. Period and Insurance answer "what
          happened to the car"; Payment and Agreement answer "what happened on
          paper" — so each column is one question, top to bottom. Below `sm:`
          they stack in the same order. */}
      <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
        <div className="space-y-9">
          <DetailSection title="Period">
            <dl className="space-y-3">
              <Row label="Starts">{fmtDay(period.from)}</Row>
              <Row label="Ends" tone={period.to ? "plain" : "muted"}>
                {period.to ? fmtDay(period.to) : "No end date"}
              </Row>
              {days !== null && (
                <Row label="Length" nums>
                  {dayCount(days)}
                </Row>
              )}
              {bookedDay && (
                <Row label="Booked" sub={leadText}>
                  {fmtDate(bookedDay)}
                </Row>
              )}
            </dl>

            {before && <Verdict bad>{brkLine(before, "before")}</Verdict>}
            {after && <Verdict bad>{brkLine(after, "after")}</Verdict>}
          </DetailSection>

          <DetailSection title="Insurance">
            {policy ? (
              <>
                <dl className="space-y-3">
                  <Row label="Premium" nums tone={policy.premium === null ? "muted" : "plain"}>
                    {policy.premium === null ? "Not recorded" : exact(policy.premium)}
                  </Row>
                  {policy.no && <Row label="Policy">{policy.no}</Row>}
                  {policy.status && <Row label="State">{policy.status}</Row>}
                  {(policy.from || policy.to) && (
                    <Row label="Policy runs" tone={coverShort ? "bad" : "plain"}>
                      {policy.from ? fmtDate(policy.from) : "—"} → {policy.to ? fmtDate(policy.to) : "—"}
                    </Row>
                  )}
                </dl>

                {coverShort ? (
                  <Verdict bad>
                    The policy stops {fmtDate(policy.to!)} but the period runs to {fmtDate(period.to!)} — the last{" "}
                    {dayCount(uncovered)} {when === "past" ? "had" : "have"} the car out with no cover on it.
                  </Verdict>
                ) : (
                  <Verdict>Covered for every day of this period.</Verdict>
                )}
              </>
            ) : (
              // A missing policy is not a fault — this tenant may not sell
              // cover at all. It is stated, not accused.
              <Verdict>No insurance policy is recorded against this period.</Verdict>
            )}
          </DetailSection>
        </div>

        <div className="space-y-9">
          <DetailSection title="Payment">
            {m ? (
              <>
                {/* The charge broken into its lines, not one total: an operator
                    arguing an invoice needs to see where each part came from.
                    Every line is a stored column — nothing is derived from a
                    rate or a percentage. */}
                <dl className="space-y-3">
                  <Row label="Rental" nums>
                    {exact(m.rental)}
                  </Row>
                  {m.insurance > 0 && (
                    <Row label="Insurance" nums>
                      {exact(m.insurance)}
                    </Row>
                  )}
                  {m.serviceFee > 0 && (
                    <Row label="Service fee" nums>
                      {exact(m.serviceFee)}
                    </Row>
                  )}
                  {m.tax > 0 && (
                    <Row label="Tax" nums>
                      {exact(m.tax)}
                    </Row>
                  )}
                </dl>

                <dl className="space-y-3 pt-2">
                  <Row label="Charged" tone="strong" nums>
                    {exact(m.total)}
                  </Row>
                  <Row label="Received" nums>
                    {exact(m.paid)}
                  </Row>
                  <Row label="Outstanding" tone={owed ? "bad" : m.outstanding > 0 ? "muted" : "plain"} nums>
                    {exact(m.outstanding)}
                  </Row>
                </dl>

                {m.outstanding <= 0 && m.total > 0 ? (
                  <Verdict>
                    {m.paidAt ? `Settled in full on ${fmtDate(m.paidAt)}.` : "Settled in full."}
                  </Verdict>
                ) : m.paid > 0 ? (
                  <Verdict bad={owed}>
                    {exact(m.paid)} arrived against {exact(m.total)}.{" "}
                    {owed
                      ? `${exact(m.outstanding)} is still owed on days the car ${when === "past" ? "has already been out on" : "is out on right now"}.`
                      : `${exact(m.outstanding)} is still to collect before this period starts.`}
                  </Verdict>
                ) : when === "future" ? (
                  <Verdict>Nothing collected yet. This period starts {fmtDate(period.from)}.</Verdict>
                ) : m.total > 0 ? (
                  <Verdict bad>
                    Nothing has been received against this period, and the car{" "}
                    {when === "past" ? "already ran" : "has been out"} on it since {fmtDate(period.from)}.
                  </Verdict>
                ) : (
                  <Verdict>Nothing has been charged against this period yet.</Verdict>
                )}
              </>
            ) : (
              // The original rental has no `rental_extensions` row, so there is
              // no per-period money to read. Say where it lives instead.
              <Verdict>
                The original period&rsquo;s money sits with the rental&rsquo;s own charges rather than on an
                extension, so it is not broken out here — the Payments stage carries it in full.
              </Verdict>
            )}
          </DetailSection>

          <DetailSection title="Agreement">
            {agreement ? (
              <>
                <dl className="space-y-3">
                  <Row label="State" tone={agreement.signed ? "plain" : when === "future" ? "muted" : "bad"}>
                    {agreement.signed
                      ? "Signed"
                      : agreement.sentAt
                        ? "Out for signature"
                        : (agreement.status ?? "Not sent")}
                  </Row>
                  {agreement.sentAt && <Row label="Sent">{fmtDate(agreement.sentAt)}</Row>}
                  {agreement.completedAt && <Row label="Signed">{fmtDate(agreement.completedAt)}</Row>}
                </dl>

                {agreement.signed ? null : when === "future" ? (
                  <Verdict>With the customer, waiting on their signature.</Verdict>
                ) : (
                  <Verdict bad>
                    The car {when === "past" ? "ran" : "has been out"} on this period on an agreement the
                    customer has never signed.
                  </Verdict>
                )}
              </>
            ) : (
              // No envelope row at all. Same reasoning as insurance: stated,
              // not accused — plenty of tenants never send one.
              <Verdict>No signing envelope was raised for this period.</Verdict>
            )}
          </DetailSection>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function RailExtensions({
  detail,
  refetch,
}: {
  detail: RentalDetailV2;
  refetch: () => void;
}) {
  const { tenant } = useTenant();
  const rental = detail.rental;
  const today = useMemo(() => todayIso(), []);

  const { data: totals = [], isLoading: totalsLoading } = useRentalExtensionTotals(rental.id);
  const { data: paperwork } = usePeriodPaperwork(rental.id, tenant?.id);

  /**
   * Which card is open, and whether the dialog is open — two states on
   * purpose. Clearing the id on close would blank the facts while the dialog
   * is still fading out.
   */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [extendOpen, setExtendOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const periods = useMemo(
    () =>
      buildPeriods(
        rental,
        totals as Record<string, any>[],
        paperwork?.policies ?? [],
        paperwork?.agreements ?? []
      ),
    [rental, totals, paperwork]
  );

  const rows = useMemo(
    () =>
      periods.map((period, i) => ({
        period,
        brk: i > 0 ? breakBetween(periods[i - 1], period) : null,
      })),
    [periods]
  );

  /**
   * The whole rental in a line or two — but only from figures that exist.
   *
   * The money line covers EXTENSIONS ONLY and says so, because the original
   * period's charges are not on this tab. A combined total would look
   * authoritative and be wrong by the whole base rental.
   */
  const overview = useMemo(() => {
    const extensions = periods.filter((p) => p.kind === "extension");
    const endsOn = periods.reduce<string | null>(
      (latest, p) => (p.to && (!latest || at(p.to) > at(latest)) ? p.to : latest),
      null
    );

    let charged = 0;
    let outstanding = 0;
    let overdue = 0;
    for (const p of extensions) {
      if (!p.money) continue;
      // A cancelled or refunded period is not money anyone is chasing.
      if (p.money.status === "cancelled" || p.money.status === "refunded") continue;
      charged += p.money.total;
      outstanding += p.money.outstanding;
      if (whenOf(p, today) !== "future") overdue += p.money.outstanding;
    }

    return {
      count: extensions.length,
      startsOn: periods[0]?.from ?? null,
      endsOn,
      charged,
      outstanding,
      overdue,
      hasMoney: extensions.some((p) => !!p.money && p.money.total > 0),
    };
  }, [periods, today]);

  const open = useMemo(() => {
    const i = rows.findIndex((r) => r.period.id === detailId);
    if (i < 0) return null;
    return { ...rows[i], after: i < rows.length - 1 ? rows[i + 1].brk : null };
  }, [rows, detailId]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  /* ── the two ways a rental gets extended ────────────────────────────── */

  const isPayg = !!rental.is_pay_as_you_go;
  /**
   * A customer has ASKED to extend, and nobody has answered yet.
   *
   * `previous_end_date` is the column that says so — but it is dual-purpose,
   * and that is the trap. While a request is pending it holds the date the
   * customer asked FOR; once anything is approved it holds HISTORY, the date
   * the rental ran to before. v1's gate
   * (`rentals/[id]/page.tsx:5803`) is `is_extended && previous_end_date`,
   * which cannot tell those apart — and a real seeded rental here has
   * `is_extended = true` with `previous_end_date` = 11 Sep against an
   * `end_date` of 13 Sep, so v1's gate would offer "Review extension request"
   * for a request that was approved days ago.
   *
   * The third condition is what separates them, and it comes straight out of
   * how `ExtensionRequestDialog` approves: it swaps `end_date` and
   * `previous_end_date`. So a request that is genuinely still open always asks
   * for a date LATER than where the rental currently ends; a `previous_end_date`
   * at or before `end_date` is history, every time.
   */
  const pendingRequest =
    !!rental.is_extended &&
    !!rental.previous_end_date &&
    !!rental.end_date &&
    String(rental.previous_end_date).slice(0, 10) > String(rental.end_date).slice(0, 10) &&
    !isPayg;

  /** The shape both v1 dialogs want. Every field is off the real row. */
  const dialogRental = useMemo(
    () => ({
      id: rental.id,
      start_date: rental.start_date,
      end_date: rental.end_date ?? "",
      previous_end_date: rental.previous_end_date ?? null,
      original_end_date: rental.original_end_date ?? null,
      has_installment_plan: !!rental.has_installment_plan,
      bonzah_policy_id: rental.bonzah_policy_id ?? null,
      rental_period_type: rental.rental_period_type,
      customer_id: rental.customer_id ?? undefined,
      vehicle_id: rental.vehicle_id ?? undefined,
      customers: detail.customer
        ? { id: detail.customer.id, name: detail.customer.name, email: detail.customer.email ?? undefined }
        : undefined,
      vehicles: detail.vehicle
        ? {
            id: detail.vehicle.id,
            reg: detail.vehicle.reg,
            make: detail.vehicle.make ?? "",
            model: detail.vehicle.model ?? "",
          }
        : undefined,
    }),
    [rental, detail.customer, detail.vehicle]
  );

  /* ── render ─────────────────────────────────────────────────────────── */

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── the whole rental, in two or three lines ──────────────────── */}
        <div className="px-1">
          <p className="text-[13px] font-medium">
            {overview.count === 0
              ? "Original rental"
              : `Original + ${overview.count} extension${overview.count === 1 ? "" : "s"}`}
            {overview.startsOn && <> · {span(overview.startsOn, overview.endsOn)}</>}
          </p>
          {overview.hasMoney && (
            <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {money(overview.charged)} charged on extensions · {money(overview.outstanding)} outstanding
              {overview.overdue > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-destructive">{money(overview.overdue)} overdue</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* ── the stack ────────────────────────────────────────────────── */}
        <div className="mt-3 space-y-1.5">
          {rows.map(({ period, brk }) => (
            <Fragment key={period.id}>
              {brk && (
                <p className="px-3.5 text-[11px] leading-snug text-destructive">
                  {dayCount(brk.days)} {brk.kind} · {span(brk.from, brk.to)}
                </p>
              )}
              <PeriodCard period={period} today={today} onOpen={() => openDetail(period.id)} />
            </Fragment>
          ))}
        </div>

        {totalsLoading && overview.count === 0 && (
          <p className="px-1 pt-3 text-[11px] text-muted-foreground">Reading extensions…</p>
        )}

        {!totalsLoading && overview.count === 0 && (
          <p className="px-1 pt-3 text-[11px] leading-relaxed text-muted-foreground">
            This rental has never been extended. Its one period is the original booking.
          </p>
        )}
      </div>

      {/* ── pinned: the two things an operator reaches for ───────────────
          Extend first, directly under the stack, because that is where the new
          card lands. Auto-extension last, as the one line of settings. The
          user was explicit that neither may ever scroll out of view. */}
      <div className="shrink-0 pt-3">
        {pendingRequest ? (
          <Button className="w-full" onClick={() => setRequestOpen(true)}>
            Review extension request
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={() => setExtendOpen(true)}
            disabled={isPayg}
            title={
              isPayg
                ? "A pay-as-you-go rental is not extended — it accrues each day until it is closed."
                : undefined
            }
          >
            Extend this rental
          </Button>
        )}

        <AutoExtensionRow rental={rental} refetch={refetch} />
      </div>

      {/* ── one period, in full ────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        {/* Wider than the ui-v2 default of 448px on purpose: four sections of
            real facts in one 448px column is where the unreadable nine-row
            stack came from. 768px is two columns of ~340px. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {open && (
            <PeriodDetail
              period={open.period}
              before={open.brk}
              after={open.after}
              today={today}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* v1's dialogs, mounted as they stand. Both refetch the rental on close
          so the stack redraws with the period that was just added. */}
      {!isPayg && (
        <AdminExtendRentalDialog
          open={extendOpen}
          onOpenChange={(o) => {
            setExtendOpen(o);
            if (!o) refetch();
          }}
          rental={dialogRental}
        />
      )}
      {pendingRequest && (
        <ExtensionRequestDialog
          open={requestOpen}
          onOpenChange={(o) => {
            setRequestOpen(o);
            if (!o) refetch();
          }}
          rental={dialogRental}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Auto-extension — one row
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The rental's auto-renewal, in a single line.
 *
 * ── Why the switch means PAUSE and not ENABLE ───────────────────────────────
 *
 * Arming auto-extension is not one column. `rental-create-v2.tsx:1832` sets
 * SEVEN together — `auto_extend_enabled`, `_charge_mode`, `_period_unit`,
 * `_lead_hours`, `_max_periods`, `_status`, and critically
 * `auto_extend_next_charge_at`, which is the timestamp a cron reads to decide
 * when to take a card payment. Nothing anywhere in the portal turns
 * auto-extension on for an EXISTING rental; v1's own `AutoExtensionSection`
 * returns null unless it is already on. A bare switch here would set one
 * boolean and leave a billing loop armed with no trigger date.
 *
 * So on a rental that is not on auto-extension the switch is disabled and says
 * why. On one that IS, the switch is the real pause/resume — the exact patch
 * `AutoExtensionSection` writes (`auto-extension-section.tsx:163`), which is a
 * safe, reversible, single-row write and the thing an operator actually needs
 * from this rail: stop the next renewal.
 *
 * The cadence and charge mode are shown as the row's own words, read from the
 * real columns. They are not editable here — changing `charge_mode` decides
 * whether the next renewal silently charges a card or emails a link, and that
 * belongs on the full section with its next-renewal banner, not in 328px.
 */
function AutoExtensionRow({
  rental,
  refetch,
}: {
  rental: Record<string, any>;
  refetch: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const enabled = !!rental.auto_extend_enabled;
  const paused = !!rental.auto_extend_paused || rental.auto_extend_status === "paused";

  const unit = String(rental.auto_extend_period_unit ?? "Weekly").toLowerCase();
  const every = Number(rental.auto_extend_interval_count ?? 1);
  const cadence =
    every > 1
      ? `every ${every} ${unit.replace(/ly$/, "")}s`
      : unit === "weekly"
        ? "weekly"
        : unit === "monthly"
          ? "monthly"
          : unit === "daily"
            ? "daily"
            : unit;
  const mode = rental.auto_extend_charge_mode === "auto_charge" ? "charged to the card" : "sent as a link";

  const toggle = async (next: boolean) => {
    if (!enabled || saving) return;
    setSaving(true);
    // Verbatim the patch `AutoExtensionSection` writes, so the two controls
    // cannot leave the rental in states the other does not understand.
    const patch = next
      ? { auto_extend_paused: false, auto_extend_paused_at: null, auto_extend_status: "active" }
      : {
          auto_extend_paused: true,
          auto_extend_paused_at: new Date().toISOString(),
          auto_extend_status: "paused",
        };
    await supabase
      .from("rentals")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", rental.id);
    setSaving(false);
    refetch();
  };

  return (
    <div className="mt-2 flex h-8 items-center gap-2 px-1">
      <label
        htmlFor="rail-auto-extension"
        className={cn("min-w-0 shrink-0 text-[13px]", enabled && "cursor-pointer")}
      >
        Auto-extension
      </label>
      <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground/60">
        {enabled ? `${cadence} · ${mode}` : "off"}
      </span>
      <Switch
        id="rail-auto-extension"
        size="sm"
        checked={enabled && !paused}
        disabled={!enabled || saving}
        onCheckedChange={toggle}
        title={
          enabled
            ? paused
              ? "Resume the renewals"
              : "Pause the renewals — nothing is charged until it is resumed"
            : "Auto-extension is set when the rental is created. Turning it on needs a first renewal date this rail cannot work out."
        }
        aria-label="Pause or resume auto-extension"
      />
    </div>
  );
}

export default RailExtensions;
