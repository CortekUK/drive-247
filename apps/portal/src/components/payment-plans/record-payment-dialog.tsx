"use client";

/**
 * Record money the operator has ALREADY received against one payment.
 *
 * Nothing is charged. It becomes an ordinary payment on the rental — the same
 * row every other payment is — and settles this occurrence. The amount is the
 * one number the browser sends that the server stores as stated, because it
 * is the operator telling us what they hold (design §8).
 *
 * Not a <form>: Enter in the amount box must not record money. The button
 * states what it will do — "Record $200.00 by cash" — never a bare "Save".
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { inputCls, textareaCls } from "@/components/rentals-v2/rental-detail/_kit";
import { centsToInput, formatDay, formatMoney, parseDollarsToCents, type ISODate } from "@/lib/payment-plans-ui/format";
import { remainingOf } from "@/lib/payment-plans-ui/plan-math";
import { MANUAL_METHODS, type ManualMethod, type OccurrenceView, type RecordPaymentInput } from "@/lib/payment-plans-ui/view-types";
import { InlineDate } from "./sentence-kit";

export function RecordPaymentDialog({
  occurrence,
  currency,
  today,
  onOpenChange,
  onRecord,
}: {
  occurrence: OccurrenceView | null;
  currency: string;
  today: ISODate;
  onOpenChange: (open: boolean) => void;
  onRecord: (o: OccurrenceView, input: RecordPaymentInput) => Promise<unknown>;
}) {
  const left = occurrence ? remainingOf(occurrence) : 0;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ManualMethod>("Cash");
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!occurrence) return;
    setAmount(centsToInput(remainingOf(occurrence)));
    setMethod("Cash");
    setDate(today);
    setNote("");
    setFailed(null);
  }, [occurrence, today]);

  const cents = parseDollarsToCents(amount);
  const problem =
    cents === null || cents < 1
      ? "Enter the amount you received."
      : cents > left
        ? `That's more than the ${formatMoney(left, currency)} left on this payment. Record the rest against the next payment.`
        : date > today
          ? "The date can't be in the future — record money once you have it."
          : null;

  return (
    <Dialog open={!!occurrence} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement)?.tagName === "INPUT") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Record a payment{occurrence ? ` for #${occurrence.seq}` : ""}</DialogTitle>
          <DialogDescription>
            {occurrence
              ? `Due ${formatDay(occurrence.dueDate)} · ${formatMoney(left, currency)} outstanding. For money you've already received — nothing is charged.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Amount</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  aria-label="Amount received"
                  aria-invalid={!!problem && problem.startsWith("Enter") ? true : undefined}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={cn(inputCls, "pl-7 tabular-nums")}
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">How it was paid</span>
              <select
                aria-label="How it was paid"
                value={method}
                onChange={(e) => setMethod(e.target.value as ManualMethod)}
                className={cn(inputCls, "cursor-pointer")}
              >
                {MANUAL_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <span className="mb-1.5 block text-sm font-medium">Received on</span>
            <InlineDate label="Received on" value={date} max={today} onChange={setDate} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Note (optional)</span>
            <textarea
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. paid at the counter, receipt #1042"
              className={textareaCls}
            />
          </label>
          {problem && cents !== null && cents >= 1 && <p className="text-xs font-medium text-destructive">{problem}</p>}
          {failed && (
            <p role="alert" className="rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {failed}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            data-confirm=""
            disabled={busy || !!problem || !occurrence}
            onClick={async () => {
              if (!occurrence || cents === null || problem) return;
              setBusy(true);
              setFailed(null);
              try {
                await onRecord(occurrence, { amountCents: cents, method, date, note: note.trim() });
                onOpenChange(false);
              } catch (err) {
                setFailed(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {cents && cents > 0 ? `Record ${formatMoney(cents, currency)} by ${method.toLowerCase()}` : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
