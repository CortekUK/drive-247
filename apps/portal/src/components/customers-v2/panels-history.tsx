"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — HISTORY.
 *
 * The third band: what this person has actually done. None of it is typed in —
 * every panel here is produced from rentals, money that moved, or something a
 * member of staff wrote afterwards.
 *
 * Reviews is the second of the screen's two staleness cases, and the one that
 * needs no new column either: `customer_review_summaries` already stores the
 * review count and average the paragraph was written from, right beside the
 * paragraph.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Car,
  CreditCard,
  ExternalLink,
  FileDown,
  Gavel,
  Plus,
  Receipt,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { CustomerStatementDialog } from "@/components/customers/customer-statement-dialog";
import { CollectPaymentDialog } from "@/components/customers/collect-payment-dialog";
import { AddFineDialog } from "@/components/fines/add-fine-dialog";
import { ledgerTotals, moneyIn, reviewAverage, signedMoney } from "./derive";
import {
  EmptyHint,
  Meta,
  Panel,
  Pill,
  ProducedFrom,
  Section,
  Segmented,
  Stat,
  Timeline,
  cardCls,
  dayCount,
  fmtDate,
  listCls,
} from "./kit";
import type { Drift } from "./kit";
import type { PanelProps } from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Rentals
   ══════════════════════════════════════════════════════════════════════════ */

const RENTAL_TONE = {
  Active: "primary",
  Completed: "success",
  Cancelled: "neutral",
  Pending: "warning",
  Upcoming: "neutral",
} as const;

export function RentalsPanel({ c, onJump, currency }: PanelProps) {
  const [view, setView] = useState<"booking" | "car">("booking");
  const router = useRouter();
  const money = moneyIn(currency);

  const settled = c.rentals.filter((r) => r.status !== "Cancelled");
  const lifetime = settled.reduce((s, r) => s + r.total, 0);
  const withDates = settled.filter((r) => r.end);
  const avgLength = withDates.length
    ? withDates.reduce((s, r) => s + dayCount(r.start, r.end), 0) / withDates.length
    : 0;

  /** The same rows, asked a different question: not "what did they book?" but
   *  "which of my cars have they had, and how did that go?" */
  const byCar = settled.reduce<Record<string, { reg: string; times: number; days: number; spend: number }>>(
    (acc, r) => {
      const key = r.vehicle;
      const prev = acc[key] ?? { reg: r.reg, times: 0, days: 0, spend: 0 };
      acc[key] = {
        reg: r.reg,
        times: prev.times + 1,
        days: prev.days + (r.end ? dayCount(r.start, r.end) : 0),
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
              hint={
                settled.length === c.rentals.length
                  ? "None cancelled"
                  : `${c.rentals.length - settled.length} cancelled`
              }
            />
            <Stat label="Lifetime value" value={money(lifetime)} hint="Excludes cancellations" />
            <Stat
              label="Average length"
              value={avgLength ? `${avgLength.toFixed(1)} days` : "—"}
              hint="Across rentals with an end date"
            />
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
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.ref} · {fmtDate(r.start)} → {fmtDate(r.end)}
                        {r.end && ` · ${dayCount(r.start, r.end)} days`}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(r.total)}</p>
                      {/* "Settled" is only true of a rental that has actually
                          run. A Pending booking with nothing owed has not been
                          settled — it has not been invoiced. */}
                      {r.outstanding > 0 ? (
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-primary">
                          {money(r.outstanding)} owed
                        </p>
                      ) : r.status === "Active" || r.status === "Completed" ? (
                        <p className="mt-0.5 text-xs text-success">Settled</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">—</p>
                      )}
                    </div>

                    <Pill tone={RENTAL_TONE[r.status]}>{r.status}</Pill>

                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => router.push(`/rentals/${r.id}`)}
                    >
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
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.reg}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {v.times}× · {v.days} days
                    </p>
                    <p className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">{money(v.spend)}</p>
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

