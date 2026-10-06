"use client";

/**
 * Add / edit a customer — the v2 dialog.
 *
 * Oct 6 2026 (Ghulam: "too bland… an illustration at the top and then some
 * fields underneath, next screen like that… small groups of information"):
 * a narrow dialog, one small idea per screen, stacked and centred —
 *
 *   picture  →  what Trax is asking, in one line  →  two to five fields
 *
 *   1. Who's renting?        full name, date of birth
 *   2. How do I reach them?  email, phone (one of them is required)
 *   3. Their licence         driver's license, ID number
 *
 * No Person / Company choice (Ghulam, Oct 6: "I don't want to give the user
 * the company option"). A new customer is always an Individual; editing an
 * existing Company customer keeps its type and company fields untouched,
 * because the form still carries them through to the same payload.
 *   4. A couple more things  status, gig driver
 *   5. Emergency contact     their name and relationship — optional
 *   6. Reaching them         their phone, email and address — optional
 *
 * ONE LAYOUT RULE for every screen: the same picture size, a line reserved for
 * two lines of text, and EXACTLY TWO ROWS of fields in a two-column grid — a
 * lone field spans the row, a group that needs more becomes another screen. So every screen is the same
 * height, the fields always start at the same place, and nothing scrolls or
 * slides under the footer. After a NEW customer is saved the dialog turns into v1's follow-up,
 * in the same frame: "Verify their ID now?", then the live ID check
 * (`verify-id-screen-v2.tsx`, QR via create-ai-verification-session) and, for
 * a gig driver, v1's proof upload.
 *
 * SAVES EXACTLY LIKE v1's `CustomerFormModal` (components/customers/
 * customer-form-modal.tsx, untouched): the same schema, the live blocked-ID
 * check on the license / ID fields, the duplicate license and email checks
 * (tenant-scoped), the blocked-identity re-check on create, the same payload,
 * the same audit log entries and the same cache keys. One difference: v1
 * shows a Notes field that is never saved (`customers` has no notes column);
 * this dialog does not show a field it cannot keep.
 */

import { useEffect, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import type { ComponentType } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { cn } from "@/lib/utils";
import { customerFormModalSchema, type CustomerFormModalFormValues } from "@/client-schemas/customers/customer-form-modal";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Cell, CONTROL, Segmented, StepFooter, ToggleTile } from "@/components/shared/form-grid-v2";
import {
  AddCustomerContactArt,
  AddCustomerEmergencyArt,
  AddCustomerEmergencyReachArt,
  AddCustomerExtrasArt,
  AddCustomerLicenceArt,
  AddCustomerVerifyArt,
  AddCustomerWhoArt,
} from "@/components/illustrations-v2/scenes/add-customer";
import { BonzahDateField } from "@/app/(dashboard)/integrations/_panels/bonzah-date-field";
import { VerifyIdScreenV2 } from "@/components/customers-v2/verify-id-screen-v2";
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

type Step = {
  /** Short name, for the step dots' tooltip. */
  name: string;
  art: ComponentType<{ className?: string }>;
  title: string;
  line: string;
  fields: FieldPath<Values>[];
};

