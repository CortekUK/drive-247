"use client";

/**
 * Saved payment methods, as cards rather than a line of text.
 *
 * ── what this replaces ──────────────────────────────────────────────────────
 *
 * A muted strip reading "•••• 4242 · Expires 12/2029" and an Update button.
 * It is the smallest, quietest thing on a page whose third question is "which
 * card gets charged", so it now looks like a card: brand artwork, the last four
 * at a size you can read across a desk, the expiry, and a badge saying whether
 * this is the one that will be charged.
 *
 * ── what is real, and what is honestly absent ───────────────────────────────
 *
 * The card shown is REAL: `tenant_subscriptions.card_brand / card_last4 /
 * card_exp_month / card_exp_year`, written by the Stripe webhook. Nothing is
 * invented and no raw card data exists anywhere in this app to expose.
 *
 * But the product stores exactly ONE card, denormalised onto the subscription
 * row. There is no table of payment methods, and no edge function that lists,
 * attaches, detaches or re-orders them on Stripe. So this component is built
 * for a LIST and renders the one that exists, with Primary on it — and it says
 * so, rather than drawing a fake "Secondary" slot that nothing can fill. When
 * the Stripe payment-method functions land, this takes an array and the empty
 * half of the UI stops being empty.
 *
 * Adding and changing a card both go through the Stripe BILLING PORTAL, which
 * is what the product already uses — Stripe hosts the form, so no card number
 * ever reaches this application.
 */

import { CheckCircle2, CreditCard, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardBrandIcon } from "@/components/subscription/card-brand-icon";

export interface SavedCard {
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  /** The one Stripe will charge. Exactly one card can hold this. */
  isPrimary: boolean;
}

function expiry(month: number | null, expYear: number | null): string | null {
  if (!month || !expYear) return null;
  return `${String(month).padStart(2, "0")}/${String(expYear).slice(-2)}`;
}

/**
 * One card. Deliberately card-SHAPED — a wide rounded panel with the brand mark
 * top-right and the number across the middle — because that is the object a
 * person is being asked to recognise.
 */
function PaymentCard({ card }: { card: SavedCard }) {
  const exp = expiry(card.expMonth, card.expYear);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${
        card.isPrimary
          ? "border-primary/30 bg-primary/[0.04]"
          : "border-border bg-muted/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {card.isPrimary ? (
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Primary
            </span>
          ) : (
            <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Backup
            </span>
          )}
        </div>
        <CardBrandIcon brand={card.brand} className="h-7 w-[2.6rem] shrink-0" />
      </div>

      {/* The dots are decoration — the four digits are the content — so they are
          aria-hidden and the readable label carries the meaning. */}
      <p className="mt-4 font-mono text-[15px] tracking-[0.18em] text-foreground">
        <span aria-hidden>•••• •••• •••• </span>
        <span className="sr-only">Card ending </span>
        {card.last4}
      </p>

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="capitalize">{card.brand || "Card"}</span>
        {exp ? <span>Expires {exp}</span> : <span className="italic">Expiry not on file</span>}
      </div>
    </div>
  );
}

export function PaymentMethods({
  cards,
  onManage,
}: {
  cards: SavedCard[];
  /** Opens the management dialog. Always available — see the button below. */
  onManage: () => void;
}) {
  const hasAny = cards.length > 0;

  return (
    <div className="space-y-4">
      {hasAny ? (
        <div className="space-y-3">
          {cards.map((c) => (
            <PaymentCard key={`${c.brand}-${c.last4}`} card={c} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
          <CardBrandIcon
            brand={null}
            className="mx-auto mb-3 h-9 w-[3.4rem] text-muted-foreground"
          />
          <p className="text-[13px] font-medium">No payment method on file</p>
          <p className="mx-auto mt-1 max-w-[240px] text-[12px] leading-relaxed text-muted-foreground">
            Add one so renewals and credit purchases can be charged without interruption.
          </p>
        </div>
      )}

      {/* NEVER disabled. This used to carry `disabled={previewActive}`, which on
          the canary is always — so it rendered as a live control and swallowed
          every click. It opens a dialog now; whether the dialog can write
          anything is the dialog's business, not this button's. */}
      <Button
        variant="outline"
        onClick={onManage}
        className="w-full gap-2 rounded-full"
      >
        {hasAny ? <CreditCard className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {hasAny ? "Manage payment methods" : "Add payment method"}
      </Button>

      {/* One line. The paragraph that stood here explained Stripe's custody of
          card numbers in three sentences, on a card whose job is to show which
          card gets charged. */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3 w-3 shrink-0" />
        Payment details are securely handled by Stripe.
      </p>
    </div>
  );
}
