"use client";

/**
 * Adjust balance — ONE question, "What happened?", and three different things
 * it can record (docs/PAYMENTS_ROADMAP.md, assumption A1):
 *
 *   A charge was wrong                 a credit or debit against ONE charge
 *   I received money outside the       a real payment, flagged off-platform,
 *   platform                           applied like cash
 *   Goodwill or an agreed reduction    a credit with no money behind it
 *
 * Every answer needs a reason and a note — the WHY that the history shows next
 * to WHO and WHEN. Nothing here moves money itself; see
 * hooks/use-balance-adjustments.ts for the exact existing path each one takes.
 *
 * Not a <form>: Enter does nothing, and the confirming button states the
 * effect and the amount ("Take $30.00 off"), never a bare "Save".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AuditNotSavedError,
  useAdjustableCharges,
  useBalanceActions,
  type AdjustableCharge,
  type DuplicateHint,
} from "@/hooks/use-balance-adjustments";
import {
  CORRECTION_DIRECTION,
  CORRECTION_REASONS,
  OFF_PLATFORM_METHODS,
  REASON_CODES,
  REASON_LABELS,
  WHAT_HAPPENED,
  formatCents,
  parseDollarsToCents,
  type AdjustmentKind,
} from "./balance-words";
import { BalanceField, BalanceSelect, Callout, Choice, MoneyInput, noteCls } from "./balance-kit";

/** A rental money can be put against. `refusal` = why corrections and goodwill cannot go on it. */
export interface BalanceRentalOption {
  id: string;
  label: string;
  vehicleId?: string | null;
  refusal?: string | null;
}

export interface AdjustBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName?: string | null;
  /** Rental scope: everything is on this rental. */
  rental?: BalanceRentalOption | null;
  /** Customer scope: the rentals a payment or goodwill can be put against. */
  rentals?: BalanceRentalOption[];
  currency: string;
  /** The tenant's zone, for "today" as the default payment date. */
  timeZone?: string | null;
  /** Open straight on one answer. */
  initialKind?: AdjustmentKind | null;
  onDone?: () => void;
}

type Direction = "credit" | "debit";
const ACCOUNT = "__account__";

