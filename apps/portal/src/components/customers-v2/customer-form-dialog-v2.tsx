"use client";

/**
 * Add / edit a customer — the v2 dialog (Ghulam, Oct 2 2026: "do the same with
 * add customer", after the vehicle dialog).
 *
 * The same pattern as `add-vehicle-dialog-v2.tsx`, from the shared kit
 * (components/shared/form-grid-v2.tsx): a wide dialog, no header, a fixed
 * three-column grid with one field per cell, and Back / steps / Next at the
 * foot. Two screens:
 *
 *   1. The customer          type, status, gig driver · name, email, phone ·
 *                            date of birth, license, ID · company fields or notes
 *   2. Emergency contact     next of kin — all optional
 *
 * After a NEW customer is saved the dialog turns into v1's follow-up, in the
 * same frame: "Start ID verification?" (QR via create-ai-verification-session),
 * and, for a gig driver, the proof upload. Both reuse v1's components.
 *
 * SAVES EXACTLY LIKE v1's `CustomerFormModal` (components/customers/
 * customer-form-modal.tsx, untouched): the same schema, the live blocked-ID
 * check on the license / ID fields, the duplicate license and email checks
 * (tenant-scoped), the blocked-identity re-check on create, the same payload,
 * the same audit log entries and the same cache keys.
 */

import { useEffect, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { cn } from "@/lib/utils";
import { customerFormModalSchema, type CustomerFormModalFormValues } from "@/client-schemas/customers/customer-form-modal";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Cell, CONTROL, SCREEN_GRID, Segmented, StepFooter, ToggleTile } from "@/components/shared/form-grid-v2";
import { BonzahDateField } from "@/app/(dashboard)/integrations/_panels/bonzah-date-field";
import { VerificationQRModal } from "@/components/customers/verification-qr-modal";
import GigDriverUploadDialog from "@/components/customers/gig-driver-upload-dialog";

type Values = CustomerFormModalFormValues;

export interface CustomerForEdit {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  date_of_birth?: string;
  license_number?: string;
  id_number?: string;
  is_gig_driver?: boolean;
  nok_full_name?: string;
  nok_relationship?: string;
  nok_phone?: string;
  nok_email?: string;
  nok_address?: string;
  [key: string]: unknown;
}

const STEPS: { title: string; fields: FieldPath<Values>[] }[] = [
  {
    title: "The customer",
    fields: [
      "customer_type", "status", "is_gig_driver", "name", "email", "phone",
      "date_of_birth", "license_number", "id_number", "company_name", "company_registration", "notes",
    ],
  },
  {
    title: "Emergency contact",
    fields: ["nok_full_name", "nok_relationship", "nok_phone", "nok_email", "nok_address"],
  },
];

const EMPTY: Values = {
  customer_type: "Individual",
  company_name: "",
  company_registration: "",
  name: "",
  email: "",
  phone: "",
  date_of_birth: "",
  license_number: "",
  id_number: "",
  is_gig_driver: false,
  status: "Active",
  notes: "",
  nok_full_name: "",
  nok_relationship: "",
  nok_phone: "",
  nok_email: "",
  nok_address: "",
};

