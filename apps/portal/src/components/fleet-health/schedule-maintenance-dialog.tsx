"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMaintenanceConflicts } from "@/hooks/use-fleet-health";
import { useScheduleMaintenance } from "@/hooks/use-maintenance-jobs";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import {
  JOB_CATEGORIES,
  JOB_PRIORITY_LABEL,
  SERVICE_TYPES,
  type JobPriority,
  type MaintenanceConflict,
} from "@/types/fleet-health";
import {
  scheduleMaintenanceSchema,
  type ScheduleMaintenanceFormValues,
} from "@/client-schemas/fleet-health/schedule-maintenance";

/** Radix Select cannot hold an empty string, so optional selects use a sentinel. */
const NONE = "__none";

const today = () => new Date().toISOString().split("T")[0];

interface ScheduleMaintenanceDialogProps {
  vehicleId: string;
  vehicleReg: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle?: string;
  ruleId?: string | null;
}

export function ScheduleMaintenanceDialog({
  vehicleId,
  vehicleReg,
  open,
  onOpenChange,
  defaultTitle,
  ruleId,
}: ScheduleMaintenanceDialogProps) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const schedule = useScheduleMaintenance();
  const [acknowledged, setAcknowledged] = useState(false);

  const form = useForm<ScheduleMaintenanceFormValues>({
    resolver: zodResolver(scheduleMaintenanceSchema),
    defaultValues: {
      title: defaultTitle ?? "",
      start: today(),
      end: today(),
      priority: "medium",
      category: NONE,
      service_type: NONE,
      vendor: "",
      notes: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: defaultTitle ?? "",
      start: today(),
      end: today(),
      priority: "medium",
      category: NONE,
      service_type: NONE,
      vendor: "",
      notes: "",
    });
    setAcknowledged(false);
    schedule.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicleId, defaultTitle]);

  const start = form.watch("start");
  const end = form.watch("end");
  const validRange = !!start && !!end && end >= start;

  const { data: conflicts = [], isFetching: conflictsLoading } = useMaintenanceConflicts(
    open && validRange ? vehicleId : undefined,
    start,
    end
  );
  const hasConflicts = conflicts.length > 0;

  // A different window is a different set of bookings — the operator has to look again.
  useEffect(() => {
    setAcknowledged(false);
  }, [start, end]);

  const error = schedule.error as { code?: string; message?: string } | null;
  const isActiveRentalBlock = error?.code === "23P03";

  const onSubmit = (values: ScheduleMaintenanceFormValues) => {
    schedule.mutate(
      {
        vehicleId,
        title: values.title.trim(),
        start: values.start,
        end: values.end,
        priority: values.priority as JobPriority,
        category: values.category === NONE ? null : (values.category ?? null),
        serviceType: values.service_type === NONE ? null : (values.service_type ?? null),
        vendor: values.vendor?.trim() ? values.vendor.trim() : null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        ruleId: ruleId ?? null,
        // Only ever true once the conflicts above have been seen and accepted.
        force: hasConflicts && acknowledged,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const submitBlocked =
    schedule.isPending || conflictsLoading || (hasConflicts && !acknowledged);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Schedule maintenance
          </DialogTitle>
          <DialogDescription>
            {vehicleReg} will be blocked from booking for the window you choose.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Job <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Annual service" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Off the road from <span className="text-red-500">*</span>
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
                name="end"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Back on the road <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(JOB_PRIORITY_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? NONE}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Not set</SelectItem>
                        {JOB_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="service_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? NONE}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Not set</SelectItem>
                        {SERVICE_TYPES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Matches the work back to its schedule.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="vendor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Garage / vendor</FormLabel>
                  <FormControl>
                    <Input placeholder="Who is doing the work?" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Anything the garage needs to know" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {conflictsLoading && validRange && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking bookings for this window...
              </p>
            )}

            {hasConflicts && (
              <ConflictPanel
                conflicts={conflicts}
                currency={currency}
                acknowledged={acknowledged}
                onAcknowledgedChange={setAcknowledged}
              />
            )}

            {isActiveRentalBlock && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-800 dark:text-red-300">
                      {error?.message}
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-400">
                      A rental that has already started cannot be overridden from here. Use the
                      vehicle swap flow on the rental to move the customer onto another vehicle
                      first, then schedule this window.
                    </p>
                    {conflicts[0]?.rental_id && (
                      <Link
                        href={`/rentals/${conflicts[0].rental_id}`}
                        className="text-xs font-medium text-[#6366f1] hover:underline"
                      >
                        Open the rental
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitBlocked}>
                {schedule.isPending
                  ? "Scheduling..."
                  : hasConflicts
                    ? `Schedule anyway (${conflicts.length} booking${conflicts.length === 1 ? "" : "s"} affected)`
                    : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ConflictPanel({
  conflicts,
  currency,
  acknowledged,
  onAcknowledgedChange,
}: {
  conflicts: MaintenanceConflict[];
  currency: string;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {conflicts.length} booking{conflicts.length === 1 ? "" : "s"} overlap this window
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Blocking the vehicle will not cancel or move them. Check what is at stake first.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li
            key={c.rental_id}
            className="rounded border border-amber-200 bg-white p-2 text-sm dark:border-amber-900 dark:bg-background"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-medium">
                {c.rental_number ? `#${c.rental_number}` : "Booking"}
                {c.customer_name ? ` · ${c.customer_name}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatRange(c.start_date, c.end_date)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Status: {c.status}</span>
              <span>Payment: {c.payment_status ?? "unknown"}</span>
              {c.monthly_amount != null && (
                <span className="font-medium text-foreground/80">
                  {formatCurrency(Number(c.monthly_amount), currency)} / month
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <label className="flex cursor-pointer items-start gap-2">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(v) => onAcknowledgedChange(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm text-amber-800 dark:text-amber-300">
          I have seen these bookings and want to block the vehicle anyway.
        </span>
      </label>
    </div>
  );
}

function formatRange(start: string, end: string | null): string {
  const fmt = (v: string) => {
    try {
      return format(parseISO(v), "d MMM yyyy");
    } catch {
      return v;
    }
  };
  return end ? `${fmt(start)} – ${fmt(end)}` : `${fmt(start)} – open ended`;
}
