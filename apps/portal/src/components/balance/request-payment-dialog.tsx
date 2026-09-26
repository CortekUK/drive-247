"use client";

/**
 * Request a payment "for" something (spec §8's worked flow: "creates the link
 * there, writes what the payment is for — and the balance updates from there").
 *
 * Step 1, here: amount + what it is for → a new charge on the account (or on a
 * rental), through adjust-customer-balance (kind charge_correction, reason
 * payment_request). The charge's reference is the "what it's for" text, so it
 * reads that way on every ledger and in Finances. The balance goes up at once.
 * Step 2, the caller: opens the EXISTING Collect Payment dialog for that amount
 * — send a link, charge the card, or record it by hand.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useBalanceActions } from "@/hooks/use-balance-adjustments";
import { formatCents, parseDollarsToCents } from "./balance-words";
import { BalanceField, BalanceSelect, Callout, MoneyInput, controlCls } from "./balance-kit";
import type { BalanceRentalOption } from "./adjust-balance-dialog";

const ACCOUNT = "__account__";

export function RequestPaymentDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  rentals = [],
  currency,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName?: string | null;
  rentals?: BalanceRentalOption[];
  currency: string;
  /** The charge exists; open the link flow for it. */
  onRequested: (req: { amountCents: number; forWhat: string }) => void;
}) {
  const actions = useBalanceActions();
  const [amountText, setAmountText] = useState("");
  const [forWhat, setForWhat] = useState("");
  const [where, setWhere] = useState(ACCOUNT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAmountText("");
      setForWhat("");
      setWhere(ACCOUNT);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const cents = parseDollarsToCents(amountText);
  const ok = !!cents && forWhat.trim().length > 0 && !busy;

  const run = async () => {
    if (!ok || !cents) return;
    setBusy(true);
    setError(null);
    try {
      await actions.adjust(customerId, {
        kind: "charge_correction",
        amount: cents / 100,
        direction: "increase",
        reason_code: "payment_request",
        note: forWhat.trim(),
        rentalId: where === ACCOUNT ? null : where,
      });
      onRequested({ amountCents: cents, forWhat: forWhat.trim() });
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || "The charge could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const pickable = rentals.filter((r) => !r.refusal);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(e.target as HTMLElement)?.closest?.("[data-confirm]")) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-heading">Request a payment</DialogTitle>
          <DialogDescription>
            Adds a charge to {customerName ? `${customerName}'s` : "the"} balance for what you write below, then opens the
            payment window so you can send a link or take it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <BalanceField label="Amount" htmlFor="request-amount">
            <MoneyInput id="request-amount" value={amountText} onChange={setAmountText} />
          </BalanceField>
          <BalanceField label="What it's for" htmlFor="request-for" hint="The customer sees this on the charge and in the email.">
            <input
              id="request-for"
              value={forWhat}
              maxLength={200}
              onChange={(e) => setForWhat(e.target.value)}
              placeholder="e.g. Parking ticket from 12 Sep"
              className={controlCls}
            />
          </BalanceField>
          {pickable.length > 0 && (
            <BalanceField label="Against" htmlFor="request-where">
              <BalanceSelect
                id="request-where"
                value={where}
                onChange={setWhere}
                options={[{ value: ACCOUNT, label: "The customer account" }, ...pickable.map((r) => ({ value: r.id, label: r.label }))]}
              />
            </BalanceField>
          )}
          {error && <Callout tone="destructive">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button data-confirm disabled={!ok} onClick={() => void run()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {cents ? `Add ${formatCents(cents, currency)} and continue` : "Add the charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
