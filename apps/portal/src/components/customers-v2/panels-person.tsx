"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — THE PERSON.
 *
 * The first band: the three panels an operator TYPES INTO. Nothing here is
 * produced from anything else, which is why nothing here can be out of date —
 * but everything here is read by something in the second band, so an edit made
 * on one of these panels is what puts a verdict downstream in amber.
 *
 * Every field writes through `set`, which applies on screen instantly and
 * persists after a pause. There is no Save button because there is nothing to
 * save: the record already exists.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Check,
  Download,
  FileText,
  Pencil,
  Plus,
  ScanLine,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { useCustomerDocuments, useDeleteCustomerDocument, useDownloadDocument } from "@/hooks/use-customer-documents";
import { useDeleteGigDriverImage, useGigDriverImages } from "@/hooks/use-gig-driver-images";
import AddCustomerDocumentDialog from "@/components/customers/add-customer-document-dialog";
import GigDriverUploadDialog from "@/components/customers/gig-driver-upload-dialog";
import {
  EmptyHint,
  Field,
  OptionCard,
  Panel,
  Pill,
  Section,
  Stat,
  Thumb,
  Toggle,
  expiryOf,
  fmtDate,
  inputCls,
  listCls,
} from "./kit";
import type { CustomerRecord, PanelProps } from "./types";

/**
 * Did the verification provider actually read anything off the document?
 *
 * A DECLINED verdict usually extracted nothing — OCR failed, the photo was
 * unusable — so the row exists but every field on it is blank. The "editing
 * this will put Verification out of date" notes are only true when there is
 * something to fall out of date, and printing them anyway teaches operators
 * that this screen says things it cannot back up.
 */
const readSomething = (c: CustomerRecord) =>
  !!c.ai.extracted && Object.values(c.ai.extracted).some((v) => !!v);

/** The zones an operator actually picks from. `timezone` is free text in the
 *  database, so an unrecognised value is kept and shown rather than replaced. */
const US_TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];

/* ══════════════════════════════════════════════════════════════════════════
   Identity
   ══════════════════════════════════════════════════════════════════════════ */