function todayIn(timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function chargeLabel(c: AdjustableCharge, rentalLabel: string | null, currency: string): string {
  const parts = [c.category, formatCents(c.amountCents, currency)];
  if (c.remainingCents > 0 && c.remainingCents !== c.amountCents) parts.push(`${formatCents(c.remainingCents, currency)} unpaid`);
  if (c.remainingCents <= 0) parts.push("paid");
  if (rentalLabel) parts.push(rentalLabel);
  if (c.dueDate) parts.push(`due ${c.dueDate}`);
  return parts.join(" · ");
}

export function AdjustBalanceDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  rental,
  rentals = [],
  currency,
  timeZone,
  initialKind = null,
  onDone,
}: AdjustBalanceDialogProps) {
  const { toast } = useToast();
  const actions = useBalanceActions();

  const [kind, setKind] = useState<AdjustmentKind | null>(initialKind);
  const [chargeId, setChargeId] = useState("");
  const [direction, setDirection] = useState<Direction>("credit");
  const [amountText, setAmountText] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [where, setWhere] = useState<string>(rental?.id ?? "");
  const [method, setMethod] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(() => todayIn(timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHint | null>(null);
  const [auditGap, setAuditGap] = useState<string | null>(null);
  const inFlight = useRef(false);

  const scope = useMemo(() => ({ customerId, rentalId: rental?.id ?? null }), [customerId, rental?.id]);
  const { data: charges = [], isLoading: chargesLoading } = useAdjustableCharges(scope, open && kind === "charge_correction");

  useEffect(() => {
    if (!open) {
      setKind(initialKind);
      setChargeId("");
      setDirection("credit");
      setAmountText("");
      setReasonCode("");
      setNote("");
      setWhere(rental?.id ?? "");
      setMethod("Cash");
      setPaymentDate(todayIn(timeZone));
      setBusy(false);
      setError(null);
      setDuplicate(null);
      setAuditGap(null);
      inFlight.current = false;
    }
  }, [open, initialKind, rental?.id, timeZone]);

  // Rentals a correction or goodwill may go on (the balance counts their charges).
  const rentalById = useMemo(() => new Map([...(rental ? [rental] : []), ...rentals].map((r) => [r.id, r])), [rental, rentals]);
  const refusedRentalIds = useMemo(
    () => new Set([...rentalById.values()].filter((r) => r.refusal).map((r) => r.id)),
    [rentalById],
  );
  const pickableCharges = useMemo(
    () => charges.filter((c) => !c.rentalId || !refusedRentalIds.has(c.rentalId)),
    [charges, refusedRentalIds],
  );
  const charge = pickableCharges.find((c) => c.id === chargeId) ?? null;

  const cents = parseDollarsToCents(amountText);
  const rule = CORRECTION_DIRECTION[reasonCode] ?? "either";
  // The reason decides the direction where it can; the operator decides the rest.
  const effectiveDirection: Direction = kind === "charge_correction" && rule !== "either" ? rule : direction;

  const rentalRefusal = rental?.refusal ?? null;
  const offRentalId = rental ? rental.id : where === ACCOUNT ? null : where || null;
  const goodwillRentalId = rental ? rental.id : where && where !== ACCOUNT ? where : null;

  const problems: string[] = [];
  if (kind === "charge_correction") {
    if (!charge) problems.push("Pick the charge that was wrong.");
    if (cents && charge && effectiveDirection === "credit" && cents > charge.amountCents) {
      problems.push(`That is more than the charge (${formatCents(charge.amountCents, currency)}).`);
    }
  }
  if (kind === "off_platform_payment" && !rental && rentals.length > 0 && !where) {
    problems.push("Say which rental it was for, or hold it on the account.");
  }
  if (!cents) problems.push("Enter an amount, like 30 or 30.50.");
  if (!reasonCode) problems.push("Pick a reason.");
  if (!note.trim()) problems.push("Add a note: it is what the next person reads.");
  const ok = !!kind && problems.length === 0 && !busy;

  const confirmWords = (() => {
    const amount = cents ? formatCents(cents, currency) : "";
    if (kind === "charge_correction") return cents ? (effectiveDirection === "credit" ? `Take ${amount} off` : `Add ${amount}`) : "Correct the charge";
    if (kind === "off_platform_payment") return cents ? `Record ${amount} received` : "Record the payment";
    if (kind === "goodwill") return cents ? `Lower the balance by ${amount}` : "Lower the balance";
    return "Continue";
  })();

  const finish = (title: string, description: string) => {
    toast({ title, description });
    onDone?.();
    onOpenChange(false);
  };

  const submit = async (confirmedDuplicate = false) => {
    if (!kind || !cents || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (kind === "charge_correction" && charge) {
        await actions.adjust(customerId, {
          kind: "charge_correction",
          amount: cents / 100,
          direction: effectiveDirection === "credit" ? "decrease" : "increase",
          reason_code: reasonCode,
          note: note.trim(),
          charge_id: charge.id,
          rentalId: charge.rentalId,
          extensionId: charge.extensionId,
        });
        finish(
          "Charge corrected",
          `${effectiveDirection === "credit" ? "Took" : "Added"} ${formatCents(cents, currency)} ${effectiveDirection === "credit" ? "off" : "to"} the ${charge.category.toLowerCase()} charge.`,
        );
      } else if (kind === "goodwill") {
        await actions.adjust(customerId, {
          kind: "goodwill",
          amount: cents / 100,
          direction: "decrease",
          reason_code: reasonCode,
          note: note.trim(),
          rentalId: goodwillRentalId,
        });
        finish("Balance lowered", `${formatCents(cents, currency)} off what ${customerName || "the customer"} owes.`);
      } else if (kind === "off_platform_payment") {
        if (!confirmedDuplicate) {
          const hint = await actions.findRecentDuplicate(offRentalId, cents);
          if (hint) {
            setDuplicate(hint);
            return;
          }
        }
        await actions.recordOffPlatformPayment({
          customerId,
          rentalId: offRentalId,
          vehicleId: offRentalId ? rentalById.get(offRentalId)?.vehicleId : null,
          amountCents: cents,
          method,
          paymentDate,
          reasonCode,
          note: note.trim(),
        });
        finish("Payment recorded", `${formatCents(cents, currency)} received outside the platform, applied like any payment.`);
      }
    } catch (err: any) {
      if (err instanceof AuditNotSavedError) {
        setAuditGap(err.paymentId);
        setError(err.message);
        onDone?.();
      } else {
        setError(err?.message || "The change could not be saved.");
      }
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const saveNoteAgain = async () => {
    if (!auditGap || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await actions.recordOffPlatformNote(customerId, auditGap, reasonCode, note.trim());
      finish("Note saved", "The payment and its note are both on the record.");
    } catch (err: any) {
      setError(err?.message || "The note could not be saved.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  const reasonsFor = (k: AdjustmentKind) =>
    (k === "charge_correction" ? CORRECTION_REASONS : REASON_CODES[k]).map((r) => ({ value: r, label: REASON_LABELS[r] ?? r }));

  const rentalOptions = rentals.map((r) => ({ value: r.id, label: r.label }));
  const goodwillRentalOptions = rentals.filter((r) => !r.refusal).map((r) => ({ value: r.id, label: r.label }));

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto no-scrollbar sm:max-w-lg"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "TEXTAREA" && !(e.target as HTMLElement)?.closest?.("[data-confirm]")) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-heading">Adjust balance</DialogTitle>
          <DialogDescription>
            {rental ? `On ${rental.label}. ` : customerName ? `${customerName}'s account. ` : ""}
            Every change is kept with who made it, when and why. Nothing is ever edited or deleted — an undo is a new entry.
          </DialogDescription>
        </DialogHeader>

        {!kind ? (
          <div className="space-y-2" role="group" aria-label="What happened?">
            <p className="text-sm font-medium">What happened?</p>
            {WHAT_HAPPENED.map((w) => {
              const blocked = w.kind !== "off_platform_payment" && !!rentalRefusal;
              return (
                <button
                  key={w.kind}
                  type="button"
                  data-kind={w.kind}
                  disabled={blocked}
                  onClick={() => {
                    setKind(w.kind);
                    setReasonCode("");
                  }}
                  className={cn(
                    "w-full rounded-4xl px-5 py-4 text-left ring-1 transition-all",
                    blocked
                      ? "cursor-not-allowed bg-muted/40 opacity-60 ring-foreground/5"
                      : "cursor-pointer bg-card shadow-md ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10",
                  )}
                >
                  <span className="block font-heading text-sm font-medium">{w.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {blocked ? rentalRefusal : w.detail}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setKind(null);
                setError(null);
                setDuplicate(null);
              }}
              className="-mt-2 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              {WHAT_HAPPENED.find((w) => w.kind === kind)?.title}
            </button>

            {kind === "charge_correction" && (
              <BalanceField
                label="Which charge?"
                htmlFor="adjust-charge"
                hint="The charge itself stays exactly as it was. The correction is a new line beside it, tied to it."
              >
                {chargesLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Reading the charges…
                  </p>
                ) : pickableCharges.length === 0 ? (
                  <Callout>There are no charges here to correct.</Callout>
                ) : (
                  <BalanceSelect
                    id="adjust-charge"
                    value={chargeId}
                    onChange={setChargeId}
                    placeholder="Pick a charge"
                    options={pickableCharges.map((c) => ({
                      value: c.id,
                      label: chargeLabel(c, rental ? null : (c.rentalId ? rentalById.get(c.rentalId)?.label ?? null : "on the account"), currency),
                    }))}
                  />
                )}
              </BalanceField>
            )}

            {kind === "off_platform_payment" && !rental && (
              <BalanceField
                label="Which rental was it for?"
                htmlFor="adjust-where"
                hint="It pays off that rental's charges in the usual order. Held on the account, it waits as credit."
              >
                <BalanceSelect
                  id="adjust-where"
                  value={where}
                  onChange={setWhere}
                  placeholder={rentals.length ? "Pick a rental" : undefined}
                  options={[...rentalOptions, { value: ACCOUNT, label: "Hold it on the account" }]}
                />
              </BalanceField>
            )}

            {kind === "goodwill" && !rental && (
              <BalanceField label="Where does it go?" htmlFor="adjust-where">
                <BalanceSelect
                  id="adjust-where"
                  value={where || ACCOUNT}
                  onChange={setWhere}
                  options={[{ value: ACCOUNT, label: "The customer account" }, ...goodwillRentalOptions]}
                />
              </BalanceField>
            )}

            <BalanceField label="Reason" htmlFor="adjust-reason">
              <BalanceSelect id="adjust-reason" value={reasonCode} onChange={setReasonCode} placeholder="Pick a reason" options={reasonsFor(kind)} />
            </BalanceField>

            {kind === "charge_correction" && (
              <BalanceField label="Which way?">
                <Choice<Direction>
                  label="Which way?"
                  value={effectiveDirection}
                  onChange={setDirection}
                  options={[
                    { value: "credit", label: "Take money off", disabled: rule === "debit" },
                    { value: "debit", label: "Add to it", disabled: rule === "credit" },
                  ]}
                />
              </BalanceField>
            )}

            <div className={cn("grid gap-4", kind === "off_platform_payment" && "sm:grid-cols-2")}>
              <BalanceField label="Amount" htmlFor="adjust-amount">
                <MoneyInput id="adjust-amount" value={amountText} onChange={setAmountText} />
              </BalanceField>
              {kind === "off_platform_payment" && (
                <BalanceField label="Received on" htmlFor="adjust-date">
                  <input
                    id="adjust-date"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                  />
                </BalanceField>
              )}
            </div>

            {kind === "off_platform_payment" && (
              <BalanceField label="How was it paid?" htmlFor="adjust-method">
                <BalanceSelect id="adjust-method" value={method} onChange={setMethod} options={OFF_PLATFORM_METHODS.map((m) => ({ value: m, label: m }))} />
              </BalanceField>
            )}

            <BalanceField label="Note" htmlFor="adjust-note" hint="Internal — the customer never sees it.">
              <textarea
                id="adjust-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  kind === "off_platform_payment"
                    ? "e.g. Paid cash at the desk on return"
                    : kind === "goodwill"
                      ? "e.g. Car was two hours late at pickup"
                      : "e.g. Charged the daily rate; they booked weekly"
                }
                className={noteCls}
              />
            </BalanceField>

            {kind === "off_platform_payment" && (
              <Callout>
                This counts as money received, like cash: it pays off charges in the usual order and shows as
                &ldquo;Off-platform&rdquo; wherever payments are listed. No card provider is involved.
              </Callout>
            )}

            {duplicate && (
              <Callout tone="primary">
                <p className="font-medium">This may be a duplicate.</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {formatCents(duplicate.amountCents, currency)} was already recorded on this rental
                  {duplicate.paymentDate ? ` on ${duplicate.paymentDate}` : ""}
                  {duplicate.method ? ` (${duplicate.method})` : ""}. Record this one as well?
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDuplicate(null)} disabled={busy}>
                    No, go back
                  </Button>
                  <Button size="sm" data-confirm onClick={() => void submit(true)} disabled={busy}>
                    Yes, record it
                  </Button>
                </div>
              </Callout>
            )}

            {error && (
              <Callout tone="destructive">
                <p>{error}</p>
                {auditGap && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => void saveNoteAgain()} disabled={busy}>
                    Save the note again
                  </Button>
                )}
              </Callout>
            )}

            {!error && !duplicate && problems.length > 0 && (amountText || note || reasonCode || chargeId) && (
              <p className="text-xs text-muted-foreground">{problems[0]}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {auditGap ? "Close" : "Cancel"}
          </Button>
          {kind && !auditGap && !duplicate && (
            <Button data-confirm disabled={!ok} onClick={() => void submit(false)}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {confirmWords}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
