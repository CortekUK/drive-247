"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useFleetList } from "@/hooks/use-fleet-list";
import { useBookingStore } from "@/stores/booking-store";
import { enquirySchema, type EnquiryFormValues } from "@/client-schemas/enquiry";

const ANY_VEHICLE = "__any__";

interface EnquiryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional vehicle to preselect (e.g. user clicked "Enquire" on a specific car) */
  defaultVehicleId?: string | null;
}

export function EnquiryModal({ open, onOpenChange, defaultVehicleId }: EnquiryModalProps) {
  const { tenant, tenantSlug } = useTenant();
  const { context } = useBookingStore();
  const { data: fleet, loading: fleetLoading } = useFleetList();

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const initialValues = useMemo<EnquiryFormValues>(
    () => ({
      name: context.customerName ?? "",
      email: context.customerEmail ?? "",
      phone: context.customerPhone ?? "",
      vehicleId: defaultVehicleId ?? null,
      startDate: context.pickupDate ?? "",
      endDate: context.returnDate ?? "",
      description: "",
      hpField: "",
    }),
    [context, defaultVehicleId]
  );

  const [form, setForm] = useState<EnquiryFormValues>(initialValues);

  // Reset state whenever the modal opens
  useEffect(() => {
    if (open) {
      setForm(initialValues);
      setErrors({});
      setSuccess(false);
    }
  }, [open, initialValues]);

  const setField = <K extends keyof EnquiryFormValues>(key: K, value: EnquiryFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setErrors({});
    const parsed = enquirySchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const path = issue.path[0]?.toString();
        if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-enquiry", {
        body: {
          ...parsed.data,
          tenantSlug: tenantSlug ?? tenant?.slug,
          source: "booking_site",
        },
        headers: tenantSlug || tenant?.slug
          ? { "x-tenant-slug": (tenantSlug ?? tenant?.slug) as string }
          : undefined,
      });

      if (error) {
        const msg = error.message || "Failed to submit enquiry. Please try again.";
        toast.error(msg);
        return;
      }
      if (data && (data as { error?: string }).error) {
        toast.error((data as { error: string }).error);
        return;
      }

      setSuccess(true);
      toast.success("Enquiry submitted — we'll be in touch shortly.");
    } catch (err) {
      console.error("submit-enquiry invoke error", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!tenant) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {success ? (
          <div className="py-8 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-center">Enquiry submitted</DialogTitle>
              <DialogDescription className="text-center">
                Thank you. The team will reach out to you by email or phone shortly to discuss
                availability for your dates.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Submit an enquiry</DialogTitle>
              <DialogDescription>
                Tell us which car and dates you're interested in. We'll get back to you about
                availability — even if your dates aren't bookable online.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Honeypot — hidden from real users */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "-10000px",
                  top: "auto",
                  width: "1px",
                  height: "1px",
                  overflow: "hidden",
                }}
              >
                <label htmlFor="hp-field">Leave this field empty</label>
                <input
                  id="hp-field"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.hpField ?? ""}
                  onChange={(e) => setField("hpField", e.target.value)}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Full name" error={errors.name} required>
                  <Input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    autoComplete="name"
                  />
                </Field>
                <Field label="Phone" error={errors.phone} required>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    autoComplete="tel"
                  />
                </Field>
              </div>

              <Field label="Email" error={errors.email} required>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  autoComplete="email"
                />
              </Field>

              <Field label="Vehicle of interest" error={errors.vehicleId}>
                <Select
                  value={form.vehicleId ?? ANY_VEHICLE}
                  onValueChange={(v) => setField("vehicleId", v === ANY_VEHICLE ? null : v)}
                  disabled={fleetLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={fleetLoading ? "Loading…" : "Pick a vehicle"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ANY_VEHICLE}>Any vehicle</SelectItem>
                    {fleet.map((v) => {
                      const label = [v.make, v.model].filter(Boolean).join(" ") || v.reg;
                      return (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="flex items-center gap-2">
                            <span>{label}</span>
                            <span className="text-xs text-muted-foreground">{v.reg}</span>
                            {v.is_currently_booked && (
                              <span className="text-xs text-amber-600">• currently booked</span>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Start date" error={errors.startDate} required>
                  <Input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setField("startDate", e.target.value)}
                  />
                </Field>
                <Field label="End date" error={errors.endDate} required>
                  <Input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setField("endDate", e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Description" error={errors.description} required>
                <Textarea
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Let us know any details — preferred pickup/return location, why this car, flexibility on dates…"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {form.description.length} / 2000
                </p>
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit enquiry"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required && " *"}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
