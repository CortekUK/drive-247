'use client';

/**
 * Shorten or remove an extension — the operator's own undo for Extend.
 *
 * Runs `operator_adjust_extension` (supabase/migrations/
 * 20261023180000_operator_rental_date_adjustments.sql). Only the latest live
 * extension can be changed, so the periods never get a hole between them; the
 * rental's end date follows.
 *
 * Money: what was paid is never touched — no refund, no credit. Removing an
 * extension that still has money owing offers one choice: cancel that unpaid
 * part too, so the customer stops owing it. Shortening leaves the charges as
 * they are; a partial refund is the payments flow's job.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarMinus, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RentalDateRangePicker } from "@/components/shared/forms/rental-date-picker";
import { useVehicleBookedDates } from "@/hooks/use-vehicle-booked-dates";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format-utils";
import { formatLocalDate, parseLocalDate } from "@/lib/date-utils";

export interface AdjustableExtension {
  id: string;
  sequence_number: number | string;
  previous_end_date: string;
  new_end_date: string;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  outstanding_amount?: number | string | null;
}

interface AdjustExtensionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  vehicleId?: string | null;
  extension: AdjustableExtension | null;
  currencyCode?: string;
}

const addDays = (iso: string, n: number) => {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + n);
  return format(d, "yyyy-MM-dd");
};

export function AdjustExtensionDialog({
  open,
  onOpenChange,
  rentalId,
  vehicleId,
  extension,
  currencyCode = "USD",
}: AdjustExtensionDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"remove" | "shorten">("remove");
  const [newEnd, setNewEnd] = useState("");
  const [dropUnpaid, setDropUnpaid] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("remove");
      setNewEnd("");
      setDropUnpaid(false);
    }
  }, [open]);

  const { occupancyMap, occupancyModifiers } = useVehicleBookedDates(vehicleId ?? undefined, rentalId);

  const owed = Number(extension?.outstanding_amount ?? 0);
  const paid = Number(extension?.paid_amount ?? 0);
  const days = extension
    ? Math.round((parseLocalDate(extension.new_end_date).getTime() - parseLocalDate(extension.previous_end_date).getTime()) / 86_400_000)
    : 0;
  // A one-day extension cannot be shortened, only removed.
  const canShorten = days > 1;
  const target = mode === "remove" ? extension?.previous_end_date ?? "" : newEnd;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!extension) throw new Error("No extension selected");
      const { data, error } = await (supabase.rpc as any)("operator_adjust_extension", {
        p_extension_id: extension.id,
        p_new_end_date: target,
        p_drop_unpaid: mode === "remove" && dropUnpaid,
      });
      if (error) throw new Error(error.message);
      return data as { removed: boolean; end_date: string; unpaid_written_off: number };
    },
    onSuccess: (result) => {
      toast({
        title: result.removed ? `Extension #${extension?.sequence_number} removed` : `Extension #${extension?.sequence_number} shortened`,
        description: `The rental now ends ${formatLocalDate(result.end_date)}.${
          Number(result.unpaid_written_off) > 0
            ? ` ${formatCurrency(Number(result.unpaid_written_off), currencyCode)} unpaid was cancelled.`
            : ""
        }`,
      });
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not change the extension",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  if (!extension) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarMinus className="h-5 w-5 text-primary" />
            Change extension #{extension.sequence_number}
          </DialogTitle>
          <DialogDescription>
            {formatLocalDate(extension.previous_end_date)} → {formatLocalDate(extension.new_end_date)} · {days} day
            {days === 1 ? "" : "s"}
            {extension.total_amount != null && ` · ${formatCurrency(Number(extension.total_amount), currencyCode)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "remove" | "shorten")} className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="remove" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">Remove the extension</span>
                <span className="block text-xs text-muted-foreground">
                  The rental goes back to ending {formatLocalDate(extension.previous_end_date)}.
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-3 ${canShorten ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
              <RadioGroupItem value="shorten" className="mt-0.5" disabled={!canShorten} />
              <span>
                <span className="block text-sm font-medium">Shorten it</span>
                <span className="block text-xs text-muted-foreground">
                  {canShorten ? "Pick the day the rental now ends." : "A one-day extension can only be removed."}
                </span>
              </span>
            </label>
          </RadioGroup>

          {mode === "shorten" && (
            <div className="space-y-2">
              <Label>New end date</Label>
              <RentalDateRangePicker
                mode="end-only"
                startDate={parseLocalDate(extension.previous_end_date)}
                endDate={newEnd ? parseLocalDate(newEnd) : undefined}
                onEndDateChange={(date) => setNewEnd(date ? format(date, "yyyy-MM-dd") : "")}
                disableDate={(date) => {
                  const d = format(date, "yyyy-MM-dd");
                  return d < addDays(extension.previous_end_date, 1) || d >= extension.new_end_date;
                }}
                occupancyMap={occupancyMap}
                occupancyModifiers={occupancyModifiers}
                title="Select the new end date"
              />
            </div>
          )}

          {mode === "remove" && owed > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <Checkbox checked={dropUnpaid} onCheckedChange={(v) => setDropUnpaid(v === true)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  Also cancel the {formatCurrency(owed, currencyCode)} still unpaid on it
                </span>
                <span className="block text-xs text-muted-foreground">
                  The customer will no longer owe it. Leave this off to keep it owing.
                </span>
              </span>
            </label>
          )}

          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {paid > 0
                ? `The ${formatCurrency(paid, currencyCode)} already paid stays as it is: nothing is refunded and no credit is created.`
                : "Nothing has been paid on this extension."}{" "}
              To give money back, refund it from the rental's payments.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={mode === "remove" ? "destructive" : "default"}
            onClick={() => mutation.mutate()}
            disabled={!target || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : mode === "remove" ? "Remove extension" : "Shorten extension"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
