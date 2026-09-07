"use client";

/**
 * Manage payment methods — inside Billing, not on a Stripe page.
 *
 * ── the bug this fixes ──────────────────────────────────────────────────────
 *
 * The button did nothing. It was `disabled` whenever the billing preview was
 * on, which on the canary tenant is always, so it rendered as a live control
 * and swallowed every click. Outside preview it did something almost as
 * unhelpful: navigated the whole browser to Stripe's hosted portal.
 *
 * It now always OPENS. What happens inside depends on what is really possible.
 *
 * ── what is real today, stated exactly ──────────────────────────────────────
 *
 * The product stores ONE card, denormalised on `tenant_subscriptions`
 * (card_brand / card_last4 / card_exp_*), written by the Stripe webhook. There
 * is no payment-methods table, and no edge function that lists, attaches,
 * detaches or re-orders methods on Stripe. So:
 *
 *   - the saved card shown is real
 *   - "Add / replace" hands off to the Stripe Billing Portal, which is the
 *     mechanism the product already has and which never lets a card number
 *     near this application
 *   - "Set as primary" and "Remove" are shown but INERT on real data, and say
 *     why, because a control that silently does nothing is the bug above
 *
 * In developer preview the same dialog is fully interactive against mock cards,
 * so the Primary / Secondary / add / remove states can all be reviewed now.
 * Nothing there touches Stripe or the database.
 */

import { useEffect, useState } from "react";
import {
  Check, CreditCard, Loader2, Plus, ShieldCheck, Star, Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui/button";
import { CardBrandIcon } from "@/components/subscription/card-brand-icon";
import type { SavedCard } from "@/components/subscription/payment-methods";
import { toast } from "sonner";

function expiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function Row({
  card, editable, onMakePrimary, onRemove, busy,
}: {
  card: SavedCard;
  editable: boolean;
  onMakePrimary: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const exp = expiry(card.expMonth, card.expYear);

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
        card.isPrimary ? "border-primary/30 bg-primary/[0.04]" : "border-border bg-muted/20"
      }`}
    >
      <CardBrandIcon brand={card.brand} className="h-7 w-[2.6rem] shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[13px] tracking-wider">
          <span aria-hidden>•••• </span>
          <span className="sr-only">Card ending </span>
          {card.last4}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          <span className="capitalize">{card.brand || "Card"}</span>
          {exp ? ` · Expires ${exp}` : ""}
        </p>
      </div>

      {card.isPrimary ? (
        <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          <Check className="h-3 w-3" />
          Primary
        </span>
      ) : (
        <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Secondary
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {!card.isPrimary && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            title={editable ? "Charge this card instead" : "Available once card management ships"}
            aria-label="Set as primary"
            disabled={!editable || busy}
            onClick={onMakePrimary}
          >
            <Star className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
          title={
            card.isPrimary
              ? "The card being charged cannot be removed — add another and make it primary first"
              : editable
                ? "Remove this card"
                : "Available once card management ships"
          }
          aria-label="Remove card"
          disabled={!editable || card.isPrimary || busy}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function PaymentMethodsDialog({
  open,
  onOpenChange,
  cards,
  /** Developer preview: the dialog is fully interactive and touches nothing. */
  mocked,
  onAddCard,
  isRedirecting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: SavedCard[];
  mocked: boolean;
  onAddCard: () => void;
  isRedirecting: boolean;
}) {
  /* Preview edits live here and nowhere else — they are thrown away when the
     dialog closes, because there is nothing to persist them to. */
  const [draft, setDraft] = useState<SavedCard[]>(cards);
  useEffect(() => { if (open) setDraft(cards); }, [open, cards]);

  const shown = mocked ? draft : cards;

  const makePrimary = (last4: string) =>
    setDraft((cs) => cs.map((c) => ({ ...c, isPrimary: c.last4 === last4 })));

  const remove = (last4: string) =>
    setDraft((cs) => cs.filter((c) => c.last4 !== last4));

  const addMockCard = () => {
    const brands = ["mastercard", "amex", "visa"];
    const next = {
      brand: brands[draft.length % brands.length],
      last4: String(1000 + Math.floor(Math.random() * 8999)),
      expMonth: 4,
      expYear: 2030,
      isPrimary: draft.length === 0,
    };
    setDraft((cs) => [...cs, next]);
    toast.success("Card added", { description: "Preview only — nothing was saved." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Payment methods</DialogTitle>
          <DialogDescription>
            The primary card is charged for renewals and credit purchases.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
              <CardBrandIcon
                brand={null}
                className="mx-auto mb-3 h-9 w-[3.4rem] text-muted-foreground"
              />
              <p className="text-[13px] font-medium">No payment method yet</p>
              <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
                Add one so renewals and credit purchases can be charged without interruption.
              </p>
            </div>
          ) : (
            shown.map((c) => (
              <Row
                key={c.last4}
                card={c}
                editable={mocked}
                busy={isRedirecting}
                onMakePrimary={() => makePrimary(c.last4)}
                onRemove={() => remove(c.last4)}
              />
            ))
          )}
        </div>

        {/* Honest about the half that is not built. Without this the star and
            bin icons are the same dead controls the button used to be. */}
        {!mocked && shown.length > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Choosing a primary card and removing cards are handled on Stripe&rsquo;s page for now —
            use Add or replace below.
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={mocked ? addMockCard : onAddCard}
            disabled={isRedirecting}
            className="w-full gap-2"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Opening Stripe…
              </>
            ) : (
              <>
                {shown.length > 0 ? <CreditCard className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {shown.length > 0 ? "Add or replace card" : "Add payment method"}
              </>
            )}
          </Button>

          <p className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            Payment details are securely handled by Stripe.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
