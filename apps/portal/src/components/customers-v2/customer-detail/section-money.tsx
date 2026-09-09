"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Money — the ledger, what is outstanding, and the links sent to collect it.
 *
 * `received` counts payments only. A goodwill write-off also reduces what is
 * owed, but it is not money that arrived, and this is the one tile an operator
 * reconciles against their bank.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Banknote, CreditCard, ExternalLink, FileDown, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { CustomerStatementDialog } from "@/components/customers/customer-statement-dialog";
import { CollectPaymentDialog } from "@/components/customers/collect-payment-dialog";
import { ledgerTotals, moneyIn, signedMoney } from "./derive";
import { EmptyHint, Panel, Pill, ProducedFrom, Section, Stat, cardCls, fmtDate, listCls } from "./kit";
import type { SectionProps } from "./sections";

export function SectionMoney({ c, onJump, canEdit, currency }: SectionProps) {
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-tour="customer-money-totals">
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
                <Button size="sm" className="mt-4" data-tour="customer-money-collect" onClick={() => setCollectOpen(true)}>
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
              <Button variant="outline" data-tour="customer-money-statement" onClick={() => setStatementOpen(true)}>
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
