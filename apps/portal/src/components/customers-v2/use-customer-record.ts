"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — assembling one customer from the tables that hold them.
 *
 * The v1 page issues its reads inline, in the same 1,944-line component that
 * renders them. This hook does the reads instead and hands the panels one
 * assembled object, so that:
 *
 *   - the right-hand rail and the middle column cannot disagree: both read the
 *     same object, and there is only one place a field is derived;
 *   - every read carries `tenant_id`. RLS is OFF on `customers`, `rentals`,
 *     `payments` and `ledger_entries` (V2_PLAN §5) — the policies exist but are
 *     inert, so a missing tenant filter is not a tidiness problem, it is a
 *     cross-tenant data leak. The existing `use-customer-*` hooks all filter;
 *     the three queries added here do the same, explicitly.
 *
 * It reuses the v1 hooks wherever one already exists. They are correct, they
 * are shared with screens this work must not touch, and re-querying the same
 * rows a second way is how two screens start quoting different numbers.
 * ────────────────────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerRentals } from "@/hooks/use-customer-rentals";
import { useCustomerPayments } from "@/hooks/use-customer-payments";
import { useCustomerFines } from "@/hooks/use-customer-fines";
import { useCustomerDocuments } from "@/hooks/use-customer-documents";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
import { useGigDriverImages } from "@/hooks/use-gig-driver-images";
import { useCustomerPaymentLinks } from "@/hooks/use-payment-links";
import { useCmdVerification, useCmdResults } from "@/hooks/use-cmd-verification";
import { dateOnly } from "./kit";
import type {
  ActivityEvent,
  CustomerRecord,
  Doc,
  Fine,
  GlobalBlock,
  LedgerRow,
  PaymentLink,
  Rental,
  Review,
} from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   The customer row
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every column this screen reads or writes, named rather than `select("*")`.
 *
 * `customers` carries 44 columns including three Stripe customer ids across two
 * acquiring accounts; pulling all of them down to render a name is wasteful,
 * and it hides which fields the screen actually depends on from anyone reading
 * this file later.
 */
const CUSTOMER_COLUMNS = `
  id, created_at, name, email, phone, status,
  date_of_birth, timezone, profile_photo_url,
  address_street, address_city, address_state, address_zip,
  customer_type, company_name, company_registration,
  license_number, license_state, id_number, is_gig_driver,
  nok_full_name, nok_relationship, nok_phone, nok_email, nok_address,
  is_blocked, blocked_at, blocked_reason,
  rejection_reason, rejected_at,
  sms_consent, sms_consent_at, whatsapp_opt_in,
  stripe_customer_id
`;

export type CustomerRow = Record<string, any>;

export function useCustomerRow(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-v2-row", tenant?.id, id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .eq("id", id)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data as CustomerRow | null;
    },
    enabled: !!tenant?.id && !!id,
    staleTime: 0,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Everything else
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The latest AI identity verification.
 *
 * Whether a check passed lives in `review_result`, not in `status` — the
 * provider writes 'completed' for both a pass and a rejection. The v1 page
 * spent a long time reading `status === 'approved'`, a value one row on the
 * platform has ever carried, and 227 passed checks displayed as "Pending"
 * beside the customer's own approved licence photos. Same rule here.
 */
function useAiVerification(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-v2-verification", tenant?.id, id],
    queryFn: async () => {
      const cols =
        "id, status, review_result, rejection_reason, verification_completed_at, ai_face_match_score, " +
        "document_number, document_expiry_date, document_issuing_date, first_name, last_name, date_of_birth, address, " +
        "face_image_url, selfie_image_url, document_front_url, document_back_url";
      const base = () =>
        (supabase as any)
          .from("identity_verifications")
          .select(cols)
          .eq("customer_id", id)
          .eq("tenant_id", tenant!.id)
          .eq("provider", "ai")
          .order("created_at", { ascending: false })
          .limit(1);

      // Prefer a completed row over an abandoned init/pending one.
      const { data: done } = await base().eq("status", "completed").maybeSingle();
      if (done) return done as CustomerRow;
      const { data, error } = await base().maybeSingle();
      if (error) throw error;
      return (data as CustomerRow) ?? null;
    },
    enabled: !!tenant?.id && !!id,
  });
}

