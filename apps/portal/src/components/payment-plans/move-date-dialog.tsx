"use client";

/**
 * Move one payment's due date. The payment keeps covering the same days and
 * keeps its amount — only the day it is collected changes — and the dialog
 * says so before anything is saved.
 */

import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Calendar } from "@/components/ui-v2/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { addDays, dateToIso, formatCovers, formatDay, formatMoney, isoToDate, type ISODate } from "@/lib/payment-plans-ui/format";
import type { OccurrenceView } from "@/lib/payment-plans-ui/view-types";

export function MoveDateDialog({
  occurrence,
  currency,
  today,
  onOpenChange,
  onMove,
}: {
  occurrence: OccurrenceView | null;
  currency: string;
  today: ISODate;
  onOpenChange: (open: boolean) => void;
  onMove: (o: OccurrenceView, to: ISODate) => Promise<unknown>;
}) {
  const [to, setTo] = useState<ISODate | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The earliest a payment can move to is tomorrow: moving it to today (or
  // earlier) would just make it due at once.
  const min = addDays(today, 1);

  useEffect(() => {
    setTo(null);
    setFailed(null);
  }, [occurrence]);

  return (
    <Dialog open={!!occurrence} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move payment{occurrence ? ` #${occurrence.seq}` : ""}</DialogTitle>
          <DialogDescription>
            {occurrence ? `Now due ${formatDay(occurrence.dueDate)}. Pick the day it should be collected instead.` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
          <Calendar
            mode="single"
            weekStartsOn={1}
            selected={to ? isoToDate(to) : undefined}
            defaultMonth={occurrence ? isoToDate(occurrence.dueDate) : undefined}
            disabled={(d: Date) => dateToIso(d) < min || (!!occurrence && dateToIso(d) === occurrence.dueDate)}
            onSelect={(d: Date | undefined) => d && setTo(dateToIso(d))}
          />
        </div>
        {occurrence && to && (
          <p className="text-sm leading-relaxed" data-move-summary="">
            <span className="font-medium">{formatDay(occurrence.dueDate)}</span> <ArrowRight className="inline size-3.5 text-muted-foreground" />{" "}
            <span className="font-medium">{formatDay(to)}</span>
            <span className="text-muted-foreground">
              {" "}
              — still covers {formatCovers(occurrence.periodStart, occurrence.periodEnd)} and is still{" "}
              {formatMoney(occurrence.amountCents, currency)}.
            </span>
          </p>
        )}
        {failed && (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
            {failed}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            data-confirm=""
            disabled={busy || !to || !occurrence}
            onClick={async () => {
              if (!occurrence || !to) return;
              setBusy(true);
              setFailed(null);
              try {
                await onMove(occurrence, to);
                onOpenChange(false);
              } catch (err) {
                setFailed(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {to ? `Move to ${formatDay(to)}` : "Pick a day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