export function IdentityPanel({ c, set, onJump, canEdit }: PanelProps) {
  const isCompany = c.identity.customerType === "Company";
  const zones = c.identity.timezone && !US_TIMEZONES.includes(c.identity.timezone)
    ? [c.identity.timezone, ...US_TIMEZONES]
    : US_TIMEZONES;

  return (
    <Panel
      title="Identity"
      description="Who this person is. Typing here changes the record — there is nothing to save."
    >
      <Section title="Contact">
        {c.identity.profilePhotoUrl && (
          <div className="mb-6 flex items-center gap-4">
            <Thumb className="size-16 shrink-0 rounded-4xl" src={c.identity.profilePhotoUrl} />
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold">Profile photo</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shown to staff on the handover screen so the right person gets the keys.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Full name">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.name}
                placeholder="e.g. Marcus Adeyemi"
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Email" hint="Optional — plenty of live customers have none, so nothing may depend on it.">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.email}
              placeholder="name@example.com"
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.phone}
              placeholder="+1 (000) 000-0000"
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field label="Date of birth" hint="Used for the minimum-age check at handover.">
            <input
              type="date"
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.dob}
              onChange={(e) => set({ date_of_birth: e.target.value })}
            />
          </Field>
          <Field label="Timezone" hint="When their reminders and lockbox codes are sent.">
            <select
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
            >
              <option value="">Not set</option>
              {zones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Address" description="The verification provider reads this back off the licence.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.street}
                placeholder="418 Riverside Ave, Apt 6B"
                onChange={(e) => set({ address_street: e.target.value })}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.city}
              placeholder="Jacksonville"
              onChange={(e) => set({ address_city: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.state}
                placeholder="FL"
                maxLength={2}
                onChange={(e) => set({ address_state: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="ZIP">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.zip}
                placeholder="32204"
                onChange={(e) => set({ address_zip: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Account holder"
        description="A company account bills and signs under the business, not the driver."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            selected={!isCompany}
            disabled={!canEdit}
            onClick={() => set({ customer_type: "Individual" })}
            title="Individual"
            subtitle="Renting in their own name"
            right={<User className="size-4 shrink-0 text-muted-foreground" />}
          />
          <OptionCard
            selected={isCompany}
            disabled={!canEdit}
            onClick={() => set({ customer_type: "Company" })}
            title="Company"
            subtitle="Renting on behalf of a business"
            right={<Building2 className="size-4 shrink-0 text-muted-foreground" />}
          />
        </div>

        {isCompany && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Company name">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.companyName}
                placeholder="e.g. Riverside Logistics LLC"
                onChange={(e) => set({ company_name: e.target.value })}
              />
            </Field>
            <Field label="Registration number">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.companyRegistration}
                placeholder="e.g. L26000148821"
                onChange={(e) => set({ company_registration: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section
        title="Next of kin"
        description="Who we call if something happens to the driver while the car is out."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.name}
              onChange={(e) => set({ nok_full_name: e.target.value })}
            />
          </Field>
          <Field label="Relationship">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.relationship}
              placeholder="e.g. Sister"
              onChange={(e) => set({ nok_relationship: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.phone}
              onChange={(e) => set({ nok_phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.email}
              onChange={(e) => set({ nok_email: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.nok.address}
                placeholder="Street, city, state, ZIP"
                onChange={(e) => set({ nok_address: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Section>

      {readSomething(c) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The name, date of birth and address on this panel are among the values the identity verdict
          was issued against — so editing any of them will put{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>{" "}
          out of date. That is not a warning; it is the screen doing its job.
        </p>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Licence & driving
   ══════════════════════════════════════════════════════════════════════════ */

export function LicencePanel({ c, set, onJump, canEdit }: PanelProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: gigImages } = useGigDriverImages(c.id);
  const deleteGig = useDeleteGigDriverImage();
  const exp = expiryOf(c.licence.expiry);

  const publicUrl = (path: string | null) =>
    path ? supabase.storage.from("gig-driver-images").getPublicUrl(path).data.publicUrl : null;

  return (
    <Panel
      title="Licence & driving"
      description="The document the identity verdict is issued against, and the reason insurance is priced the way it is."
    >
      <Section title="Driving licence">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Licence number">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.licence.number}
              placeholder="A000-0000-XX"
              onChange={(e) => set({ license_number: e.target.value })}
            />
          </Field>
          <Field label="Issuing state">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.licence.state}
              placeholder="FL"
              maxLength={2}
              onChange={(e) => set({ license_state: e.target.value.toUpperCase() })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Other ID on file"
              hint="A second number staff can match against — passport, national ID, or the last four of an SSN."
            >
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.licence.idNumber}
                placeholder="e.g. SSN ••••-0000"
                onChange={(e) => set({ id_number: e.target.value })}
              />
            </Field>
          </div>
        </div>

        {/*
         * Issue and expiry are not typed in, and that is deliberate rather than
         * an omission. `customers` has no column for either — the only place
         * the dates exist is the verification row, read off the document
         * itself. That is a better source than a field an operator could get
         * wrong, so the screen shows it and says where it came from.
         */}
        <div className="mt-5">
          <p className="mb-2.5 text-xs font-medium">Read off the document</p>
          <div className={listCls}>
            <div className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="text-xs text-muted-foreground">Issued</span>
              <span className="text-[13px] font-medium">{fmtDate(c.licence.issued)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="text-xs text-muted-foreground">Expires</span>
              <span
                className={cn(
                  "text-[13px] font-medium",
                  exp.state === "expired" && "text-destructive",
                  exp.state === "soon" && "text-warning"
                )}
              >
                {fmtDate(c.licence.expiry)}
              </span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-5 flex items-center gap-3 rounded-3xl px-5 py-4 ring-1",
            exp.state === "expired"
              ? "bg-destructive/[0.06] ring-destructive/20"
              : exp.state === "soon"
                ? "bg-warning-light/60 ring-warning/25"
                : "bg-muted/40 ring-foreground/5"
          )}
        >
          {exp.state === "valid" ? (
            <Check className="size-4 shrink-0 text-success" />
          ) : exp.state === "none" ? (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <AlertTriangle
              className={cn("size-4 shrink-0", exp.state === "expired" ? "text-destructive" : "text-warning")}
            />
          )}
          <p className="min-w-0 flex-1 text-xs leading-relaxed">
            {exp.state === "expired" ? (
              <>
                <span className="font-medium text-destructive">
                  This licence expired on {fmtDate(c.licence.expiry)}.
                </span>{" "}
                A car cannot legally go out against it.
              </>
            ) : exp.state === "soon" ? (
              <>
                <span className="font-medium text-warning">{exp.label}</span> — worth asking for the
                replacement before the next booking runs past it.
              </>
            ) : exp.state === "none" ? (
              <>
                No expiry date on record. It is captured when the licence is put through{" "}
                <button
                  type="button"
                  onClick={() => onJump("verification")}
                  className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
                >
                  Verification
                </button>
                , which is the only place this platform reads it from.
              </>
            ) : (
              <>
                Valid until {fmtDate(c.licence.expiry)}
                <span className="text-muted-foreground"> · {exp.days} days from today</span>
              </>
            )}
          </p>
        </div>
      </Section>

      <Section
        title="Gig driver"
        description="Rideshare and delivery drivers are underwritten differently, so we hold proof of the platform rather than taking their word for it."
      >
        <Toggle
          checked={c.licence.isGigDriver}
          disabled={!canEdit}
          onChange={(v) => set({ is_gig_driver: v })}
          label="This customer drives for a gig platform"
          hint="Uber, Lyft, DoorDash and similar."
        />

        {c.licence.isGigDriver && (
          <div className="mt-5">
            {(gigImages || []).length === 0 ? (
              <EmptyHint>No proof uploaded yet. A screenshot of their driver dashboard is enough.</EmptyHint>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {(gigImages || []).map((g) => {
                  const url = publicUrl(g.image_url);
                  return (
                    <div key={g.id} className="group relative">
                      <Thumb
                        className="aspect-[4/3] w-full"
                        src={url}
                        caption={g.file_name}
                        onClick={() => url && window.open(url, "_blank")}
                      />
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Remove ${g.file_name}`}
                          onClick={() => deleteGig.mutate(g)}
                          className="absolute right-2 top-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <div className="mt-5">
                <Button variant="outline" onClick={() => setUploadOpen(true)}>
                  <Plus className="size-4" />
                  Add proof
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {readSomething(c) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The licence number above is what{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>{" "}
          checked. Change it and it will say so itself.
        </p>
      )}

      <GigDriverUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} customerId={c.id} />
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Documents
   ══════════════════════════════════════════════════════════════════════════ */

const SCAN_TONE = { none: "neutral", scanning: "primary", passed: "success", flagged: "warning" } as const;
const SCAN_WORD = {
  none: "Not scanned",
  scanning: "Scanning",
  passed: "Scan passed",
  flagged: "Needs a look",
} as const;

/**
 * "Accept anyway" — a member of staff overruling the scanner.
 *
 * Tenant-guarded like every other write on this screen. `customer_documents`
 * has RLS policies, but the same rule applies as everywhere else in this
 * component tree: the filter is in the query, not assumed from the session.
 */
function useAcceptDocument(customerId: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await (supabase as any)
        .from("customer_documents")
        .update({ verified: true })
        .eq("id", documentId)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-documents"] });
      toast({ title: "Document accepted", description: "Marked verified against the scanner's objection." });
    },
    onError: (e: any) => toast({ title: "Could not accept it", description: e.message, variant: "destructive" }),
  });
}

export function DocumentsPanel({ c, onJump, canEdit }: PanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const { data: rawDocs } = useCustomerDocuments(c.id);
  const deleteDoc = useDeleteCustomerDocument();
  const download = useDownloadDocument();
  const accept = useAcceptDocument(c.id);

  const expiring = c.docs.filter((d) => expiryOf(d.until).state === "soon").length;
  const expired = c.docs.filter((d) => expiryOf(d.until).state === "expired").length;
  const flagged = c.docs.filter((d) => d.scan.status === "flagged").length;

  const rawById = new Map(((rawDocs as any[]) || []).map((d: any) => [d.id, d]));

  return (
    <Panel
      title="Documents"
      description="Files this operator holds about the customer — uploaded here, scanned, and given a validity window."
      right={
        canEdit ? (
          <Button
            variant="outline"
            onClick={() => {
              setEditingId(undefined);
              setAddOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add document
          </Button>
        ) : undefined
      }
    >
      {/*
       * The distinction that matters, stated where it matters. Verification
       * photos belong to the PROVIDER: they are evidence of one verdict at one
       * moment, they cannot be edited, and they live on a different table.
       * Mixing the two makes both unreadable — an operator replacing a "licence
       * front" here would reasonably expect the verdict to update, and it
       * would not.
       */}
      <div className="flex items-start gap-3 rounded-4xl bg-muted/40 px-6 py-5 ring-1 ring-foreground/5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          These are the operator&apos;s own files. The licence photos and selfie the verification
          provider captured are its evidence, not yours — they cannot be replaced from here and they
          live on{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>
          .
        </p>
      </div>

      {c.docs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="On file"
            value={String(c.docs.length)}
            hint={`${c.docs.filter((d) => d.verified).length} marked verified`}
          />
          <Stat
            label="Expiring"
            value={String(expiring + expired)}
            hint={expired ? `${expired} already expired` : "Within 30 days"}
            tone={expired ? "destructive" : expiring ? "warning" : undefined}
          />
          <Stat
            label="Flagged by the scanner"
            value={String(flagged)}
            hint={flagged ? "Needs a human" : "Nothing outstanding"}
            tone={flagged ? "warning" : undefined}
          />
        </div>
      )}

      <Section title="Files">
        {c.docs.length === 0 ? (
          <EmptyHint>
            Nothing on file. A licence and a proof of address are what most operators ask for before
            the first handover.
          </EmptyHint>
        ) : (
          <div className="space-y-3">
            {c.docs.map((d) => {
              const exp = expiryOf(d.until);
              return (
                <div key={d.id} className={cn(listCls, "divide-y-0")}>
                  <div className="flex items-start gap-4 px-5 py-4">
                    <Thumb className="h-12 w-16 shrink-0" filled />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        {d.verified && (
                          <Pill tone="success">
                            <Check className="size-3" />
                            Verified
                          </Pill>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.type}
                        {d.vehicle && ` · ${d.vehicle}`} · added {fmtDate(d.uploadedAt)}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Pill tone={SCAN_TONE[d.scan.status]}>
                          <ScanLine className="size-3" />
                          {SCAN_WORD[d.scan.status]}
                          {d.scan.confidence !== null && ` · ${d.scan.confidence}%`}
                        </Pill>
                        {exp.state !== "none" && (
                          <Pill tone={exp.state === "valid" ? "neutral" : "warning"}>{exp.label}</Pill>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {d.fileUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const raw = rawById.get(d.id);
                            if (raw) download.mutate(raw);
                          }}
                        >
                          <Download className="size-3.5" />
                          Download
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${d.name}`}
                            onClick={() => {
                              setEditingId(d.id);
                              setAddOpen(true);
                            }}
                            className="text-muted-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${d.name}`}
                            onClick={() => deleteDoc.mutate(d.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* The scanner's objection, in its own words, where the file
                      is — not behind a dialog that has to be gone looking for. */}
                  {d.scan.status === "flagged" && d.scan.reasons.length > 0 && (
                    <div className="mx-5 mb-4 rounded-2xl bg-warning-light/60 px-4 py-3 ring-1 ring-warning/25">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                        <AlertTriangle className="size-3.5" />
                        The scanner could not clear this one
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {d.scan.reasons.map((r) => (
                          <li key={r} className="text-xs leading-relaxed text-muted-foreground">
                            · {r}
                          </li>
                        ))}
                      </ul>
                      {canEdit && !d.verified && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => accept.mutate(d.id)} disabled={accept.isPending}>
                            <ShieldCheck className="size-4" />
                            Accept anyway
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <AddCustomerDocumentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={c.id}
        documentId={editingId}
      />
    </Panel>
  );
}