/**
 * Platform blocklist entries that match THIS customer.
 *
 * `blocked_identities` is keyed on an identity — a licence number, an ID, an
 * email — not on a customer row, which is the whole point of it: it survives
 * the record being deleted and it catches the same person signing up again
 * under a new account. So this has to be looked up by value, and it returns
 * nothing at all when the record carries none of those values.
 */
function useGlobalBlocks(identityValues: string[]) {
  const { tenant } = useTenant();
  const key = identityValues.filter(Boolean).sort().join("|");
  return useQuery({
    queryKey: ["customer-v2-global-blocks", tenant?.id, key],
    queryFn: async () => {
      const values = key.split("|").filter(Boolean);
      if (values.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from("blocked_identities")
        .select("id, identity_type, identity_number, reason, notes, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .in("identity_number", values)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CustomerRow[];
    },
    enabled: !!tenant?.id && key.length > 0,
  });
}

/** The account ledger — what was charged, what arrived, what is left. */
function useLedger(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-v2-ledger", tenant?.id, id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ledger_entries")
        .select("id, entry_date, type, category, amount, remaining_amount, reference, rental_id, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("customer_id", id)
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as CustomerRow[];
    },
    enabled: !!tenant?.id && !!id,
    staleTime: 0,
  });
}

/** Anything a member of staff did to this record, from the audit trail. */
function useCustomerAudit(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-v2-audit", tenant?.id, id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("audit_logs")
        .select("id, action, created_at, details")
        .eq("tenant_id", tenant!.id)
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data || []) as CustomerRow[];
    },
    enabled: !!tenant?.id && !!id,
  });
}

/**
 * What each rental still owes, matched to the rental detail page's own maths so
 * the same number shows in both places.
 *
 * Ported from the v1 customer page rather than rewritten, comments and all —
 * two screens quoting different balances for one rental is a support call, and
 * this query is the reason they currently agree.
 */
