"use client";

/**
 * Payments — every money ACTION on the rental.
 *
 * `stage-payments.tsx` shows the ledger; this file changes it. It renders the
 * action row pinned in the Panel's footer and owns everything behind it.
 *
 * ── Nothing here moves money itself ──────────────────────────────────────
 *
 * Every real mutation is v1's, reused as it stands: `AddPaymentDialog`
 * (charge the card on file / send a link / record a payment by hand),
 * `RefundDialog` (`process-refund`), `TakeDepositDialog`, `AddHoldDialog`
 * (`create-hold-checkout`), `ChargeDepositDialog` (`place-deposit-hold` then
 * `capture-deposit-hold`) and the fines dialog. A v2 copy of any of them would
 * be a second call-site for the same edge function that has to be kept in step
 * with the first, on the one screen where drift costs real money. A modal in
 * the v1 grammar over a v2 screen is much the cheaper mismatch.
 *
 * ── What this file DOES add, and why it had to ───────────────────────────
 *
 * One thing: the step before `AddPaymentDialog`.
 *
 * The prototype's Charge and Record dialogs opened with everything outstanding
 * pre-ticked. That default is right far more often than it is wrong — an
 * operator taking a payment is nearly always taking the balance — so it stays.
 * What does not stay is the one-keystroke danger behind it: v1's
 * `AddPaymentDialog` is a `<form onSubmit={…}>` with a `type="submit"` button,
 * so Enter pressed in ANY of its inputs fires the charge. On a rental with a
 * $1,657 balance that is one stray keypress between an operator and a bill the
 * customer did not agree to.
 *
 * So the deciding happens first, in `AimDialog`, which is not a form, swallows
 * Enter, and whose confirming control states the amount and the count it is
 * about to move — "Take $1,657.00 across 4 charges", never a bare "Confirm".
 * Only when that has been read does v1's dialog open, with the amount and the
 * targets already settled.
 *
 * ── The unit money can be aimed at ───────────────────────────────────────
 *
 * The prototype ticked individual charges. The database cannot honour that:
 * `payment_apply_fifo_v2` narrows by `target_categories` — a list of
 * CATEGORIES. So the picker groups by CATEGORY, which is exactly what the
 * allocator can act on. Ticking one of two charges in the same category would
 * be a lie about where the money would land.
 */

