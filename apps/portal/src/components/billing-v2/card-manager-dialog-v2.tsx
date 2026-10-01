"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Star } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { cardBrandLabel } from "@/components/subscription/card-brand-icon";
import type { SavedCard } from "@/components/subscription/payment-methods";
import { CardThumb, PaymentCard3D } from "@/components/billing-v2/payment-card-3d";

/**
 * Manage cards — opened by clicking the card on v2 Billing. Every card on the
 * account, which one is charged (Primary), and: add a card, make one primary,
 * edit a card's name and expiry, remove one.
 *
 * The list is OWNED BY THE PAGE (`cards` + `onChange`), so a change here is
 * what the page's 3D card shows the moment the dialog closes.
 *
 * What is real, stated exactly: the platform stores ONE card on
 * `tenant_subscriptions`, and there are no functions yet that list / attach /
 * detach / re-default cards on Stripe. So:
 *
 *   - `local` (the canary's sample account): the list lives on the page and
 *     every action works in place. "Add card" is a full form, but only the
 *     brand, last four, expiry and name are kept — the number and CVC are
 *     checked and then dropped; nothing is sent anywhere.
 *   - A real account: each action hands off to Stripe's Billing Portal, which
 *     does all of these for real. Card numbers never touch this app.
 *
 * Only a card's name and expiry are editable — a card NUMBER can't be changed,
 * that's a new card.
 */

export type WalletCard = SavedCard & { id: string; name: string | null };

function expiry(m: number | null, y: number | null): string | null {
  if (!m || !y) return null;
  return `${String(m).padStart(2, "0")}/${String(y).slice(-2)}`;
}

/** The network from the number's first digits (IIN ranges). */
export function brandFromNumber(digits: string): string | null {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(6011|65|64[4-9])/.test(digits)) return "discover";
  if (/^35/.test(digits)) return "jcb";
  if (/^3(0[0-5]|[68])/.test(digits)) return "diners";
  if (/^62/.test(digits)) return "unionpay";
  return null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

/** The number line on the live preview, MASKED: a card number is only ever
 *  displayed masked (PCI DSS), so every digit but the last four typed is a
 *  dot, in the network's grouping — "•••• •••• •••• 4242", Amex 4-6-5. The
 *  field itself still shows what's being typed; the card never does. */
function liveGroups(digits: string, amex: boolean): string[] {
  const sizes = amex ? [4, 6, 5] : [4, 4, 4, 4];
  const total = sizes.reduce((a, b) => a + b, 0);
  const typed = digits.slice(0, total);
  const shown = typed.length > 4 ? "•".repeat(typed.length - 4) + typed.slice(-4) : typed;
  const padded = (shown + "•".repeat(total)).slice(0, total);
  const out: string[] = [];
  let i = 0;
  for (const n of sizes) {
    out.push(padded.slice(i, i + n));
    i += n;
  }
  return out;
}

