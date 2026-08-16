"use client";

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
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
import { useCompleteMaintenanceJob } from "@/hooks/use-maintenance-jobs";
import { useFleetHealth } from "@/hooks/use-fleet-health";
import { useTenant } from "@/contexts/TenantContext";
import { getCurrencySymbol, getDistanceUnitLong, type DistanceUnit } from "@/lib/format-utils";
import type { MaintenanceJob } from "@/types/fleet-health";
import {
  completeJobSchema,
  type CompleteJobFormValues,
} from "@/client-schemas/fleet-health/complete-job";

const today = () => new Date().toISOString().split("T")[0];

interface CompleteJobDialogProps {
  job: MaintenanceJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CompleteJobDialog({ job, open, onOpenChange }: CompleteJobDialogProps) {
  const { tenant } = useTenant();
  const unit: DistanceUnit = tenant?.distance_unit ?? "miles";
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || "USD");
  const complete = useCompleteMaintenanceJob();

  // Reuse the already-cached fleet rows rather than refetching one vehicle.
  const { data: fleet = [] } = useFleetHealth();
  const currentMileage = useMemo(
    () => fleet.find((v) => v.vehicle_id === job?.vehicle_id)?.current_mileage ?? null,
    [fleet, job?.vehicle_id]
  );

  const form = useForm<CompleteJobFormValues>({
    resolver: zodResolver(completeJobSchema),
    defaultValues: {
      service_date: today(),
      mileage: undefined,
      cost: 0,
      description: "",
    },
  });

  useEffect(() => {
    if (!open || !job) return;
    form.reset({
      service_date: today(),
      mileage: currentMileage ?? undefined,
      cost: 0,
      description: job.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id, currentMileage]);

  if (!job) return null;

  const vehicleLabel = job.vehicles?.reg ?? "This vehicle";

  const onSubmit = (values: CompleteJobFormValues) => {
    complete.mutate(
      {
        jobId: job.id,
        serviceDate: values.service_date,
        mileage: values.mileage ?? null,
        cost: values.cost,
        description: values.description?.trim() ? values.description.trim() : null,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Complete job
          </DialogTitle>
          <DialogDescription>
            {job.title} · {vehicleLabel}
            {job.service_type ? ` · ${job.service_type}` : ""}
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] p-3 text-xs text-muted-foreground dark:border-border dark:bg-muted/40">
          Completing this job writes a service-history record against {vehicleLabel} and posts the
          cost to your P&amp;L automatically — you do not need to log it again as an expense.
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Odometer first and largest: it re-baselines every mileage schedule on
                this vehicle, and is the only field here with downstream consequences. */}
            <FormField
              control={form.control}
              name="mileage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Odometer at the time of the work ({getDistanceUnitLong(unit)})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      step={1}
                      min={0}
                      placeholder={currentMileage != null ? String(currentMileage) : "0"}
                      className="h-14 text-center text-2xl font-medium tracking-tight"
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  </FormControl>
                  <FormDescription>
                    {currentMileage != null
                      ? `Last known reading: ${currentMileage.toLocaleString()}. This resets the mileage countdown for every schedule on the vehicle.`
                      : "No reading has been recorded for this vehicle yet — entering one here starts its mileage schedules."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="service_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Date of work <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost ({currencySymbol})</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        placeholder="0.00"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? 0 : e.target.valueAsNumber)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What was done</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Parts replaced, advisories, anything worth keeping on record"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={complete.isPending}>
                {complete.isPending ? "Saving..." : "Complete job"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