const STEPS: Step[] = [
  {
    name: "Who",
    art: AddCustomerWhoArt,
    title: "Who's renting?",
    line: "Their name and date of birth, as they appear on their licence.",
    fields: ["name", "date_of_birth"],
  },
  {
    name: "Contact",
    art: AddCustomerContactArt,
    title: "How do I reach them?",
    line: "Email or phone. I need at least one to send their bookings and receipts.",
    fields: ["email", "phone"],
  },
  {
    name: "Licence",
    art: AddCustomerLicenceArt,
    title: "Their licence",
    line: "I check every number against your blocklist the moment you enter it.",
    fields: ["license_number", "id_number"],
  },
  {
    name: "Details",
    art: AddCustomerExtrasArt,
    title: "A couple more things",
    line: "If they drive for Uber, Lyft or DoorDash, I'll ask for their proof next.",
    fields: ["status", "is_gig_driver"],
  },
  {
    name: "Emergency contact",
    art: AddCustomerEmergencyArt,
    title: "Who do I call if something happens?",
    line: "All optional, but it's the first person I'll want if there's trouble on the road.",
    fields: ["nok_full_name", "nok_relationship"],
  },
  {
    name: "Reaching them",
    art: AddCustomerEmergencyReachArt,
    title: "And how do I reach them?",
    line: "A phone number is the one that matters most. Also optional.",
    fields: ["nok_phone", "nok_email", "nok_address"],
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
      // No tenant, no write: every query below is scoped by it (V2_PLAN §5).
      if (!tenant?.id) return fail("Couldn't save", "I couldn't tell which business this is for. Please reload and try again.");
      setLoading(true);
      try {
        // Duplicates — within this tenant only, the record itself excluded.
        if (data.license_number) {
          let q = supabase.from("customers").select("id, name").eq("license_number", data.license_number.trim()).eq("tenant_id", tenant.id);
          if (isEditing) q = q.neq("id", customer!.id);
          const { data: dup } = await q.limit(1).maybeSingle();
          if (dup) return fail("Duplicate license number", `A customer with this license number already exists: ${dup.name}`);
        }
        if (data.email) {
          let q = supabase.from("customers").select("id, name").eq("email", data.email.trim().toLowerCase()).eq("tenant_id", tenant.id);
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
          const { error } = await supabase.from("customers").update(payload as never).eq("id", customer!.id).eq("tenant_id", tenant.id);
          if (error) throw error;
          logAction({ action: "customer_updated", entityType: "customer", entityId: customer!.id, details: { customer_name: data.name } });
          toast({ title: "Customer updated", description: `${data.name} has been updated.` });
          refresh();
          queryClient.invalidateQueries({ queryKey: ["customer", customer!.id] });
          onOpenChange(false);
          return;
        }

        payload.tenant_id = tenant.id;
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
  const screen = STEPS[step];
  const phoneFilter = (s: string) => s.replace(/[^0-9\s\-()+]/g, "");

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-[600px]"
          showCloseButton={false}
          // The ID check is waiting on the customer's phone: a stray click
          // outside must not throw the QR away. "Later" closes it.
          onInteractOutside={(e) => qr && e.preventDefault()}
          // Open on the first field to type in, not on the first button —
          // focusing a toggle drew a focus ring round it.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>("input:not([type=hidden]):not([type=file])")?.focus();
          }}
        >
          <DialogTitle className="sr-only">{isEditing ? "Edit customer" : "Add a customer"}</DialogTitle>
          <DialogDescription className="sr-only">{created ? "Verify their ID" : screen.title}</DialogDescription>

          {created && qr ? (
            /* The ID check, live — in the same frame, not a second dialog. */
            <VerifyIdScreenV2
              session={qr}
              name={created.name}
              onDone={() => close(false)}
              onRetry={startVerification}
              retrying={startingVerification}
              onComplete={() => queryClient.invalidateQueries({ queryKey: ["customers-list"] })}
            />
          ) : created ? (
            /* The follow-up after a create: verify now, or later. */
            <div className="flex flex-col">
              <div className="flex h-[456px] flex-col items-center justify-center px-10 text-center duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
                <AddCustomerVerifyArt className="max-w-[264px]" />
                <h3 className="mt-6 text-xl font-medium text-foreground [text-wrap:balance]">{created.name} is in.</h3>
                <p className="mx-auto mt-2 max-w-[24rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
                  Want me to verify their ID now? I&rsquo;ll show a QR code they scan to photograph their licence and take a
                  selfie.
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 border-t px-8 py-4">
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
                else void form.trigger(screen.fields).then((ok) => ok && setStep(step + 1));
              }}
              className="flex flex-col"
            >
              {/* One screen: picture, what Trax is asking, a few fields. Same
                  height on every step, so nothing jumps and nothing scrolls. */}
              <div
                key={step}
                className="flex h-[456px] flex-col items-center overflow-hidden px-10 pt-8 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
              >
                <screen.art className="max-w-[240px]" />
                <h3 className="mt-4 text-center text-xl font-medium leading-snug text-foreground [text-wrap:balance]">
                  {screen.title}
                </h3>
                <p className="mx-auto mt-1.5 min-h-[2lh] max-w-[24rem] text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
                  {screen.line}
                </p>

                <div className="mt-5 grid w-full grid-cols-2 gap-x-5 gap-y-1">
                  {step === 0 && (
                    <>
                      <Cell label="Full name" required className="col-span-2" error={err("name")}>
                        {text("name", "e.g. Jordan Ellis", { filter: (s) => s.replace(/\d/g, "") })}
                      </Cell>
                      <Cell label="Date of birth" className="col-span-2" error={err("date_of_birth")}>
                        <BonzahDateField
                          value={v.date_of_birth ?? ""}
                          invalid={!!err("date_of_birth")}
                          triggerClassName={CONTROL}
                          onChange={(s) => set("date_of_birth", s)}
                        />
                      </Cell>
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <Cell label="Email" className="col-span-2" error={err("email")}>
                        {text("email", "name@example.com", { type: "email", inputMode: "email" })}
                      </Cell>
                      <Cell label="Phone" className="col-span-2" error={err("phone")}>
                        {text("phone", "+1 555 123 4567", { type: "tel", inputMode: "tel", filter: phoneFilter })}
                      </Cell>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <Cell
                        label="Driver's license"
                        className="col-span-2"
                        error={blocked?.type === "license" ? `Blocked: ${blocked.reason}` : err("license_number")}
                      >
                        {text("license_number", "License number", { upper: true, onBlur: () => void checkBlocked(v.license_number) })}
                      </Cell>
                      <Cell label="ID number" className="col-span-2" error={blocked && blocked.type !== "license" ? `Blocked: ${blocked.reason}` : err("id_number")}>
                        {text("id_number", "Passport or national ID", { upper: true, onBlur: () => void checkBlocked(v.id_number) })}
                      </Cell>
                    </>
                  )}

                  {step === 3 && (
                    <>
                      <Cell label="Status" className="col-span-2">
                        <Segmented
                          value={v.status}
                          options={[
                            { value: "Active", label: "Active" },
                            { value: "Inactive", label: "Inactive" },
                          ]}
                          onChange={(t) => set("status", t)}
                        />
                      </Cell>
                      <Cell label="Gig driver" className="col-span-2">
                        <ToggleTile label="Gig driver" checked={!!v.is_gig_driver} onChange={(x) => set("is_gig_driver", x)} />
                      </Cell>
                    </>
                  )}

                  {step === 4 && (
                    <>
                      <Cell label="Full name" className="col-span-2" error={err("nok_full_name")}>
                        {text("nok_full_name", "Who to call", { filter: (s) => s.replace(/\d/g, "") })}
                      </Cell>
                      <Cell label="Relationship" className="col-span-2" error={err("nok_relationship")}>
                        {text("nok_relationship", "e.g. Spouse, Parent", { filter: (s) => s.replace(/[^a-zA-Z\s]/g, "") })}
                      </Cell>
                    </>
                  )}

                  {step === 5 && (
                    <>
                      <Cell label="Phone" error={err("nok_phone")}>
                        {text("nok_phone", "+1 555 123 4567", { type: "tel", inputMode: "tel", filter: phoneFilter })}
                      </Cell>
                      <Cell label="Email" error={err("nok_email")}>
                        {text("nok_email", "name@example.com", { type: "email", inputMode: "email" })}
                      </Cell>
                      <Cell label="Address" className="col-span-2" error={err("nok_address")}>
                        {text("nok_address", "Street, city, state, ZIP")}
                      </Cell>
                    </>
                  )}
                </div>
              </div>

              <StepFooter
                compact
                steps={STEPS.map((s) => s.name)}
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