import { useMemo, useState } from "react";
import { CreditCard, Plus, Undo2, ShieldCheck, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
// v1's money dialogs, reused verbatim — see the header.
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { RefundDialog } from "@/components/shared/dialogs/refund-dialog";
import { TakeDepositDialog } from "@/components/shared/dialogs/take-deposit-dialog";
import { AddHoldDialog } from "@/components/shared/dialogs/add-hold-dialog";
import { ChargeDepositDialog } from "@/components/shared/dialogs/charge-deposit-dialog";
import AddFineDialog from "@/components/fines/add-fine-dialog";
import { ActionButton, Field, inputCls } from "./_kit";
import {
  FIFO_CATEGORIES,
  fifoRank,
  heldOn,
  remainingOn,
  sum,
  totals,
  usd,
  type Charge,
  type Ledger,
  type Payment,
} from "./payments-model";

/* ══════════════════════════════════════════════════════════════════════════
   Contract
   ══════════════════════════════════════════════════════════════════════════ */

export type ActionRequest =
  | { kind: "take" }
  | { kind: "refund"; paymentId: string }
  | { kind: "fine" }
  | { kind: "deposit-take" }
  | { kind: "deposit-hold" }
  | { kind: "deposit-charge" }
  | { kind: "deposit-release" };

/** Cents → the dollars v1's dialogs speak. The only place it happens. */
const dollars = (c: number) => Math.round(c) / 100;

const list = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/* ══════════════════════════════════════════════════════════════════════════
   Aiming a payment — the step before v1's dialog
   ══════════════════════════════════════════════════════════════════════════ */

/** One category bucket: the finest thing the allocator can be told. */
type Target = {
  key: string;
  category: string;
  chargeCount: number;
  outstanding: number;
  settleable: boolean;
};

function targetsOf(ledger: Ledger): Target[] {
  const buckets = new Map<string, Target>();
  for (const c of ledger.charges) {
    const left = remainingOn(ledger, c.id);
    if (left <= 0) continue;
    const b = buckets.get(c.category) ?? {
      key: c.category,
      category: c.category,
      chargeCount: 0,
      outstanding: 0,
      settleable: c.settleable,
    };
    b.chargeCount += 1;
    b.outstanding += left;
    buckets.set(c.category, b);
  }

  // The allocator's own order, so the list reads in the order money will be
  // applied to it.
  return [...buckets.values()].sort((a, b) => fifoRank(a.category) - fifoRank(b.category));
}

function AimDialog({
  ledger,
  onConfirm,
  onCancel,
}: {
  ledger: Ledger;
  onConfirm: (aim: { amountCents: number; categories: string[]; chargeCount: number }) => void;
  onCancel: () => void;
}) {
  const targets = useMemo(() => targetsOf(ledger), [ledger]);

  // Everything outstanding, pre-ticked — right far more often than not. What is
  // removed is the keystroke that could act on it unread, not the default.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(targets.filter((t) => t.settleable).map((t) => t.key)));
  const [typed, setTyped] = useState<string | null>(null);

  const chosen = targets.filter((t) => picked.has(t.key));
  const owed = sum(chosen.map((t) => t.outstanding));
  const cents = typed === null ? owed : Math.round(Number(typed) * 100);
  const chargeCount = sum(chosen.map((t) => t.chargeCount));
  const categories = [...new Set(chosen.map((t) => t.category))];

  const unreachable = targets.filter((t) => !t.settleable);
  const ok = cents > 0 && chosen.length > 0;

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <DialogContent
      className="max-h-[85vh] overflow-y-auto"
      aria-describedby={undefined}
      /* No implicit submit. This is not a form and Enter does nothing here —
         the confirming control has to be reached and pressed deliberately. */
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target as HTMLElement)?.closest?.("[data-confirm]")) e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Take a payment</DialogTitle>
      </DialogHeader>

      {targets.length === 0 ? (
        <p className="rounded-3xl bg-muted/40 px-4 py-3 text-sm leading-relaxed">
          Nothing is outstanding on this rental. Add a charge first if you need to take money for something new.
        </p>
      ) : (
        <div className="space-y-5">
          <Field
            label="Apply to"
            hint="The provider applies money by category, in the order shown. A payment that falls short lands on the categories nearest the top."
          >
            <ul className="divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40">
              {targets.map((t) => {
                const on = picked.has(t.key);
                return (
                  <li key={t.key}>
                    <label
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5",
                        t.settleable ? "cursor-pointer" : "cursor-not-allowed opacity-70"
                      )}
                    >
                      <Checkbox
                        checked={on}
                        disabled={!t.settleable}
                        onCheckedChange={() => t.settleable && toggle(t.key)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", !on && "text-muted-foreground")}>
                          {t.category}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            `${t.chargeCount} charge${t.chargeCount === 1 ? "" : "s"}`,
                            !t.settleable ? "the provider cannot settle this category" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-sm tabular-nums", !on && "text-muted-foreground")}>
                        {usd(t.outstanding)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Field>

          <Field label="Amount" hint={`${usd(owed)} is outstanding across what is ticked.`}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted-foreground">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={typed ?? (owed / 100).toFixed(2)}
                onChange={(e) => setTyped(e.target.value)}
                className={cn(inputCls, "pl-7 tabular-nums")}
              />
            </div>
          </Field>

          {unreachable.length > 0 && (
            <p className="rounded-3xl bg-destructive-light px-4 py-3 text-xs leading-relaxed text-destructive">
              {list(unreachable.map((t) => t.category))} {unreachable.length === 1 ? "is" : "are"} not in the
              provider&rsquo;s allocation table, so no payment can reduce{" "}
              {unreachable.length === 1 ? "it" : "them"} — {usd(sum(unreachable.map((t) => t.outstanding)))} would stay
              outstanding whatever is taken here.
            </p>
          )}

          <p className="rounded-3xl bg-muted/40 px-4 py-3 text-sm leading-relaxed">
            {!ok
              ? "Tick at least one category and enter an amount."
              : `Will open the payment window for ${usd(cents)} against ${list(
                  categories
                )}. Nothing is charged until you finish there.`}
          </p>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {/* The amount AND the count, never a bare "Confirm" — this is the last
            thing read before a real charge window opens. */}
        <Button
          data-confirm
          disabled={!ok}
          onClick={() => ok && onConfirm({ amountCents: cents, categories, chargeCount })}
        >
          {ok ? `Take ${usd(cents)} across ${chargeCount} charge${chargeCount === 1 ? "" : "s"}` : "Take a payment"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Releasing the hold — a confirm, then v1's edge function
   ══════════════════════════════════════════════════════════════════════════ */

function ReleaseDialog({ ledger, rentalId, onDone }: { ledger: Ledger; rentalId: string; onDone: () => void }) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const held = heldOn(ledger.deposit);

  const release = async () => {
    setBusy(true);
    try {
      // `supabase.functions.invoke()` does NOT throw on a non-2xx response — it
      // resolves with `{ data, error }`. Both have to be inspected or a 500
      // shows a success toast while the hold stays live on the customer's card.
      // Carried across from v1's own call site.
      const { data, error } = await supabase.functions.invoke("release-deposit-hold", {
        body: { rentalId, tenantId: tenant?.id },
      });
      if (error) {
        let detail = error.message;
        try {
          const body = await (error as any).context?.json?.();
          if (body?.error) detail = body.error;
        } catch {
          /* ignore parse errors */
        }
        throw new Error(detail);
      }
      if (data && data.success === false) throw new Error(data.error || "The hold could not be released.");
      toast({ title: "Deposit released", description: "The hold has been dropped." });
      onDone();
    } catch (err: any) {
      toast({ title: "Could not release the hold", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>Release the deposit</DialogTitle>
      </DialogHeader>
      <p className="rounded-3xl bg-muted/40 px-4 py-3 text-sm leading-relaxed">
        {held > 0
          ? `Will drop the ${usd(held)} hold through the provider. Nothing is charged, and it cannot be put back without asking the customer's card again.`
          : "Nothing is being held, so there is nothing to release."}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button data-confirm variant="destructive" disabled={held <= 0 || busy} onClick={release}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {held > 0 ? `Release ${usd(held)}` : "Release"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The row, and everything behind it
   ══════════════════════════════════════════════════════════════════════════ */

export function PaymentActions({
  ledger,
  rental,
  request,
  onClose,
  refetch,
}: {
  ledger: Ledger;
  rental: Record<string, any>;
  /** Set by the surface to open a dialog from a row. Null = nothing requested. */
  request: ActionRequest | null;
  onClose: () => void;
  refetch: () => void;
}) {
  const { tenant } = useTenant();
  const [own, setOwn] = useState<ActionRequest | null>(null);
  const active = request ?? own;

  /** The aim, once made — this is what opens v1's dialog. */
  const [aim, setAim] = useState<{ amountCents: number; categories: string[] } | null>(null);

  const t = totals(ledger);
  const deposit = ledger.deposit;
  const held = heldOn(deposit);

  const close = () => {
    setOwn(null);
    onClose();
  };

  const done = () => {
    close();
    setAim(null);
    refetch();
  };

  const refundTarget: Payment | null =
    active?.kind === "refund" ? (ledger.payments.find((p) => p.id === active.paymentId) ?? null) : null;

  /**
   * `RefundDialog` refunds ONE category. The payment's largest allocation is
   * the honest default — it is where most of this money went — and the dialog
   * itself lets the operator change the amount.
   */
  const refundCategory = useMemo(() => {
    if (!refundTarget) return "Rental";
    const byCategory = new Map<string, number>();
    for (const a of refundTarget.allocations) {
      const c = ledger.charges.find((x) => x.id === a.chargeId);
      if (!c) continue;
      byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + a.amountCents);
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    return top?.[0] ?? "Rental";
  }, [refundTarget, ledger]);

  const rentalId = String(rental.id ?? "");
  const depositHoldAmount = deposit.amountCents > 0 ? dollars(deposit.amountCents) : 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton onClick={() => setOwn({ kind: "take" })} disabled={t.outstanding === 0}>
          <CreditCard className="size-4" />
          {t.outstanding > 0 ? `Take a payment · ${usd(t.outstanding)} owed` : "Nothing owed"}
        </ActionButton>

        <ActionButton variant="outline" onClick={() => setOwn({ kind: "fine" })}>
          <Plus className="size-4" />
          Add a charge
        </ActionButton>

        {/* The deposit's own actions live beside it rather than in this row, so
            "money in" and "money frozen" never sit in the same sentence. The
            one exception is taking a deposit that has never been set up, which
            has nowhere else to be offered from. */}
        {deposit.status === "not_held" && deposit.charged === 0 && (
          <ActionButton variant="outline" onClick={() => setOwn({ kind: "deposit-take" })}>
            <ShieldCheck className="size-4" />
            Take a deposit
          </ActionButton>
        )}
      </div>

      {/* ── the aiming step ────────────────────────────────────────────── */}
      <Dialog
        open={active?.kind === "take" && !aim}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {active?.kind === "take" && !aim && (
          <AimDialog ledger={ledger} onCancel={close} onConfirm={(next) => setAim(next)} />
        )}
      </Dialog>

      {/* ── v1's payment window, opened already aimed ──────────────────── */}
      {aim && (
        <AddPaymentDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setAim(null);
              close();
            }
          }}
          rental_id={rentalId}
          customer_id={rental.customer_id ?? undefined}
          vehicle_id={rental.vehicle_id ?? undefined}
          defaultAmount={dollars(aim.amountCents)}
          targetCategories={aim.categories}
          onPaymentSuccess={(kind) => {
            // 'pending' means only a Checkout session exists — nothing has been
            // paid, so the ledger is re-read but nothing is announced as settled.
            if (kind === "recorded" || kind === "pending") done();
          }}
        />
      )}

      {/* ── refund ─────────────────────────────────────────────────────── */}
      {refundTarget && (
        <RefundDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          rentalId={rentalId}
          paymentId={refundTarget.id}
          category={refundCategory}
          totalAmount={dollars(refundTarget.amountCents)}
          paidAmount={dollars(refundTarget.amountCents - refundTarget.refundedCents)}
          onSuccess={() => done()}
        />
      )}

      {/* ── a charge that belongs to no period ─────────────────────────── */}
      {active?.kind === "fine" && (
        <AddFineDialog
          open
          onOpenChange={(o) => {
            if (!o) done();
          }}
          preselectedCustomerId={rental.customer_id ?? undefined}
          preselectedRentalId={rentalId}
          preselectedVehicleId={rental.vehicle_id ?? undefined}
        />
      )}

      {/* ── the deposit ────────────────────────────────────────────────── */}
      {active?.kind === "deposit-take" && (
        <TakeDepositDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          rentalId={rentalId}
          customerId={rental.customer_id ?? null}
          vehicleId={rental.vehicle_id ?? null}
          tenantId={tenant?.id ?? null}
          defaultAmount={Number((tenant as any)?.global_deposit_amount) || 0}
          onReady={() => done()}
        />
      )}

      {active?.kind === "deposit-hold" && (
        <AddHoldDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          rentalId={rentalId}
          customerEmail={rental.customers?.email ?? null}
          onSuccess={() => done()}
        />
      )}

      {active?.kind === "deposit-charge" && (
        <ChargeDepositDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          rentalId={rentalId}
          holdAmount={depositHoldAmount}
          holdStatus={rental.deposit_hold_status ?? null}
          holdExpiresAt={rental.deposit_hold_expires_at ?? null}
          onSuccess={() => done()}
        />
      )}

      <Dialog
        open={active?.kind === "deposit-release"}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        {active?.kind === "deposit-release" && <ReleaseDialog ledger={ledger} rentalId={rentalId} onDone={done} />}
      </Dialog>
    </>
  );
}

/** Re-exported so the surface can name the allocator's order without importing twice. */
export { FIFO_CATEGORIES };
export type { Charge };
