"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Gauge } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useOdometerReadings, useRecordOdometer } from "@/hooks/use-vehicle-odometer";
import { useTenant } from "@/contexts/TenantContext";
import {
  recordOdometerSchema,
  type RecordOdometerFormValues,
} from "@/client-schemas/fleet-health/record-odometer";
import type { DistanceUnit } from "@/lib/format-utils";
import { getDistanceUnitLong } from "@/lib/format-utils";
import type { OdometerSource } from "@/types/fleet-health";

const SOURCE_LABEL: Record<OdometerSource, string> = {
  handover: "Key handover",
  manual: "Entered manually",
  customer: "Reported by customer",
  telematics: "Telematics",
  service: "Service record",
  import: "Imported",
};

interface RecordOdometerDialogProps {
  vehicleId: string;
  currentMileage: number | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown in the header so a run through the setup list stays oriented. */
  vehicleLabel?: string;
}

export function RecordOdometerDialog({
  vehicleId,
  currentMileage,
  open,
  onOpenChange,
  vehicleLabel,
}: RecordOdometerDialogProps) {
  const { tenant } = useTenant();
  const unit: DistanceUnit = tenant?.distance_unit ?? "miles";
  const unitLabel = getDistanceUnitLong(unit);

  const record = useRecordOdometer();
  const { data: readings = [] } = useOdometerReadings(open ? vehicleId : undefined, 5);

  const form = useForm<RecordOdometerFormValues>({
    resolver: zodResolver(recordOdometerSchema),
    defaultValues: { reading: currentMileage ?? undefined, note: "" },
  });

  // Reopening for a different vehicle must not carry the previous prefill over.
  useEffect(() => {
    if (open) form.reset({ reading: currentMileage ?? undefined, note: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicleId, currentMileage]);

  const reading = form.watch("reading");

  // A drop below the last known reading is almost always a typo, but it is also
  // how a genuinely wrong cached value gets corrected — so it is allowed, flagged.
  const isCorrection =
    currentMileage != null &&
    typeof reading === "number" &&
    Number.isFinite(reading) &&
    reading < currentMileage;

  const onSubmit = (values: RecordOdometerFormValues) => {
    record.mutate(
      {
        vehicleId,
        reading: values.reading,
        source: "manual",
        note: values.note?.trim() ? values.note.trim() : null,
        isSuspect: isCorrection,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Record odometer reading
          </DialogTitle>
          <DialogDescription>
            {vehicleLabel ? `${vehicleLabel} · ` : ""}
            {currentMileage != null
              ? `Last known: ${currentMileage.toLocaleString()} ${unitLabel}.`
              : `No reading has ever been recorded for this vehicle.`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reading"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reading ({unitLabel})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      step={1}
                      min={0}
                      placeholder="0"
                      className="h-16 text-center text-3xl font-medium tracking-tight"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        // Blank must become undefined, not NaN, or the resolver
                        // reports a type error instead of "enter a reading".
                        field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isCorrection && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      This is lower than the last known reading of{" "}
                      {currentMileage!.toLocaleString()} {unitLabel} — save as a correction?
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      It will be kept in the history and flagged, but it will not move the
                      vehicle&apos;s mileage or reset any service interval.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isCorrection && (
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Why is it lower?</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="e.g. previous reading was keyed in wrong"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>Optional, but it saves guessing later.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={record.isPending}>
                {record.isPending
                  ? "Saving..."
                  : isCorrection
                    ? "Save as a correction"
                    : "Save reading"}
              </Button>
            </DialogFooter>
          </form>
        </Form>

        {readings.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent readings
              </p>
              <ul className="space-y-1.5">
                {readings.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="tabular-nums">
                      {r.reading.toLocaleString()} {r.unit === "km" ? "km" : "mi"}
                      {r.is_suspect && (
                        <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                          Flagged
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {SOURCE_LABEL[r.source] ?? r.source} ·{" "}
                      {safeDate(r.observed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function safeDate(value: string): string {
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value;
  }
}