export function CustomerFormDialogV2({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerForEdit | null;
}) {
  const isEditing = !!customer;
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState<{ reason?: string; type?: string } | null>(null);
  // After a create: the follow-up screen, then the QR / gig upload dialogs.
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [startingVerification, setStartingVerification] = useState(false);
  const [qr, setQr] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [gigCustomerId, setGigCustomerId] = useState<string | null>(null);

  useAuditLogOnOpen({
    open,
    action: "customer_form_dialog_shown",
    entityType: "customer",
    entityId: customer?.id || "new",
    details: { mode: isEditing ? "edit" : "create" },
  });

  // v1's fallback: a date of birth read from the customer's ID verification.
  const { data: verificationDob } = useQuery({
    queryKey: ["customer-verification-dob", customer?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("identity_verifications")
        .select("date_of_birth")
        .eq("customer_id", customer!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { date_of_birth: string | null } | null)?.date_of_birth ?? null;
    },
    enabled: !!customer?.id && open,
  });

  const form = useForm<Values>({ resolver: zodResolver(customerFormModalSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    setBlocked(null);
    setStep(0);
    if (customer) {
      const c = customer as Record<string, any>;
      form.reset({
        customer_type: (c.customer_type || c.type || "Individual") === "Company" ? "Company" : "Individual",
        company_name: c.company_name || "",
        company_registration: c.company_registration || "",
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
        date_of_birth: customer.date_of_birth || verificationDob || "",
        license_number: customer.license_number || "",
        id_number: customer.id_number || "",
        is_gig_driver: customer.is_gig_driver || false,
        status: customer.status === "Inactive" ? "Inactive" : "Active",
        notes: "",
        nok_full_name: customer.nok_full_name || "",
        nok_relationship: customer.nok_relationship || "",
        nok_phone: customer.nok_phone || "",
        nok_email: customer.nok_email || "",
        nok_address: customer.nok_address || "",
      });
    } else {
      form.reset(EMPTY);
    }
  }, [open, customer, verificationDob, form]);

  const v = form.watch();
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;
  const err = (k: FieldPath<Values>) => errors[k]?.message;
  const set = (k: FieldPath<Values>, value: unknown) =>
    form.setValue(k, value as never, { shouldDirty: true, shouldValidate: !!err(k) });
  const text = (
    k: FieldPath<Values>,
    placeholder: string,
    o: { type?: string; inputMode?: "email" | "tel" | "text"; filter?: (s: string) => string; onBlur?: () => void; upper?: boolean } = {},
  ) => (
    <input
      type={o.type ?? "text"}
      inputMode={o.inputMode}
      value={(v[k] as string | undefined) ?? ""}
      placeholder={placeholder}
      aria-invalid={!!err(k) || undefined}
      onChange={(e) => {
        let val = o.filter ? o.filter(e.target.value) : e.target.value;
        if (o.upper) val = val.toUpperCase();
        set(k, val);
      }}
      onBlur={o.onBlur}
      autoComplete="off"
      className={cn(CONTROL, o.upper && "[&:not(:placeholder-shown)]:font-mono [&:not(:placeholder-shown)]:tracking-wide")}
    />
  );

  /* ── the live blocked-ID check (v1's, on leaving the license / ID field) ─ */

  const checkBlocked = async (raw: string | undefined) => {
    const value = (raw ?? "").trim();
    if (!value) return setBlocked(null);
    try {
      const { data } = await supabase
        .from("blocked_identities")
        .select("identity_type, reason")
        .eq("identity_number", value)
        .eq("is_active", true)
        .in("identity_type", ["license", "id_card", "passport"])
        .maybeSingle();
      if (data) return setBlocked({ reason: data.reason, type: data.identity_type });
      const { data: bc } = await supabase
        .from("customers")
        .select("name, blocked_reason")
        .eq("is_blocked", true)
        .or(`license_number.eq.${value},id_number.eq.${value}`)
        .limit(1)
        .maybeSingle();
      setBlocked(bc ? { reason: bc.blocked_reason || `Belongs to blocked customer ${bc.name}`, type: "license" } : null);
    } catch {
      setBlocked(null);
    }
  };

  /* ── save ───────────────────────────────────────────────────────────── */

  const fail = (title: string, description: string) => toast({ title, description, variant: "destructive" });

  const save = form.handleSubmit(
    async (data) => {
      if (blocked) return fail("Blocked identity", `This ${blocked.type} number is blocked: ${blocked.reason}`);
      setLoading(true);
      try {
        // Duplicates — within this tenant only, the record itself excluded.
        if (data.license_number) {
          let q = supabase.from("customers").select("id, name").eq("license_number", data.license_number.trim());
          if (tenant?.id) q = q.eq("tenant_id", tenant.id);
          if (isEditing) q = q.neq("id", customer!.id);
          const { data: dup } = await q.limit(1).maybeSingle();
          if (dup) return fail("Duplicate license number", `A customer with this license number already exists: ${dup.name}`);
        }
        if (data.email) {
          let q = supabase.from("customers").select("id, name").eq("email", data.email.trim().toLowerCase());
          if (tenant?.id) q = q.eq("tenant_id", tenant.id);
          if (isEditing) q = q.neq("id", customer!.id);
          const { data: dup } = await q.limit(1).maybeSingle();
          if (dup) return fail("Duplicate email", `A customer with this email already exists: ${dup.name}`);
        }

        // On create, check the identities once more (license / ID only).
        if (!isEditing) {
          const ids = [data.license_number, data.id_number].filter(Boolean) as string[];
          if (ids.length) {
            const { data: hit } = await supabase
              .from("blocked_identities")
              .select("identity_type, reason")
              .in("identity_number", ids)
              .eq("is_active", true)
              .in("identity_type", ["license", "id_card", "passport"])
              .limit(1)
              .maybeSingle();
            if (hit) return fail("Blocked identity", `This ${hit.identity_type} number is blocked: ${hit.reason}`);
            const ors = [
              data.license_number && `license_number.eq.${data.license_number}`,
              data.id_number && `id_number.eq.${data.id_number}`,
            ].filter(Boolean) as string[];
            const { data: bc } = await supabase
              .from("customers")
              .select("name, license_number, blocked_reason")
              .eq("is_blocked", true)
              .or(ors.join(","))
              .limit(1)
              .maybeSingle();
            if (bc) {
              const which = data.license_number && bc.license_number === data.license_number ? "license" : "ID number";
              return fail("Blocked identity", `This ${which} belongs to a blocked customer (${bc.name}): ${bc.blocked_reason || "No reason provided"}`);
            }
          }
        }

        const company = data.customer_type === "Company";
        const payload: Record<string, unknown> = {
          name: data.name,
          email: data.email || null,
          phone: data.phone || null,
          type: data.customer_type || "Individual",
          customer_type: data.customer_type || "Individual",
          company_name: company ? data.company_name || null : null,
          company_registration: company ? data.company_registration || null : null,
          date_of_birth: data.date_of_birth || null,
          license_number: data.license_number || null,
          id_number: data.id_number || null,
          is_gig_driver: data.is_gig_driver,
          status: data.status,
          nok_full_name: data.nok_full_name || null,
          nok_relationship: data.nok_relationship || null,
          nok_phone: data.nok_phone || null,
          nok_email: data.nok_email || null,
          nok_address: data.nok_address || null,
        };

        const refresh = () => {
          for (const key of ["customers-list", "customer-balances-list", "customer-balances-enhanced"]) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        };

        if (isEditing) {
          let q = supabase.from("customers").update(payload as never).eq("id", customer!.id);
          if (tenant?.id) q = q.eq("tenant_id", tenant.id);
          const { error } = await q;
          if (error) throw error;
          logAction({ action: "customer_updated", entityType: "customer", entityId: customer!.id, details: { customer_name: data.name } });
          toast({ title: "Customer updated", description: `${data.name} has been updated.` });
          refresh();
          queryClient.invalidateQueries({ queryKey: ["customer", customer!.id] });
          onOpenChange(false);
          return;
        }

        if (tenant?.id) payload.tenant_id = tenant.id;
        const { data: row, error } = await supabase.from("customers").insert(payload as never).select("id").single();
        if (error) throw error;
        logAction({ action: "customer_created", entityType: "customer", entityId: row.id, details: { customer_name: data.name } });
        toast({ title: "Customer added", description: `${data.name} is now in your customers.` });
        refresh();
        if (data.is_gig_driver) setGigCustomerId(row.id);
        setCreated({ id: row.id, name: data.name });
        form.reset(EMPTY);
      } catch {
        fail("Couldn't save", `Failed to ${isEditing ? "update" : "add"} the customer. Please try again.`);
      } finally {
        setLoading(false);
      }
    },
    (errs) => {
      const first = STEPS.findIndex((s) => s.fields.some((f) => f in errs));
      if (first >= 0) setStep(first);
    },
  );

  const startVerification = async () => {
    if (!created || !tenant?.id || !tenant?.slug) return;
    setStartingVerification(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-ai-verification-session", {
        body: { customerId: created.id, tenantId: tenant.id, tenantSlug: tenant.slug },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to create verification session");
      setQr({ sessionId: data.sessionId, qrUrl: data.qrUrl, expiresAt: new Date(data.expiresAt) });
    } catch (e: any) {
      fail("Couldn't start verification", e?.message || "Failed to start verification.");
    } finally {
      setStartingVerification(false);
    }
  };

  const close = (o: boolean) => {
    if (!o) {
      setCreated(null);
      setQr(null);
      setStep(0);
    }
    onOpenChange(o);
  };

  const last = step === STEPS.length - 1;
  const companyMode = v.customer_type === "Company";

  return (
    <>
      <Dialog open={open && !qr} onOpenChange={close}>
        <DialogContent className="gap-0 p-0 sm:max-w-[1040px]" showCloseButton={false}>
          <DialogTitle className="sr-only">{isEditing ? "Edit customer" : "Add a customer"}</DialogTitle>
          <DialogDescription className="sr-only">{created ? "Start ID verification" : STEPS[step].title}</DialogDescription>

          {created ? (
            /* The follow-up after a create: verify now, or later. */
            <div className="flex h-[440px] flex-col items-center justify-center px-10 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ease-out motion-reduce:animate-none">
              <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                <ShieldCheck className="size-6" />
              </span>
              <h3 className="mt-5 text-xl font-medium text-foreground">{created.name} is added.</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Want to verify their ID now? I&rsquo;ll show a QR code they scan with their phone to photograph their license and
                take a selfie.
              </p>
              <div className="mt-8 flex items-center gap-3">
                <Button variant="outline" className="h-10 rounded-full px-5" onClick={() => close(false)}>
                  Later
                </Button>
                <Button className="h-10 rounded-full px-5" onClick={startVerification} disabled={startingVerification}>
                  {startingVerification ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {startingVerification ? "Starting…" : "Verify ID now"}
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (last) void save();
                else void form.trigger(STEPS[step].fields).then((ok) => ok && setStep(step + 1));
              }}
              className="flex flex-col"
            >
              <div
                key={step}
                className={cn("h-[440px] px-10 pt-10 animate-in fade-in-0 slide-in-from-bottom-2 duration-200 ease-out motion-reduce:animate-none", SCREEN_GRID)}
              >
                {step === 0 ? (
                  <>
                    <Cell label="Customer type">
                      <Segmented
                        value={v.customer_type ?? "Individual"}
                        options={[
                          { value: "Individual", label: "Person" },
                          { value: "Company", label: "Company" },
                        ]}
                        onChange={(t) => set("customer_type", t)}
                      />
                    </Cell>
                    <Cell label="Status">
                      <Segmented
                        value={v.status}
                        options={[
                          { value: "Active", label: "Active" },
                          { value: "Inactive", label: "Inactive" },
                        ]}
                        onChange={(t) => set("status", t)}
                      />
                    </Cell>
                    <Cell label="Gig driver" hint="Drives for Uber, Lyft, DoorDash…">
                      <ToggleTile label="Gig driver" checked={!!v.is_gig_driver} onChange={(x) => set("is_gig_driver", x)} />
                    </Cell>

                    <Cell label={companyMode ? "Contact person" : "Full name"} required error={err("name")}>
                      {text("name", companyMode ? "Who we deal with" : "e.g. Jordan Ellis", { filter: (s) => s.replace(/\d/g, "") })}
                    </Cell>
                    <Cell label="Email" error={err("email")} hint="Email or phone is required">
                      {text("email", "name@example.com", { type: "email", inputMode: "email" })}
                    </Cell>
                    <Cell label="Phone" error={err("phone")}>
                      {text("phone", "+1 555 123 4567", { type: "tel", inputMode: "tel", filter: (s) => s.replace(/[^0-9\s\-()+]/g, "") })}
                    </Cell>

                    <Cell label="Date of birth" error={err("date_of_birth")}>
                      <BonzahDateField
                        value={v.date_of_birth ?? ""}
                        triggerClassName={CONTROL}
                        onChange={(s) => set("date_of_birth", s)}
                      />
                    </Cell>
                    <Cell label="Driver's license" error={blocked?.type === "license" ? `Blocked: ${blocked.reason}` : err("license_number")}>
                      {text("license_number", "License number", { upper: true, onBlur: () => void checkBlocked(v.license_number) })}
                    </Cell>
                    <Cell label="ID number" error={blocked && blocked.type !== "license" ? `Blocked: ${blocked.reason}` : err("id_number")}>
                      {text("id_number", "Passport or national ID", { upper: true, onBlur: () => void checkBlocked(v.id_number) })}
                    </Cell>

                    {companyMode ? (
                      <>
                        <Cell label="Company name" required error={err("company_name")}>
                          {text("company_name", "e.g. Acme Corp")}
                        </Cell>
                        <Cell label="Tax ID / Reg. no." error={err("company_registration")}>
                          {text("company_registration", "EIN or registration number")}
                        </Cell>
                        <Cell label="Notes" error={err("notes")}>
                          {text("notes", "Anything worth knowing")}
                        </Cell>
                      </>
                    ) : (
                      <Cell label="Notes" className="col-span-3" error={err("notes")}>
                        {text("notes", "Anything worth knowing about this customer")}
                      </Cell>
                    )}
                  </>
                ) : (
                  <>
                    <Cell label="Full name" error={err("nok_full_name")}>
                      {text("nok_full_name", "Who to call in an emergency", { filter: (s) => s.replace(/\d/g, "") })}
                    </Cell>
                    <Cell label="Relationship" error={err("nok_relationship")}>
                      {text("nok_relationship", "e.g. Spouse, Parent", { filter: (s) => s.replace(/[^a-zA-Z\s]/g, "") })}
                    </Cell>
                    <Cell label="Phone" error={err("nok_phone")}>
                      {text("nok_phone", "+1 555 123 4567", { type: "tel", inputMode: "tel", filter: (s) => s.replace(/[^0-9\s\-()+]/g, "") })}
                    </Cell>

                    <Cell label="Email" error={err("nok_email")}>
                      {text("nok_email", "name@example.com", { type: "email", inputMode: "email" })}
                    </Cell>
                    <Cell label="Address" className="col-span-2" error={err("nok_address")}>
                      {text("nok_address", "Street, city, state, ZIP")}
                    </Cell>
                    <p className="col-span-3 px-0.5 text-xs text-muted-foreground">
                      All optional — but it&rsquo;s who you call if something happens on the road.
                    </p>
                  </>
                )}
              </div>

              <StepFooter
                steps={STEPS.map((s) => s.title)}
                step={step}
                loading={loading}
                onBack={() => setStep(step - 1)}
                onCancel={() => close(false)}
                finishLabel={isEditing ? "Save changes" : "Add customer"}
                busyLabel={isEditing ? "Saving…" : "Adding…"}
              />
            </form>
          )}
        </DialogContent>
      </Dialog>

      <VerificationQRModal
        open={!!qr}
        onOpenChange={(o) => {
          if (!o) close(false);
        }}
        sessionData={qr}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ["customers-list"] })}
      />

      {gigCustomerId && (
        <GigDriverUploadDialog
          open={!!gigCustomerId}
          onOpenChange={(o) => !o && setGigCustomerId(null)}
          customerId={gigCustomerId}
        />
      )}
    </>
  );
}
