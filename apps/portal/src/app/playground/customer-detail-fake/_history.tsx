"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Playground · customer control centre — HISTORY
 *
 * The third band of the rail: what this person has actually done. None of it is
 * typed in — every panel here is produced from rentals, money that moved, or
 * something a member of staff wrote afterwards.
 *
 * Reviews is the second of the screen's two staleness cases, and the one that
 * needs no new column either: `customer_review_summaries` already stores the
 * review count and average the paragraph was written from, right beside the
 * paragraph.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import {
  Banknote,
  Car,
  CreditCard,
  ExternalLink,
  FileDown,
  Gavel,
  Link2,
  Plus,
  Receipt,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  ActionButton,
  EmptyHint,
  Field,
  OutOfDateBanner,
  Panel,
  Pill,
  Timeline,
  cardCls,
  fmtDate,
  money,
  textareaCls,
} from "@/app/playground/_shared";
import type { Drift } from "@/app/playground/_shared";
import { TODAY, REVIEW_TAGS } from "./_data";
import type { CustomerState, PanelProps } from "./_data";
import { ProducedFrom, Row, Section, Segmented, Stat, dayCount, listCls, signedMoney } from "./_bits";

/* ══════════════════════════════════════════════════════════════════════════
   Rentals
   ══════════════════════════════════════════════════════════════════════════ */

const RENTAL_TONE = { Active: "primary", Completed: "success", Cancelled: "neutral" } as const;

