"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReportMaintenanceIssue } from "@/hooks/use-maintenance-jobs";
import { JOB_CATEGORIES, JOB_PRIORITY_LABEL, type JobPriority } from "@/types/fleet-health";
import {
  reportIssueSchema,
  type ReportIssueFormValues,
} from "@/client-schemas/fleet-health/report-issue";

const NONE = "__none";

interface ReportIssueDialogProps {
  vehicleId: string;
  /** Set when the fault was found on a live rental, so the job carries the link. */
  rentalId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleReg?: string;
}

/**
 * Deliberately the shortest form in the module: a fault noticed on the forecourt
 * has to be filable in two taps, or it gets remembered instead of recorded.
 */
export function ReportIssueDialog({
  vehicleId,
  rentalId,
  open,
  onOpenChange,
  vehicleReg,
}: ReportIssueDialogProps) {
  const report = useReportMaintenanceIssue();

  const form = useForm<ReportIssueFormValues>({
    resolver: zodResolver(reportIssueSchema),
    defaultValues: { title: "", priority: "medium", category: NONE, notes: "" },
  });

  useEffect(() => {
    if (open) form.reset({ title: "", priority: "medium", category: NONE, notes: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vehicleId]);

  const onSubmit = (values: ReportIssueFormValues) => {
    report.mutate(
      {
        vehicleId,
        title: values.title.trim(),
        priority: values.priority as JobPriority,
        category: values.category === NONE ? null : (values.category ?? null),
        notes: values.notes?.trim() ? values.notes.trim() : null,
        rentalId: rentalId ?? null,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Report an issue
          </DialogTitle>
          <DialogDescription>
            {vehicleReg ? `${vehicleReg} — ` : ""}
            Adds a job to the maintenance list. It does not take the vehicle off the road.
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
                    What is wrong? <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="e.g. Nearside rear tyre worn" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Optional detail"
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
              <Button type="submit" disabled={report.isPending}>
                {report.isPending ? "Reporting..." : "Report issue"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