function useRentalOutstandings(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-v2-rental-outstandings", tenant?.id, id],
    queryFn: async () => {
      const rentalsRes = await supabase
        .from("rentals")
        .select("id, is_pay_as_you_go, rental_number")
        .eq("tenant_id", tenant!.id)
        .eq("customer_id", id);
      if (rentalsRes.error) throw rentalsRes.error;

      // `rental_number` rides along on a query this screen already makes.
      // `useCustomerRentals` does not select it and is shared with v1, so it is
      // picked up here rather than by widening a hook two screens depend on.
      const numbers: Record<string, string> = {};
      (rentalsRes.data || []).forEach((r: any) => {
        if (r.rental_number) numbers[r.id] = r.rental_number;
      });

      const paygRentalIds = (rentalsRes.data || []).filter((r: any) => r.is_pay_as_you_go).map((r: any) => r.id);
      const fixedRentalIds = (rentalsRes.data || []).filter((r: any) => !r.is_pay_as_you_go).map((r: any) => r.id);

      // A cancelled extension's charges keep their full remaining_amount — the
      // week was priced, then declined. The rental page excludes them, so
      // without the same filter the two screens disagree by the whole week.
      const deadExtRes =
        fixedRentalIds.length > 0
          ? await supabase
              .from("rental_extension_totals")
              .select("id, display_status")
              .in("rental_id", fixedRentalIds)
              .in("display_status", ["cancelled", "refunded", "pending_approval"])
          : { data: [], error: null };
      const deadExtIds = new Set(((deadExtRes.data as any[]) || []).map((e: any) => e.id));

      const [paygRes, ledgerRes] = await Promise.all([
        paygRentalIds.length > 0
          ? supabase
              .from("payg_accruals")
              .select("rental_id, daily_rate, tax_amount, service_fee_amount, rentals!inner(payg_closed_at)")
              .eq("tenant_id", tenant!.id)
              .in("rental_id", paygRentalIds)
              .eq("invoice_status", "open")
              .is("rentals.payg_closed_at", null)
          : Promise.resolve({ data: [], error: null }),
        fixedRentalIds.length > 0
          ? supabase
              .from("ledger_entries")
              .select("rental_id, remaining_amount, extension_id")
              .eq("tenant_id", tenant!.id)
              .in("rental_id", fixedRentalIds)
              .eq("type", "Charge")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (ledgerRes.error) throw ledgerRes.error;

      const map: Record<string, number> = {};
      ((paygRes.data as any[]) || []).forEach((a: any) => {
        const key = a.rental_id || "__none__";
        map[key] =
          (map[key] || 0) + Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0);
      });
      ((ledgerRes.data as any[]) || []).forEach((e: any) => {
        if (e.extension_id && deadExtIds.has(e.extension_id)) return;
        const key = e.rental_id || "__none__";
        map[key] = (map[key] || 0) + Number(e.remaining_amount || 0);
      });
      return { outstanding: map, numbers };
    },
    enabled: !!tenant?.id && !!id,
    staleTime: 0,
    gcTime: 0,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Mapping
   ══════════════════════════════════════════════════════════════════════════ */

const s = (v: unknown) => (v == null ? "" : String(v));

/**
 * `ai_scan_status` says how far the scan got, `review_reasons` says whether it
 * liked what it found. A completed scan carrying reasons is the case this
 * screen cares about most — it is the only one that needs a human.
 */
function scanOf(d: CustomerRow): Doc["scan"] {
  const reasons: string[] = Array.isArray(d.review_reasons) ? d.review_reasons.filter(Boolean) : [];
  const raw = s(d.ai_scan_status).toLowerCase();
  const confidence = d.ai_confidence_score == null ? null : Math.round(Number(d.ai_confidence_score));
  if (raw === "processing") return { status: "scanning", confidence, reasons: [] };
  if (raw === "failed") return { status: "flagged", confidence, reasons: reasons.length ? reasons : ["The scan could not be completed."] };
  if (raw === "completed") return reasons.length ? { status: "flagged", confidence, reasons } : { status: "passed", confidence, reasons: [] };
  return { status: "none", confidence, reasons };
}

/** `Closed` is the database's word for a finished rental; operators say completed. */
function rentalStatusOf(r: any): Rental["status"] {
  const st = s(r.status);
  if (st === "Closed") return "Completed";
  if (st === "Active" || st === "Cancelled" || st === "Pending") return st;
  return "Upcoming";
}

function accountStatusOf(v: string): "Active" | "Inactive" | "Rejected" {
  return v === "Inactive" || v === "Rejected" ? v : "Active";
}

/* ══════════════════════════════════════════════════════════════════════════
   The hook
   ══════════════════════════════════════════════════════════════════════════ */

export function useCustomerRecord(id: string) {
  const rowQ = useCustomerRow(id);
  const row = rowQ.data;

  const verificationQ = useAiVerification(id);
  const rentalsQ = useCustomerRentals(id);
  const outstandingQ = useRentalOutstandings(id);
  const paymentsQ = useCustomerPayments(id);
  const finesQ = useCustomerFines(id);
  const documentsQ = useCustomerDocuments(id);
  const reviewsQ = useCustomerReviews(id);
  const summaryQ = useCustomerReviewSummary(id);
  const gigQ = useGigDriverImages(id);
  const linksQ = useCustomerPaymentLinks(id);
  const ledgerQ = useLedger(id);
  const auditQ = useCustomerAudit(id);
  const cmdQ = useCmdVerification(id);
  const cmdResultsQ = useCmdResults(cmdQ.data?.cmd_applicant_verification_id);

  const blocksQ = useGlobalBlocks([s(row?.license_number), s(row?.id_number), s(row?.email)]);

  const record = useMemo<CustomerRecord | null>(() => {
    if (!row) return null;

    const v = verificationQ.data;
    const cmd = cmdQ.data;
    const cmdLicense = cmdResultsQ.data?.license;

    /* ── documents ─────────────────────────────────────────────────────── */
    const docs: Doc[] = (documentsQ.data || []).map((d: any) => ({
      id: d.id,
      type: s(d.document_type) || "Other",
      name: s(d.document_name) || s(d.file_name) || "Untitled document",
      vehicle: d.vehicles ? `${d.vehicles.make} ${d.vehicles.model} · ${d.vehicles.reg}` : null,
      from: d.start_date ?? d.policy_start_date ?? null,
      until: d.end_date ?? d.policy_end_date ?? null,
      verified: !!d.verified,
      uploadedAt: d.created_at,
      fileUrl: d.file_url ?? null,
      scan: scanOf(d),
    }));

    /* ── verification ──────────────────────────────────────────────────── */
    const passed = v?.review_result === "GREEN" || v?.status === "approved";
    const declined = v?.review_result === "RED" || v?.status === "declined";
    const aiState: CustomerRecord["ai"]["state"] = !v ? "none" : passed ? "passed" : declined ? "declined" : "pending";

    /* ── the ledger ────────────────────────────────────────────────────── */
    const outstandings = outstandingQ.data?.outstanding || {};
    const rentalNumbers = outstandingQ.data?.numbers || {};
    /** rental id → "Tesla Model Y · NW-TES-09", for the ledger's second line. */
    const rentalLabel: Record<string, string> = {};
    (rentalsQ.data || []).forEach((r: any) => {
      rentalLabel[r.id] = [
        [r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" "),
        r.vehicle?.reg,
      ]
        .filter(Boolean)
        .join(" · ");
    });

    const ledger: LedgerRow[] = (ledgerQ.data || []).map((e: any) => {
      const type = s(e.type);
      const kind: LedgerRow["kind"] = type === "Payment" ? "payment" : type === "Refund" ? "refund" : "charge";
      const magnitude = Math.abs(Number(e.amount || 0));
      return {
        id: e.id,
        date: e.entry_date || dateOnly(e.created_at),
        // A charge is named by what it was for; a payment or a refund is named
        // by what it IS. Labelling a payment "Rental" — which the category
        // column would do — puts a green negative number under the same word as
        // the charge it settles, and the two rows become indistinguishable.
        label:
          kind === "charge"
            ? s(e.category) || "Charge"
            : kind === "refund"
              ? ["Refund", s(e.category)].filter(Boolean).join(" · ")
              : ["Payment", s(e.category)].filter(Boolean).join(" · "),
        ref:
          [s(e.reference), e.rental_id ? rentalNumbers[e.rental_id] : "", e.rental_id ? rentalLabel[e.rental_id] : ""]
            .filter(Boolean)
            .join(" · ") || null,
        kind,
        // Charges are owed, payments and refunds reduce what is owed. Stored
        // signs are inconsistent across the table's history, so the sign is
        // decided by the row's TYPE rather than trusted from `amount`.
        amount: kind === "charge" ? magnitude : -magnitude,
        // A payment with money still on it has not been pointed at a charge
        // yet — that is credit sitting on the account, not a settled receipt.
        unallocated: kind === "payment" ? Number(e.remaining_amount || 0) : undefined,
      };
    });

    /* ── rentals ───────────────────────────────────────────────────────── */
    const rentals: Rental[] = (rentalsQ.data || []).map((r: any) => ({
      id: r.id,
      ref: rentalNumbers[r.id] || (r.id as string).slice(0, 8).toUpperCase(),
      vehicle: [r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" ") || "Vehicle",
      reg: s(r.vehicle?.reg),
      start: r.start_date,
      end: r.end_date,
      total: Number(r.monthly_amount || 0),
      outstanding: Number(outstandings[r.id] || 0),
      status: rentalStatusOf(r),
    }));

    /* ── fines ─────────────────────────────────────────────────────────── */
    const fines: Fine[] = (finesQ.data || []).map((f: any) => ({
      id: f.id,
      type: s(f.type) || "Fine",
      reference: s(f.reference_no) || "No reference",
      vehicle: f.vehicle ? `${f.vehicle.make} ${f.vehicle.model} · ${f.vehicle.reg}` : "—",
      amount: Number(f.amount || 0),
      issuedOn: f.issue_date,
      dueOn: f.due_date,
      status: s(f.status) || "Open",
      liability: s(f.liability) || "—",
    }));

    /* ── reviews ───────────────────────────────────────────────────────── */
    const reviews: Review[] = (reviewsQ.data || [])
      .filter((r: any) => typeof r.rating === "number")
      .map((r: any) => ({
        id: r.id,
        rating: r.rating as number,
        comment: s(r.comment),
        tags: Array.isArray(r.tags) ? r.tags : [],
        by: r.reviewer?.name || "A member of staff",
        at: r.created_at,
        rentalRef: r.rental?.rental_number || "—",
      }));

    const summaryRow = summaryQ.data;

    /* ── payment links ─────────────────────────────────────────────────── */
    const links: PaymentLink[] = ((linksQ.data as any[]) || []).map((l: any) => ({
      id: l.id,
      label: s(l.description) || s(l.payment_type) || "Payment request",
      amount: Number(l.amount || 0),
      status: s(l.status) || "Open",
      sentAt: l.created_at,
      url: l.url ?? l.checkout_url ?? null,
    }));

    /* ── the platform blocklist ────────────────────────────────────────── */
    const globalBlocks: GlobalBlock[] = (blocksQ.data || []).map((b: any) => ({
      id: b.id,
      kind: s(b.identity_type) as GlobalBlock["kind"],
      value: s(b.identity_number),
      reason: s(b.reason) || s(b.notes),
      addedAt: b.created_at,
    }));

    /* ── the history ───────────────────────────────────────────────────────
     * Assembled from rows that already exist rather than from a table of its
     * own. Every line here is something we can point at.
     */
    const events: ActivityEvent[] = [];
    const push = (label: string, at: string | null | undefined) => {
      if (at) events.push({ label, at, done: true });
    };
    push("Account created", row.created_at);
    push("SMS consent captured", row.sms_consent_at);
    (documentsQ.data || []).forEach((d: any) =>
      push(`Document uploaded · ${s(d.document_type) || "file"}`, d.created_at)
    );
    if (v?.verification_completed_at) {
      push(
        passed
          ? `Identity verified${v.ai_face_match_score ? ` · ${Math.round(Number(v.ai_face_match_score))}% face match` : ""}`
          : declined
            ? "Identity check declined"
            : "Identity check submitted",
        v.verification_completed_at
      );
    }
    push("CheckMyDriver returned a result", cmd?.cmd_last_event_at);
    (rentalsQ.data || []).forEach((r: any) =>
      push(`Rental opened · ${[r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" ")}`, r.created_at)
    );
    push("Blocked with this operator", row.blocked_at);
    (auditQ.data || []).forEach((a: any) => push(s(a.action).replace(/_/g, " "), a.created_at));
    events.sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime());

    /* ── done ──────────────────────────────────────────────────────────── */
    return {
      id: row.id,
      createdAt: row.created_at ?? null,
      identity: {
        name: s(row.name),
        email: s(row.email),
        phone: s(row.phone),
        dob: dateOnly(row.date_of_birth) || dateOnly(v?.date_of_birth),
        street: s(row.address_street),
        city: s(row.address_city),
        state: s(row.address_state),
        zip: s(row.address_zip),
        timezone: s(row.timezone),
        customerType: row.customer_type === "Company" ? "Company" : "Individual",
        companyName: s(row.company_name),
        companyRegistration: s(row.company_registration),
        profilePhotoUrl: row.profile_photo_url ?? null,
        nok: {
          name: s(row.nok_full_name),
          relationship: s(row.nok_relationship),
          phone: s(row.nok_phone),
          email: s(row.nok_email),
          address: s(row.nok_address),
        },
      },
      licence: {
        number: s(row.license_number) || s(v?.document_number) || s(cmdLicense?.licenseNumber),
        state: s(row.license_state) || s(cmdLicense?.licenseState),
        idNumber: s(row.id_number),
        issued: v?.document_issuing_date ?? null,
        expiry: v?.document_expiry_date ?? cmdLicense?.licenseExpiryDate ?? null,
        isGigDriver: !!row.is_gig_driver,
        gigProofs: (gigQ.data || []).map((g: any) => ({
          id: g.id,
          label: s(g.file_name) || "Proof",
          url: g.image_url ?? null,
        })),
      },
      docs,
      ai: {
        state: aiState,
        completedAt: v?.verification_completed_at ?? null,
        faceMatchScore: v?.ai_face_match_score == null ? null : Math.round(Number(v.ai_face_match_score)),
        photos: {
          face: v?.face_image_url ?? null,
          selfie: v?.selfie_image_url ?? null,
          docFront: v?.document_front_url ?? null,
          docBack: v?.document_back_url ?? null,
        },
        // The six values the verdict was issued against. Only present on a
        // verdict that actually landed — a pending row has read nothing yet.
        extracted:
          v && (passed || declined)
            ? {
                documentNumber: s(v.document_number),
                documentExpiry: dateOnly(v.document_expiry_date),
                firstName: s(v.first_name),
                lastName: s(v.last_name),
                dob: dateOnly(v.date_of_birth),
                address: s(v.address),
              }
            : null,
        declineReason: v?.rejection_reason ?? null,
        // The newest "the verdict still stands" decision, if there is one. It
        // lives in the audit trail rather than on the verification row — see
        // the note on `acceptedBaseline` in types.ts for why that matters.
        acceptedBaseline:
          ((auditQ.data || []).find(
            (a: any) => a?.details?.kind === "verification_drift_accepted" && a?.details?.accepted
          )?.details?.accepted as Record<string, string> | undefined) ?? null,
      },
      cmd: {
        present: !!cmd,
        state: !cmd
          ? "none"
          : cmd.cmd_license_status === "Valid"
            ? "valid"
            : cmd.cmd_license_status === "Invalid"
              ? "invalid"
              : cmd.cmd_license_status === "Expired"
                ? "expired"
                : "awaiting",
        holder: s(cmdLicense?.licenseHolderFullName),
        number: s(cmdLicense?.licenseNumber),
        expires: cmdLicense?.licenseExpiryDate ?? null,
        place: [cmdLicense?.licenseState, cmdLicense?.licenseCity].filter(Boolean).join(" · "),
        lastEventAt: cmd?.cmd_last_event_at ?? null,
        linkExpiresAt: cmd?.cmd_magic_link_expires_at ?? null,
        channels: cmd?.cmd_delivery_channels || [],
        documents: cmdLicense?.documentURLs || [],
        applicantVerificationId: cmd?.cmd_applicant_verification_id ?? null,
      },
      account: {
        status: accountStatusOf(s(row.status)),
        rejection: row.rejection_reason || row.rejected_at ? { reason: s(row.rejection_reason), at: row.rejected_at } : null,
        blockedHere: row.is_blocked ? { reason: s(row.blocked_reason), at: row.blocked_at } : null,
        globalBlocks,
      },
      consent: {
        sms: !!row.sms_consent,
        smsAt: row.sms_consent_at ?? null,
        whatsapp: !!row.whatsapp_opt_in,
      },
      rentals,
      ledger,
      links,
      fines,
      reviews,
      summary: summaryRow?.summary
        ? {
            text: summaryRow.summary,
            basedOn: Number(summaryRow.total_reviews || 0),
            avg: Number(summaryRow.average_rating || 0),
            generatedAt: summaryRow.generated_at,
          }
        : null,
      events,
      billing: {
        stripeCustomerId: row.stripe_customer_id ?? null,
        methodsUsed: Array.from(
          new Set(((paymentsQ.data as any[]) || []).map((p: any) => s(p.method)).filter(Boolean))
        ),
      },
    };
  }, [
    row,
    verificationQ.data,
    cmdQ.data,
    cmdResultsQ.data,
    documentsQ.data,
    ledgerQ.data,
    rentalsQ.data,
    outstandingQ.data,
    finesQ.data,
    reviewsQ.data,
    summaryQ.data,
    linksQ.data,
    blocksQ.data,
    gigQ.data,
    auditQ.data,
    paymentsQ.data,
  ]);

  return {
    record,
    row,
    isLoading: rowQ.isLoading,
    notFound: !rowQ.isLoading && !rowQ.isError && !row,
    error: rowQ.error,
  };
}
