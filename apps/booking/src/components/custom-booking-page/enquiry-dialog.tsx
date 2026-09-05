"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useFleetList } from "@/hooks/use-fleet-list";
import { useBookingStore } from "@/stores/booking-store";
import { enquirySchema, type EnquiryFormValues } from "@/client-schemas/enquiry";
import { displayRegistration, vehicleDisplayName } from "@/lib/vehicle-identity";
import { CbpModal } from "./modal";
import { CbpSelect } from "./field-ui";
import { Icon } from "./icons";

/* ========================================================================== *
 * Enquiry — this site's design over the existing implementation.
 *
 * Same fields, same `enquirySchema`, same `submit-enquiry` edge function, and
 * the same three layers of duplicate protection the existing modal relies on:
 *
 *   1. the in-flight guard, so a double-click cannot post twice
 *   2. the honeypot field, which the function rejects server-side
 *   3. the function's own dedup, which folds a repeat enquiry from the same
 *      phone or email into the open lead rather than opening another
 *
 * The tenant is carried both ways the function accepts it — the `x-tenant-slug`
 * header and `tenantSlug` in the body — so an enquiry can only ever land on the
 * site it was sent from.
 * ========================================================================== */

const ANY_VEHICLE = "__any__";

export function CbpEnquiryDialog({
  open, onOpenChange, defaultVehicleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects a vehicle when the visitor enquired from a specific one. */
  defaultVehicleId?: string | null;
}) {
  const { tenant, tenantSlug } = useTenant();
  const { context } = useBookingStore();
  const { data: fleet, loading: fleetLoading } = useFleetList();

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Anything the visitor already told the booking form is carried over, so an
  // enquiry raised mid-booking does not ask for it twice.
  const initial = useMemo<EnquiryFormValues>(() => ({
    name: context.customerName ?? "",
    email: context.customerEmail ?? "",
    phone: context.customerPhone ?? "",
    vehicleId: defaultVehicleId ?? null,
    startDate: context.pickupDate ?? "",
    endDate: context.returnDate ?? "",
    description: "",
    hpField: "",
  }), [context, defaultVehicleId]);

  const [form, setForm] = useState<EnquiryFormValues>(initial);

  useEffect(() => {
    if (!open) return;
    setForm(initial);
    setErrors({});
    setDone(false);
  }, [open, initial]);

  const set = <K extends keyof EnquiryFormValues>(key: K, value: EnquiryFormValues[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // in-flight guard — a second click does nothing

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
      const slug = tenantSlug ?? tenant?.slug;
      const { data, error } = await supabase.functions.invoke("submit-enquiry", {
        body: { ...parsed.data, tenantSlug: slug, source: "booking_site" },
        headers: slug ? { "x-tenant-slug": slug } : undefined,
      });

      if (error) {
        toast.error(error.message || "Failed to submit inquiry. Please try again.");
        return;
      }
      if (data && (data as { error?: string }).error) {
        toast.error((data as { error: string }).error);
        return;
      }

      setDone(true);
      toast.success("Inquiry submitted — we'll be in touch shortly.");
    } catch (err) {
      console.error("submit-enquiry invoke error", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!tenant) return null;

  const vehicleOptions = [
    { value: ANY_VEHICLE, label: "Any vehicle" },
    ...fleet.map(v => ({
      value: v.id,
      label: vehicleDisplayName(v, tenant),
      sub: [displayRegistration(v, tenant), v.is_currently_booked ? "currently booked" : null]
        .filter(Boolean).join(" · ") || undefined,
    })),
  ];

  return (
    <CbpModal
      open={open}
      onOpenChange={onOpenChange}
      title={done ? "Inquiry sent" : "Send an inquiry"}
      description={done
        ? undefined
        : "Tell us what you need and when. We'll come back to you on availability — even for dates you can't book online."}
      icon={done ? "checkCircle" : "chat"}
      width="34rem"
    >
      {done ? (
        <div className="mt-5 flex flex-col items-center gap-3 text-center">
          <p className="text-[13.5px] leading-relaxed text-[var(--body)]">
            Thank you. Our team will reach out by email or phone shortly to talk through
            availability for your dates.
          </p>
          <button type="button" className="cbp-btn cbp-btn-primary mt-2" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-3.5">
          {/* Honeypot. Off-screen rather than display:none so a bot's form
              walker still finds it, and hidden from assistive tech. */}
          <div aria-hidden="true" className="cbp-honeypot">
            <label htmlFor="cbp-hp">Leave this field empty</label>
            <input
              id="cbp-hp" type="text" tabIndex={-1} autoComplete="off"
              value={form.hpField ?? ""}
              onChange={e => set("hpField", e.target.value)}
            />
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Row label="Full name" error={errors.name} required>
              <input
                className="cbp-input" autoComplete="name" value={form.name}
                onChange={e => set("name", e.target.value)} aria-invalid={!!errors.name}
              />
            </Row>
            <Row label="Phone" error={errors.phone} required>
              <input
                className="cbp-input" type="tel" autoComplete="tel" value={form.phone}
                onChange={e => set("phone", e.target.value)} aria-invalid={!!errors.phone}
              />
            </Row>
          </div>

          <Row label="Email" error={errors.email} required>
            <input
              className="cbp-input" type="email" autoComplete="email" value={form.email}
              onChange={e => set("email", e.target.value)} aria-invalid={!!errors.email}
            />
          </Row>

          <Row label="Vehicle of interest" error={errors.vehicleId}>
            <CbpSelect
              label="Vehicle of interest"
              icon="car"
              value={form.vehicleId ?? ANY_VEHICLE}
              onChange={v => set("vehicleId", v === ANY_VEHICLE ? null : v)}
              options={vehicleOptions}
              placeholder={fleetLoading ? "Loading…" : "Any vehicle"}
            />
          </Row>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Row label="Start date" error={errors.startDate} required>
              <input
                className="cbp-input" type="date" value={form.startDate}
                onChange={e => set("startDate", e.target.value)} aria-invalid={!!errors.startDate}
              />
            </Row>
            <Row label="End date" error={errors.endDate} required>
              <input
                className="cbp-input" type="date" value={form.endDate}
                onChange={e => set("endDate", e.target.value)} aria-invalid={!!errors.endDate}
              />
            </Row>
          </div>

          <Row label="What do you need?" error={errors.description} required>
            <textarea
              className="cbp-input cbp-textarea" rows={4} maxLength={2000}
              value={form.description}
              onChange={e => set("description", e.target.value)}
              aria-invalid={!!errors.description}
              placeholder="Pickup and return location, why this vehicle, how flexible your dates are…"
            />
            <p className="cbp-form-hint text-right cbp-num">{form.description.length} / 2000</p>
          </Row>

          <div className="mt-1 flex flex-wrap justify-end gap-2.5">
            <button
              type="button" className="cbp-btn cbp-btn-ghost"
              onClick={() => onOpenChange(false)} disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="cbp-btn cbp-btn-primary" disabled={submitting}>
              {submitting
                ? <><span className="cbp-spinner" aria-hidden="true" /> Sending…</>
                : <>Send inquiry <Icon name="arrow" className="cbp-arrow h-4 w-4" /></>}
            </button>
          </div>
        </form>
      )}
    </CbpModal>
  );
}

function Row({
  label, error, required, children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="cbp-form-row">
      <span className="cbp-form-label">
        {label}{required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {error && <p className="cbp-form-msg" role="alert">{error}</p>}
    </div>
  );
}