/** "4242424242424242" → "4242 4242 4242 4242"; Amex as 4-6-5. */
function groupNumber(digits: string): string {
  if (/^3[47]/.test(digits)) return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(" ");
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

const LINK =
  "text-sm text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";

export function CardManagerDialogV2({
  open,
  onOpenChange,
  cards,
  onChange,
  local,
  onStripe,
  isRedirecting,
  readOnly,
  holderName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every card, from the page. */
  cards: WalletCard[];
  /** `local` only: the page's setter. */
  onChange: (cards: WalletCard[]) => void;
  /** The canary's sample account: changes are made here, on the page's list. */
  local: boolean;
  /** A real account: hand off to Stripe's Billing Portal. */
  onStripe: () => void;
  isRedirecting: boolean;
  readOnly: boolean;
  /** Prefills "Name on card" on a new card. */
  holderName: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (open) {
      setEditing(null);
      setAdding(false);
    }
  }, [open]);

  const locked = readOnly || isRedirecting;

  /* Real account: every change is made on Stripe's page. */
  const act = (fn: () => void) => () => {
    if (!local) return onStripe();
    fn();
  };

  const makePrimary = (id: string) =>
    act(() => {
      onChange(cards.map((c) => ({ ...c, isPrimary: c.id === id })));
      const c = cards.find((x) => x.id === id);
      toast.success("Primary card changed", {
        description: c ? `${cardBrandLabel(c.brand)} •••• ${c.last4} will be charged from your next bill.` : undefined,
      });
    });

  const remove = (id: string) =>
    act(() => {
      const c = cards.find((x) => x.id === id);
      onChange(cards.filter((x) => x.id !== id));
      toast.success("Card removed", { description: c ? `${cardBrandLabel(c.brand)} •••• ${c.last4}` : undefined });
    });

  const save = (id: string, patch: Pick<WalletCard, "name" | "expMonth" | "expYear">, primary: boolean) => {
    onChange(
      cards.map((c) =>
        c.id === id ? { ...c, ...patch, isPrimary: c.isPrimary || primary } : primary ? { ...c, isPrimary: false } : c,
      ),
    );
    setEditing(null);
    toast.success("Card updated");
  };

  const editingCard = editing ? cards.find((c) => c.id === editing) ?? null : null;
  const inForm = adding || !!editingCard;

  const addCard = (card: WalletCard, primary: boolean) => {
    const next = primary || cards.length === 0 ? cards.map((c) => ({ ...c, isPrimary: false })) : cards;
    onChange([...next, { ...card, isPrimary: primary || cards.length === 0 }]);
    setAdding(false);
    toast.success("Card added", { description: `${cardBrandLabel(card.brand)} •••• ${card.last4}` });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 ${inForm ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <DialogHeader className="shrink-0 px-7 pb-2 pt-7 text-left">
          <DialogTitle>{editingCard ? "Edit card" : adding ? "Add a card" : "Cards"}</DialogTitle>
          <DialogDescription>
            {editingCard
              ? `${cardBrandLabel(editingCard.brand)} •••• ${editingCard.last4}`
              : adding
                ? "It can be charged for your Drive247 subscription."
                : "Your primary card is charged for your Drive247 subscription."}
          </DialogDescription>
        </DialogHeader>

        {inForm ? (
          <CardForm
            key={editingCard?.id ?? "new"}
            card={editingCard}
            holderName={holderName}
            hasCards={cards.length > (editingCard ? 1 : 0)}
            onCancel={() => {
              setAdding(false);
              setEditing(null);
            }}
            onAdd={addCard}
            onSave={(patch, primary) => editingCard && save(editingCard.id, patch, primary)}
          />
        ) : (
          <>
            <div className="overflow-y-auto px-7 pb-2 pt-4">
              {cards.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No card on file yet. Add one so your subscription renews without interruption.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {cards.map((c) => (
                    <li key={c.id} className="py-4">
                      <div className="flex items-center gap-4">
                        <CardThumb brand={c.brand} last4={c.last4} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {cardBrandLabel(c.brand)} •••• {c.last4}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[expiry(c.expMonth, c.expYear) ? `Expires ${expiry(c.expMonth, c.expYear)}` : null, c.name]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-baseline gap-4">
                          <button
                            type="button"
                            className={LINK}
                            onClick={act(() => setEditing(c.id))}
                            disabled={locked}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`${LINK} !text-muted-foreground`}
                            onClick={remove(c.id)}
                            disabled={locked || c.isPrimary}
                            title={c.isPrimary ? "Make another card primary before removing this one" : undefined}
                          >
                            Remove
                          </button>
                          {/* The star IS the primary marker: filled on the card that's
                              charged, an outline on the others — click one to make
                              it primary. */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={c.isPrimary ? undefined : makePrimary(c.id)}
                                disabled={!c.isPrimary && locked}
                                aria-label={c.isPrimary ? "Primary card" : "Make primary"}
                                aria-pressed={c.isPrimary}
                                className={`self-center rounded-md p-1 transition-colors duration-200 ease-out motion-reduce:transition-none ${
                                  c.isPrimary
                                    ? "cursor-default text-primary"
                                    : "text-muted-foreground/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                }`}
                              >
                                <Star className={`h-4 w-4 ${c.isPrimary ? "fill-current" : ""}`} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{c.isPrimary ? "Primary card" : "Make primary"}</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter className="shrink-0 flex-col items-stretch gap-3 border-t px-7 py-5 sm:flex-col">
              <Button onClick={act(() => setAdding(true))} disabled={locked} className="w-full rounded-xl">
                {isRedirecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening Stripe…
                  </>
                ) : (
                  "Add card"
                )}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Card details are handled securely by Stripe.</p>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add a card, or edit one (`card` set): the same view, the live card on the
 * left and the fields on the right. Editing is pre-filled; the number shows
 * masked and locked (a number can't change — that's a new card), and there
 * is no security code to ask for.
 */
function CardForm({
  card,
  holderName,
  hasCards,
  onCancel,
  onAdd,
  onSave,
}: {
  card: WalletCard | null;
  holderName: string | null;
  /** Other cards exist, so "primary" is a choice. */
  hasCards: boolean;
  onCancel: () => void;
  onAdd: (card: WalletCard, primary: boolean) => void;
  onSave: (patch: Pick<WalletCard, "name" | "expMonth" | "expYear">, primary: boolean) => void;
}) {
  const editing = !!card;
  const [name, setName] = useState((card ? card.name : holderName) ?? "");
  const [number, setNumber] = useState("");
  const [exp, setExp] = useState(
    card?.expMonth && card?.expYear ? `${String(card.expMonth).padStart(2, "0")} / ${String(card.expYear).slice(-2)}` : "",
  );
  const [cvc, setCvc] = useState("");
  const [primary, setPrimary] = useState(card ? card.isPrimary : !hasCards);
  const [touched, setTouched] = useState(false);

  const digits = number.replace(/\D/g, "");
  const brand = card ? card.brand : brandFromNumber(digits);
  const amex = brand === "amex";
  const [mm, yy] = exp.split("/").map((p) => p?.trim() ?? "");
  const m = Number(mm);
  const y = 2000 + Number(yy);
  const now = new Date();
  const expOk = m >= 1 && m <= 12 && /^\d{2}$/.test(yy ?? "") && (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1));
  const numOk = editing || (luhn(digits) && digits.length >= (amex ? 15 : 16));
  const cvcOk = editing || cvc.length === (amex ? 4 : 3);
  const nameOk = name.trim().length > 1;
  const valid = numOk && expOk && cvcOk && nameOk;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    if (card) {
      onSave({ name: name.trim(), expMonth: m, expYear: y }, primary);
      return;
    }
    // Only what a saved card shows is kept. The number and CVC stop here.
    onAdd(
      { id: `card-${Date.now()}`, brand: brand ?? "unknown", last4: digits.slice(-4), expMonth: m, expYear: y, isPrimary: false, name: name.trim() },
      primary,
    );
  };

  const err = (ok: boolean) => (touched && !ok ? "border-red-400 focus-visible:ring-red-300" : "");

  return (
    <>
      {/* Side by side on sm+, so the whole form fits without scrolling: the
          card on the left, drawn live from what's typed (number, name, expiry,
          and the network's colours and mark as soon as the digits tell us),
          the fields on the right. */}
      <div className="grid items-center gap-6 overflow-y-auto px-7 pb-5 pt-4 sm:grid-cols-[300px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[300px]">
          <PaymentCard3D
            fit={false}
            brand={brand}
            last4={card ? card.last4 : digits.slice(-4) || "••••"}
            numberGroups={card ? undefined : liveGroups(digits, amex)}
            expMonth={m >= 1 && m <= 12 ? m : null}
            expYear={/^\d{2}$/.test(yy ?? "") ? y : null}
            // Shown as it's typed, not only once it's a full date.
            expiryText={`${(mm ?? "").padEnd(2, "-")}/${(yy ?? "").padEnd(2, "-")}`}
            name={name.trim() || null}
            isPrimary={primary}
          />
        </div>

        <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="new-card-name" className="text-xs text-muted-foreground">
            Name on card
          </label>
          <Input id="new-card-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="cc-name" className={err(nameOk)} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="new-card-number" className="text-xs text-muted-foreground">
            Card number
          </label>
          <div className="relative">
            <Input
              id="new-card-number"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              // Editing: masked and locked — a number can't change.
              value={card ? `•••• •••• •••• ${card.last4}` : groupNumber(digits)}
              disabled={editing}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19))}
              className={`pr-24 font-mono tracking-wider disabled:opacity-70 ${err(numOk)}`}
            />
            {brand && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                {cardBrandLabel(brand)}
              </span>
            )}
          </div>
          {touched && !numOk && <p className="text-xs text-red-600">That card number doesn&apos;t look right.</p>}
          {editing && (
            <p className="text-xs text-muted-foreground">The number can&apos;t be changed. To use a different card, add a new one.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="new-card-exp" className="text-xs text-muted-foreground">
              Expiry
            </label>
            <Input
              id="new-card-exp"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM / YY"
              value={exp}
              onChange={(e) => {
                let d = e.target.value.replace(/\D/g, "").slice(0, 4);
                // A month can't start with 2–9 or pass 12: "8" is "08", "13" stops at "1".
                if (/^[2-9]/.test(d)) d = `0${d}`.slice(0, 4);
                if (d.length >= 2 && Number(d.slice(0, 2)) > 12) d = d.slice(0, 1);
                if (d.slice(0, 2) === "00") d = "0";
                setExp(d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d);
              }}
              className={`font-mono ${err(expOk)}`}
            />
            {touched && !expOk && <p className="text-xs text-red-600">Check the expiry date.</p>}
          </div>
          {!editing && (
          <div className="space-y-1.5">
            <label htmlFor="new-card-cvc" className="text-xs text-muted-foreground">
              Security code
            </label>
            <Input
              id="new-card-cvc"
              type="password"
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder={amex ? "4 digits" : "3 digits"}
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, amex ? 4 : 3))}
              className={`font-mono ${err(cvcOk)}`}
            />
          </div>
          )}
        </div>

        {hasCards && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={primary}
              // The primary card stays primary until another one is starred.
              disabled={!!card?.isPrimary}
              onChange={(e) => setPrimary(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
            />
            Make this my primary card
          </label>
        )}
        </div>
      </div>

      {/* One slim row: Back and the Stripe note on the left, the action right. */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-t px-7 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={onCancel} className={`inline-flex items-center gap-1 self-center ${LINK}`}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">Card details are handled securely by Stripe.</span>
        </div>
        <Button onClick={submit} className="h-9 shrink-0 rounded-xl px-5">
          {editing ? "Save changes" : "Add card"}
        </Button>
      </div>
    </>
  );
}