export function MoneyPanel({ c, onJump, canEdit, currency }: PanelProps) {
  const [statementOpen, setStatementOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const money = moneyIn(currency);
  const totals = ledgerTotals(c);

  const running = (() => {
    let n = 0;
    return c.ledger.map((row) => {
      n += row.amount;
      return { ...row, balance: n };
    });
  })();

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
              // is what an operator reconciles against their bank, so money
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
           * account, uncounted against anything, while a charge downstream
           * still reads as outstanding. Operators chase customers over exactly
           * this.
           */}
          {totals.credit > 0 && (
            <div className="flex items-start gap-3 rounded-4xl bg-warning-light/50 px-6 py-5 ring-1 ring-warning/25">
              <Banknote className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{money(totals.credit)} has arrived but is not against a charge</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  It is applied oldest charge first the next time this account is settled — so this
                  customer reads as {money(totals.outstanding)} outstanding while already holding
                  enough to cover {totals.credit >= totals.outstanding ? "all of it" : "part of it"}.
                </p>
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
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Net position</p>
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
              {canEdit && totals.net > 0 && (
                <Button size="sm" className="mt-4" onClick={() => setCollectOpen(true)}>
                  Collect a payment
                </Button>
              )}
            </div>

            {/*
             * No card details are held in this database — Stripe holds them, and
             * this screen has no server-side call to go and ask. So it reports
             * what it can actually stand behind: whether there is a Stripe
             * customer to charge against, and the methods this customer has
             * actually paid with before.
             */}
            <div className={cn(cardCls, "p-6")}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Billing</p>
              <div className="mt-2.5 flex items-center gap-3">
                <span className="flex h-9 w-12 items-center justify-center rounded-2xl bg-muted">
                  <CreditCard className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.billing.methodsUsed.length
                      ? `Has paid by ${c.billing.methodsUsed.join(", ")}`
                      : "No payment taken yet"}
                  </p>
                  {/* Wraps rather than truncates: this line is the caveat, and
                      a caveat cut off mid-word is worse than no caveat. */}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {c.billing.stripeCustomerId
                      ? "Stripe customer on file — a saved card can be charged"
                      : "No Stripe customer, so nothing can be charged without asking"}
                  </p>
                </div>
              </div>
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
              <Button variant="outline" onClick={() => setStatementOpen(true)}>
                <FileDown className="size-4" />
                Statement of account
              </Button>
            </div>
          </Section>

          <Section
            title="Payment requests"
            description="Sent when there is no card on file, or when the customer would rather pay in their own time."
          >
            {c.links.length === 0 ? (
              <EmptyHint>No payment requests sent to this customer.</EmptyHint>
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
                    <Pill tone={l.status === "Paid" ? "success" : l.status === "Void" ? "neutral" : "primary"}>
                      {l.status}
                    </Pill>
                    {l.url && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open the payment link"
                        onClick={() => window.open(l.url!, "_blank")}
                        className="text-muted-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <CustomerStatementDialog open={statementOpen} onOpenChange={setStatementOpen} customerId={c.id} />
      <CollectPaymentDialog open={collectOpen} onOpenChange={setCollectOpen} customerId={c.id} />
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Fines
   ══════════════════════════════════════════════════════════════════════════ */

export function FinesPanel({ c, onJump, canEdit, currency }: PanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const money = moneyIn(currency);
  const unpaid = c.fines.filter((f) => f.status === "Open");
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0);

  return (
    <Panel
      title="Fines"
      description="Citations and tolls that arrived against a car while this customer had it."
      right={
        canEdit ? (
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add a fine
          </Button>
        ) : undefined
      }
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
              label="Settled"
              value={String(c.fines.filter((f) => f.status !== "Open").length)}
              hint="Paid or waived"
            />
          </div>

          <Section title="All fines">
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
                    <Pill tone={f.status === "Open" ? "warning" : f.status === "Paid" ? "success" : "neutral"}>
                      {f.status}
                    </Pill>
                  </div>
                  <div className="grid grid-cols-3 gap-3 border-t border-foreground/5 px-5 py-3">
                    <Meta label="Issued" value={fmtDate(f.issuedOn)} />
                    <Meta label="Due" value={fmtDate(f.dueOn)} />
                    <Meta label="Liability" value={f.liability} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      <AddFineDialog open={addOpen} onOpenChange={setAddOpen} preselectedCustomerId={c.id} />
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Reviews
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rewrites the paragraph from the full set of reviews.
 *
 * There is no "keep the current one" write to make: the summary's staleness is
 * measured against `total_reviews`, which the edge function refreshes when it
 * regenerates. Leaving it alone IS keeping it, so the second button simply does
 * not exist here — an action that does nothing is worse than no action.
 */
function useRegenerateSummary(customerId: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("generate-review-summary", {
        body: { customerId, tenantId: tenant!.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-review-summary"] });
      toast({ title: "Summary rewritten", description: "Written from every review on file." });
    },
    onError: (e: any) =>
      toast({ title: "Could not rewrite the summary", description: e.message, variant: "destructive" }),
  });
}

export function ReviewsPanel({ c, onJump, canEdit, drift }: PanelProps & { drift: Drift[] }) {
  const regenerate = useRegenerateSummary(c.id);
  const avg = reviewAverage(c);
  const stale = drift.length > 0;
  const completed = c.rentals.filter((r) => r.status === "Completed").length;

  return (
    <Panel
      title="Reviews"
      description="What staff thought of this customer. Internal — never shown to them, and never on the booking site."
    >
      <ProducedFrom sources={[{ key: "rentals", label: "Rentals" }]} onJump={onJump} />

      {stale && (
        <OutOfDate
          drift={drift}
          onRegenerate={() => regenerate.mutate()}
          disabled={!canEdit || regenerate.isPending}
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
            value={`${new Set(c.reviews.map((r) => r.rentalRef)).size} of ${completed}`}
            hint="Completed rentals with a review"
          />
        </div>
      )}

      {c.summary && (
        <Section
          title="What staff have said"
          description={`Written from ${c.summary.basedOn} review${
            c.summary.basedOn === 1 ? "" : "s"
          } on ${fmtDate(c.summary.generatedAt)}.`}
          right={<Pill tone={stale ? "warning" : "primary"}>{stale ? "Out of date" : "AI summary"}</Pill>}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">{c.summary.text}</p>
        </Section>
      )}

      {c.reviews.length === 0 ? (
        <EmptyHint>
          No one has rated this customer yet. A review is written against a rental as it closes, so the
          first one starts the average.
        </EmptyHint>
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
                  <p className="text-sm leading-relaxed">{r.comment || "No comment left."}</p>
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

/** The reviews banner. One way out, because there is only one real action. */
function OutOfDate({
  drift,
  onRegenerate,
  disabled,
}: {
  drift: Drift[];
  onRegenerate: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-4xl bg-warning-light/70 p-6 shadow-md ring-1 ring-warning/30">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold">
            The summary was written before the newest review landed
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Leaving it alone is a fair answer — the wording staff have already read stays as it is.
          </p>

          <div className="mt-4 divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-card/80 ring-1 ring-foreground/5">
            {drift.map((d) => (
              <div key={d.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3">
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">Written from</span>
                  <span className="block truncate font-medium line-through decoration-muted-foreground/50">
                    {d.was}
                  </span>
                </span>
                <span className="text-muted-foreground/60">→</span>
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">{d.label} now</span>
                  <span className="block truncate font-semibold text-foreground">{d.now}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <Button onClick={onRegenerate} disabled={disabled}>
              Rewrite the summary
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Activity
   ══════════════════════════════════════════════════════════════════════════ */

export function ActivityPanel({ c, onJump }: PanelProps) {
  return (
    <Panel
      title="Activity"
      description="Everything that has happened on this record, oldest first."
    >
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
          <Timeline steps={c.events.map((e) => ({ ...e, at: e.at ? fmtDate(e.at) : undefined }))} />
        </Section>
      )}
    </Panel>
  );
}
