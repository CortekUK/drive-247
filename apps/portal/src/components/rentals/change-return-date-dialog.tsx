'use client';

/**
 * Change a rental's return date — dates only, either way, Closed rentals too.
 *
 * Pickup/return dates are locked in edit-pickup-return-dialog.tsx because they
 * drive price, insurance and the agreement. This is the deliberate way round
 * that lock for the cases operators actually hit: the car came back early, or
 * the customer kept it longer and was paid outside the portal (Moore Luxe,
 * Oct 23 2026, had to ask support for both).
 *
 * It runs `operator_change_rental_end_date` (supabase/migrations/
 * 20261023180000_operator_rental_date_adjustments.sql), which never touches
 * money: an earlier date shortens or removes the extensions that ran past it,
 * a later one adds no charge. Charging or refunding stays the operator's own
 * step, and the dialog says so before they confirm.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarClock, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { formatLocalDate, parseLocalDate } from "@/lib/date-utils";

interface ExtensionLike {
  id: string;
  sequence_number: number | string;
  status?: string | null;
  previous_end_date?: string | null;
  new_end_date?: string | null;
}

interface ChangeReturnDateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string | null;
    vehicle_id?: string | null;
    status?: string | null;
  };
  extensions?: ExtensionLike[];
}

const live = (e: ExtensionLike) => e.status !== "cancelled" && e.status !== "refunded";

export function ChangeReturnDateDialog({ open, onOpenChange, rental, extensions = [] }: ChangeReturnDateDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newEnd, setNewEnd] = useState<string>("");

  useEffect(() => {
    if (open) setNewEnd("");
  }, [open]);

  const { occupancyMap, occupancyModifiers } = useVehicleBookedDates(rental.vehicle_id ?? undefined, rental.id);

  // What the earlier date does to the extensions, worked out here so the
  // operator sees it before confirming. The database does the same walk.
  const effects = useMemo(() => {
    if (!newEnd) return [];
    return extensions
      .filter(live)
      .filter((e) => e.new_end_date && e.new_end_date > newEnd)
      .sort((a, b) => Number(b.sequence_number) - Number(a.sequence_number))
      .map((e) =>
        e.previous_end_date && e.previous_end_date >= newEnd
          ? `Extension #${e.sequence_number} is removed`
          : `Extension #${e.sequence_number} now ends ${formatLocalDate(newEnd)}`,
      );
  }, [extensions, newEnd]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("operator_change_rental_end_date", {
        p_rental_id: rental.id,
        p_new_end_date: newEnd,
      });
      if (error) throw new Error(error.details ? `${error.message} ${error.details}` : error.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Return date changed", description: `The rental now ends ${formatLocalDate(newEnd)}.` });
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not change the return date",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const later = !!newEnd && !!rental.end_date && newEnd > rental.end_date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Change return date
          </DialogTitle>
          <DialogDescription>
            Currently {formatLocalDate(rental.end_date)}. Pickup was {formatLocalDate(rental.start_date)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New return date</Label>
            <RentalDateRangePicker
              mode="end-only"
              startDate={parseLocalDate(rental.start_date)}
              endDate={newEnd ? parseLocalDate(newEnd) : undefined}
              onEndDateChange={(date) => setNewEnd(date ? format(date, "yyyy-MM-dd") : "")}
              disableDate={(date) => {
                const min = parseLocalDate(rental.start_date);
                const d = new Date(date);
                d.setHours(0, 0, 0, 0);
                return d <= min;
              }}
              occupancyMap={occupancyMap}
              occupancyModifiers={occupancyModifiers}
              title="Select the return date"
            />
          </div>

          {effects.length > 0 && (
            <div className="rounded-lg border p-3 text-sm">
              <p className="mb-1 font-medium">Extensions</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {effects.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Only the dates change. Charges and payments stay exactly as they are
              {later ? ", so the extra days are not billed. To charge for them, use Extend instead." : ", so nothing is refunded."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!newEnd || newEnd === rental.end_date || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Change return date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