export function RentalsPanel({ c, onJump }: PanelProps) {
  const [view, setView] = useState<"booking" | "car">("booking");

  const settled = c.rentals.filter((r) => r.status !== "Cancelled");
  const lifetime = settled.reduce((s, r) => s + r.total, 0);
  const avgLength = settled.length
    ? settled.reduce((s, r) => s + dayCount(r.start, r.end), 0) / settled.length
    : 0;

  /** The same rows, asked a different question: not "what did they book?" but
   *  "which of my cars have they had, and how did that go?" */
  const byCar = settled.reduce<Record<string, { reg: string; times: number; days: number; spend: number }>>(
    (acc, r) => {
      const key = `${r.vehicle}`;
      const prev = acc[key] ?? { reg: r.reg, times: 0, days: 0, spend: 0 };
      acc[key] = {
        reg: r.reg,
        times: prev.times + 1,
        days: prev.days + dayCount(r.start, r.end),
        spend: prev.spend + r.total,
      };
      return acc;
    },
    {}
  );

  return (
    <Panel title="Rentals" description="Every booking this customer has held, and every car they have had out.">
      <ProducedFrom sources={[{ key: "identity", label: "Identity" }]} onJump={onJump} />

      {c.rentals.length === 0 ? (
        <EmptyHint>No rentals yet. This customer has an account but has never booked.</EmptyHint>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Rentals"
              value={String(c.rentals.length)}
              hint={`${settled.length} not cancelled`}
            />
            <Stat label="Lifetime spend" value={money(lifetime)} hint="Excludes cancellations" />
            <Stat label="Average length" value={`${avgLength.toFixed(1)} days`} hint="Across settled rentals" />
          </div>

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "booking", label: "By booking" },
              { value: "car", label: "By car" },
            ]}
          />

          {view === "booking" ? (
            <Section>
              <div className={listCls}>
                {c.rentals.map((r) => (
                  <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Car className="size-4 text-muted-foreground" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.vehicle} <span className="text-muted-foreground">· {r.reg}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.ref} · {fmtDate(r.start)} → {fmtDate(r.end)} · {dayCount(r.start, r.end)} days
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(r.total)}</p>
                      {r.status === "Cancelled" ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">—</p>
                      ) : r.outstanding > 0 ? (
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-primary">
                          {money(r.outstanding)} owed
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-success">Settled</p>
                      )}
                    </div>

                    <Pill tone={RENTAL_TONE[r.status]}>{r.status}</Pill>

                    <Button variant="outline" size="sm" className="shrink-0">
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <Section
              title="Cars they have had"
              description="Useful before handing over the same car again — or deliberately not."
            >
              <div className={listCls}>
                {Object.entries(byCar).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Car className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{v.reg}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {v.times}× · {v.days} days
                    </p>
                    <p className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {money(v.spend)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Money
   ══════════════════════════════════════════════════════════════════════════ */

const LINK_TONE = { Open: "primary", Paid: "success", Void: "neutral" } as const;

export function MoneyPanel({ c, patch, onJump }: PanelProps) {
  const totals = ledgerTotals(c);

  const running = (() => {
    let n = 0;
    return c.ledger.map((row) => {
      n += row.amount;
      return { ...row, balance: n };
    });
  })();

  const addRow = (label: string, amount: number, kind: CustomerState["ledger"][number]["kind"]) =>
    patch((p) => ({
      ...p,
      ledger: [
        ...p.ledger,
        {
          id: `L${Date.now()}`,
          date: TODAY,
          label,
          ref: null,
          kind,
          amount,
        },
      ],
    }));

  /** Applying the credit is what FIFO does automatically the moment a charge is
   *  old enough — doing it by hand is just choosing not to wait. */
  const applyCredit = () =>
    patch((p) => ({
      ...p,
      ledger: p.ledger.map((r) => (r.unallocated ? { ...r, unallocated: 0, ref: "Applied by hand" } : r)),
    }));

  return (
    <Panel
      title="Money"
      description="Everything charged, everything received, and what is left. The balance is computed from the rows — never typed in."
    >
      <ProducedFrom
        sources={[
          { key: "rentals", label: "Rentals" },
          { key: "fines", label: "Fines" },
        ]}
        onJump={onJump}
      />

      {c.ledger.length === 0 ? (
        <EmptyHint>No charges or payments on this account yet.</EmptyHint>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Charged" value={money(totals.charges)} hint="Rentals, tolls, fines, fees" />
            <Stat
              label="Received"
              value={money(totals.applied)}
              // Names the gap where someone would go looking for it: this tile
              // is what an operator reconciles against their bank, so the money
              // that never arrived has to be accounted for beside it.
              hint={
                totals.writtenOff > 0
                  ? `Matched to a charge · ${money(totals.writtenOff)} written off`
                  : "Matched to a charge"
              }
              tone="success"
            />
            <Stat
              label="Outstanding"
              value={money(totals.outstanding)}
              hint={totals.outstanding > 0 ? "Owed to you" : "Nothing owed"}
              tone={totals.outstanding > 0 ? "primary" : "success"}
            />
            <Stat
              label="Credit on account"
              value={money(totals.credit)}
              hint={totals.credit > 0 ? "Arrived, not yet applied" : "None held"}
              tone={totals.credit > 0 ? "warning" : undefined}
            />
          </div>

          {/*
           * The one sentence that makes the four tiles above legible. Credit is
           * NOT the same thing as a negative balance: money can sit on the
           * account, uncounted against anything, while a charge downstream still
           * reads as outstanding. Operators chase customers over exactly this.
           */}
          {totals.credit > 0 && (
            <div className="flex items-start gap-3 rounded-4xl bg-warning-light/50 px-6 py-5 ring-1 ring-warning/25">
              <Banknote className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {money(totals.credit)} arrived without a rental against it
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  It is applied oldest charge first the next time this account is settled — so this
                  customer reads as {money(totals.outstanding)} outstanding while already holding
                  enough to cover {totals.credit >= totals.outstanding ? "all of it" : "part of it"}.
                  Apply it now if you would rather they stopped seeing the balance.
                </p>
                <Button size="sm" className="mt-3" onClick={applyCredit}>
                  Apply {money(totals.credit)} to the oldest charge
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div
              className={cn(
                "rounded-4xl p-6 shadow-md ring-1",
                totals.net > 0 ? "bg-primary-light/50 ring-primary/30" : "bg-card ring-foreground/5"
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Net position
              </p>
              <p
                className={cn(
                  "mt-1 font-heading text-3xl font-semibold tracking-tight tabular-nums",
                  totals.net > 0 ? "text-primary" : "text-success"
                )}
              >
                {money(Math.abs(totals.net))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {totals.net > 0 ? "Owed to you after credit" : totals.net < 0 ? "In their favour" : "Square"}
              </p>
            </div>

            <div className={cn(cardCls, "p-6")}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Card on file
              </p>
              {c.card ? (
                <>
                  <div className="mt-2.5 flex items-center gap-3">
                    <span className="flex h-9 w-12 items-center justify-center rounded-2xl bg-muted">
                      <CreditCard className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {c.card.brand} •••• {c.card.last4}
                      </p>
                      <p className="text-xs text-muted-foreground">Expires {c.card.exp}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="mt-4"
                    disabled={totals.net <= 0}
                    onClick={() => addRow(`Card payment · ${c.card?.brand} ${c.card?.last4}`, -totals.net, "payment")}
                  >
                    Charge {money(Math.max(0, totals.net))}
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  No card saved. Payments have to go out as a link.
                </p>
              )}
            </div>
          </div>

          <Section title="Ledger" description="Oldest first, with the balance after every row.">
            {/* Two bare number columns are unreadable without a key — the
                right-hand one is the running balance, not a second amount. */}
            <div className="mb-2 flex items-center gap-4 px-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="min-w-0 flex-1">Entry</span>
              <span className="w-24 shrink-0 text-right">Amount</span>
              <span className="w-24 shrink-0 text-right">Balance</span>
            </div>
            <div className={listCls}>
              {running.map((row) => (
                <div key={row.id} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.label}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {fmtDate(row.date)}
                      {row.ref && ` · ${row.ref}`}
                    </p>
                  </div>
                  {!!row.unallocated && <Pill tone="warning">Unapplied</Pill>}
                  <p
                    className={cn(
                      "w-24 shrink-0 text-right text-sm font-semibold tabular-nums",
                      row.amount < 0 ? "text-success" : "text-foreground"
                    )}
                  >
                    {signedMoney(row.amount, money)}
                  </p>
                  <p className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {money(row.balance)}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <ActionButton variant="outline" onClick={() => addRow("Cleaning fee · interior valet", 40, "charge")}>
                <Plus className="size-4" />
                Add a charge
              </ActionButton>
              <ActionButton variant="outline" onClick={() => addRow("Goodwill credit", -25, "refund")}>
                <Plus className="size-4" />
                Give credit
              </ActionButton>
              <ActionButton variant="outline" onClick={() => undefined}>
                <FileDown className="size-4" />
                Statement of account
              </ActionButton>
            </div>
          </Section>

          <Section
            title="Payment links"
            description="Sent when there is no card on file, or when the customer would rather pay in their own time."
            right={
              <ActionButton variant="outline" onClick={() => undefined}>
                <Link2 className="size-4" />
                New link
              </ActionButton>
            }
          >
            {c.links.length === 0 ? (
              <EmptyHint>No links sent to this customer.</EmptyHint>
            ) : (
              <div className={listCls}>
                {c.links.map((l) => (
                  <div key={l.id} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Receipt className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Sent {fmtDate(l.sentAt)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{money(l.amount)}</p>
                    <Pill tone={LINK_TONE[l.status]}>{l.status}</Pill>
                    <Button variant="ghost" size="icon-sm" aria-label="Open in Stripe" className="text-muted-foreground">
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </Panel>
  );
}

/**
 * The numbers the Money panel and the overview rail both read.
 *
 * A write-off is NOT a receipt. Both reduce what the customer owes, so both are
 * negative rows in the ledger — but only one of them is money that arrived, and
 * conflating them makes the "Received" tile disagree with the operator's bank
 * statement by exactly the amount of goodwill they have given away. That is the
 * worst kind of wrong number: plausible, unexplained, and on the surface people
 * trust least to begin with.
 *
 * So `received` counts payments only, and `writtenOff` is reported separately.
 * `outstanding` is unchanged either way — a write-off still settles a charge.
 */
export function ledgerTotals(c: CustomerState) {
  const charges = c.ledger.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);

  /** Money that arrived but has not been pointed at a charge yet. */
  const credit = c.ledger.reduce((s, r) => s + (r.unallocated ?? 0), 0);

  const received = c.ledger
    .filter((r) => r.kind === "payment")
    .reduce((s, r) => s + Math.abs(r.amount), 0);

  /** Goodwill, refunds, adjustments — owed less, with no money behind it. */
  const writtenOff = c.ledger
    .filter((r) => r.kind === "refund")
    .reduce((s, r) => s + Math.abs(r.amount), 0);

  const applied = received - credit;
  const outstanding = charges - applied - writtenOff;

  return { charges, received, applied, writtenOff, credit, outstanding, net: outstanding - credit };
}

/* ══════════════════════════════════════════════════════════════════════════
   Fines
   ══════════════════════════════════════════════════════════════════════════ */

const FINE_TONE = { Unpaid: "warning", Paid: "success", Disputed: "primary", Transferred: "neutral" } as const;

export function FinesPanel({ c, patch, onJump }: PanelProps) {
  const unpaid = c.fines.filter((f) => f.status === "Unpaid");
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0);

  return (
    <Panel
      title="Fines"
      description="Citations and tolls that arrived against a car while this customer had it."
    >
      <ProducedFrom sources={[{ key: "rentals", label: "Rentals" }]} onJump={onJump} />

      {c.fines.length === 0 ? (
        <EmptyHint>Nothing has come in against this customer.</EmptyHint>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="On record" value={String(c.fines.length)} />
            <Stat
              label="Unpaid"
              value={String(unpaid.length)}
              hint={unpaid.length ? money(unpaidTotal) : "Nothing outstanding"}
              tone={unpaid.length ? "warning" : undefined}
            />
            <Stat
              label="Transferred"
              value={String(c.fines.filter((f) => f.status === "Transferred").length)}
              hint="Liability passed to the driver"
            />
          </div>

          <Section
            title="All fines"
            right={
              <ActionButton variant="outline" onClick={() => undefined}>
                <Plus className="size-4" />
                Add a fine
              </ActionButton>
            }
          >
            <div className="space-y-3">
              {c.fines.map((f) => (
                <div key={f.id} className={cn(listCls, "divide-y-0")}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Gavel className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.type}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {f.reference} · {f.vehicle}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{money(f.amount)}</p>
                    <Pill tone={FINE_TONE[f.status]}>{f.status}</Pill>
                  </div>
                  <div className="grid grid-cols-3 gap-3 border-t border-foreground/5 px-5 py-3">
                    <Meta label="Issued" value={fmtDate(f.issuedOn)} />
                    <Meta label="Due" value={fmtDate(f.dueOn)} />
                    <Meta label="Liability" value={f.liability} />
                  </div>
                </div>
              ))}
            </div>

            {unpaid.length > 0 && (
              <div className="mt-6">
                <ActionButton
                  onClick={() =>
                    patch((p) => ({
                      ...p,
                      ledger: [
                        ...p.ledger,
                        ...unpaid.map((f) => ({
                          id: `L${f.id}`,
                          date: TODAY,
                          label: `${f.type} · ${f.reference}`,
                          ref: null,
                          kind: "charge" as const,
                          amount: f.amount,
                        })),
                      ],
                      fines: p.fines.map((f) => (f.status === "Unpaid" ? { ...f, status: "Transferred" } : f)),
                    }))
                  }
                >
                  Charge {money(unpaidTotal)} to the customer
                </ActionButton>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Adds the amount to their ledger and marks the liability as transferred. It will show
                  up under{" "}
                  <button
                    type="button"
                    onClick={() => onJump("money")}
                    className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Money
                  </button>{" "}
                  straight away.
                </p>
              </div>
            )}
          </Section>
        </>
      )}
    </Panel>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium">{value}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Reviews
   ══════════════════════════════════════════════════════════════════════════ */

export function reviewAverage(c: CustomerState) {
  return c.reviews.length ? c.reviews.reduce((s, r) => s + r.rating, 0) / c.reviews.length : 0;
}

/** The summary against the set it was written from. Both numbers are stored
 *  beside the paragraph in production, so this needs nothing new either. */
export function summaryDrift(c: CustomerState): Drift[] {
  if (!c.summary || c.summary.basedOn === c.reviews.length) return [];
  return [
    { label: "Review count", was: `${c.summary.basedOn} reviews`, now: `${c.reviews.length} reviews` },
    {
      label: "Average rating",
      was: `${c.summary.avg.toFixed(1)} / 10`,
      now: `${reviewAverage(c).toFixed(1)} / 10`,
    },
  ];
}

export function ReviewsPanel({ c, patch, onJump, drift }: PanelProps & { drift: Drift[] }) {
  const [rating, setRating] = useState(8);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const avg = reviewAverage(c);
  const stale = drift.length > 0;

  const addReview = () => {
    if (!comment.trim()) return;
    patch((p) => ({
      ...p,
      reviews: [
        {
          id: `V${Date.now()}`,
          rating,
          comment: comment.trim(),
          tags,
          by: "You",
          at: TODAY,
          rentalRef: p.rentals[0]?.ref ?? "—",
        },
        ...p.reviews,
      ],
    }));
    setComment("");
    setTags([]);
    setRating(8);
  };

  const regenerate = () =>
    patch((p) => {
      const a = p.reviews.reduce((s, r) => s + r.rating, 0) / (p.reviews.length || 1);
      return {
        ...p,
        summary: {
          text: `Across ${p.reviews.length} staff reviews this customer averages ${a.toFixed(
            1
          )} out of 10. Recent notes emphasise ${
            p.reviews[0]?.tags[0]?.toLowerCase() || "condition on return"
          }; nothing in the set suggests a reason to decline a future booking.`,
          basedOn: p.reviews.length,
          avg: a,
          generatedAt: TODAY,
        },
      };
    });

  /** Keeping the paragraph re-baselines what it was written from and nothing
   *  else — the amber goes, the wording staff already read stays. */
  const keep = () =>
    patch((p) =>
      p.summary
        ? {
            ...p,
            summary: {
              ...p.summary,
              basedOn: p.reviews.length,
              avg: p.reviews.reduce((s, r) => s + r.rating, 0) / (p.reviews.length || 1),
            },
          }
        : p
    );

  return (
    <Panel
      title="Reviews"
      description="What staff thought of this customer. Internal — never shown to them, and never on the booking site."
    >
      <ProducedFrom sources={[{ key: "rentals", label: "Rentals" }]} onJump={onJump} />

      {stale && (
        <OutOfDateBanner
          title="The summary was written before the newest review landed"
          meta="Re-generating rewrites the paragraph from the full set. Keeping it leaves the wording as staff last read it."
          drift={drift}
          primaryLabel="Regenerate summary"
          onPrimary={regenerate}
          secondaryLabel="Keep current summary"
          onSecondary={keep}
        />
      )}

      {c.reviews.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Average" value={`${avg.toFixed(1)} / 10`} hint={`${c.reviews.length} reviews`} />
          <Stat
            label="Lowest"
            value={`${Math.min(...c.reviews.map((r) => r.rating))} / 10`}
            hint="Worst single handover"
          />
          <Stat
            label="Rentals reviewed"
            value={`${new Set(c.reviews.map((r) => r.rentalRef)).size} of ${
              c.rentals.filter((r) => r.status === "Completed").length
            }`}
            hint="Completed rentals with a review"
          />
        </div>
      )}

      {c.summary && (
        <Section
          title="What staff have said"
          description={`Written from ${c.summary.basedOn} reviews on ${fmtDate(c.summary.generatedAt)}.`}
          right={<Pill tone={stale ? "warning" : "primary"}>{stale ? "Out of date" : "AI summary"}</Pill>}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">{c.summary.text}</p>
        </Section>
      )}

      <Section
        title="Add a review"
        description="Applies the moment you add it — and the summary above will say it is behind."
      >
        <Field label="Rating">
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                variant={rating === n ? "default" : "outline"}
                size="icon"
                onClick={() => setRating(n)}
              >
                {n}
              </Button>
            ))}
          </div>
        </Field>

        <div className="mt-5">
          <Field label="Comment">
            <textarea
              rows={3}
              className={textareaCls}
              value={comment}
              placeholder="How was the handover, the return, the communication?"
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5">
          <Field label="Tags">
            <div className="flex flex-wrap gap-2">
              {REVIEW_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <Button
                    key={t}
                    variant={on ? "default" : "outline"}
                    size="xs"
                    onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                  >
                    {t}
                  </Button>
                );
              })}
            </div>
          </Field>
        </div>

        <div className="mt-6">
          <ActionButton onClick={addReview} disabled={!comment.trim()}>
            <Star className="size-4" />
            Add review
          </ActionButton>
        </div>
      </Section>

      {c.reviews.length === 0 ? (
        <EmptyHint>No one has rated this customer yet. The first review starts the average.</EmptyHint>
      ) : (
        <Section title="All reviews">
          <div className={listCls}>
            {c.reviews.map((r) => (
              <div key={r.id} className="flex gap-4 px-5 py-4">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-2xl font-heading text-sm font-semibold",
                    r.rating >= 8
                      ? "bg-success-light text-success"
                      : r.rating >= 5
                        ? "bg-primary-light text-primary"
                        : "bg-warning-light text-warning"
                  )}
                >
                  {r.rating}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">{r.comment}</p>
                  {r.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.tags.map((t) => (
                        <Pill key={t} tone="neutral">
                          {t}
                        </Pill>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.by} · {fmtDate(r.at)} · {r.rentalRef}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Activity
   ══════════════════════════════════════════════════════════════════════════ */

export function ActivityPanel({ c, onJump }: PanelProps) {
  return (
    <Panel title="Activity" description="Everything that has happened on this record, oldest first.">
      <ProducedFrom
        sources={[
          { key: "identity", label: "Identity" },
          { key: "rentals", label: "Rentals" },
          { key: "money", label: "Money" },
        ]}
        onJump={onJump}
      />
      {c.events.length === 0 ? (
        <EmptyHint>Nothing has happened on this account yet.</EmptyHint>
      ) : (
        <Section>
          <Timeline steps={c.events} />
        </Section>
      )}
    </Panel>
  );
}
