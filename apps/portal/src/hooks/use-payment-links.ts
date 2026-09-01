import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Payment-link history: a read-only view of every Stripe payment link/request
// staff have sent for a rental or customer. Source of truth is the `payments`
// table — every link-creation path (create-checkout-session, extension pay-links,
// installments, upfront, "Email Stripe Link", etc.) writes a row keyed by
// stripe_checkout_session_id.
//
// Status is derived by CAPTURE state AND the staff Accept/Reject decision
// (verification_status). The naive approach (used by the old PaymentStatusBadge)
// mislabels a captured-but-unallocated Credit row as "unpaid" — money that is actually
// in hand. Precedence: Deposit-hold > Paid (captured) > Voided > Rejected/Approved
// (staff decision) > Superseded > Expired > Awaiting. Verification sits AFTER capture so
// money-in-hand always wins, and BEFORE the age fallback so a declined/approved payment
// never masquerades as an open "Awaiting"/"Expired" link (matches the Payments tab).

export type PaymentLinkStatus =
  | "paid"
  | "awaiting"
  | "expired"
  | "superseded"
  | "deposit_hold"
  | "voided"
  | "rejected"
  | "approved";

export interface PaymentLink {
  id: string;
  amount: number;
  status: PaymentLinkStatus;
  rawStatus: string | null;
  captureStatus: string | null;
  paymentType: string | null;
  method: string | null;
  bookingSource: string | null;
  createdAt: string;
  paidAt: string | null;
  rentalId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  extensionId: string | null;
  targetCategories: string[] | null;
  checkoutUrl: string | null; // only persisted for extension links today
  preauthExpiresAt: string | null;
}

const LINK_SELECT =
  "id, amount, status, capture_status, verification_status, payment_type, method, booking_source, created_at, paid_at, stripe_checkout_session_id, stripe_payment_intent_id, extension_id, target_categories, preauth_expires_at, rental_id, customer_id";

// Stripe Checkout sessions expire ~24h after creation. The checkout.session.expired
// webhook only cancels the rental — it never flips the payments row — so age is the
// only reliable "expired" signal for an unpaid link.
const EXPIRY_MS = 24 * 60 * 60 * 1000;

function normalizeCategories(cats: unknown): string {
  if (!Array.isArray(cats) || cats.length === 0) return "";
  return [...cats].map(String).sort().join(",");
}

// Two links target "the same thing" when they share rental, extension, and the
// same set of target categories. A newer link for the same target supersedes an
// older unpaid one (staff re-sent it).
function targetKey(row: any): string {
  // Scope by CUSTOMER first. The tenant-wide Payment Requests view feeds rows from many
  // customers through here; two DIFFERENT customers' unpaid account-level links
  // (rental_id/extension_id/categories all null) with the same amount would otherwise
  // collapse to one key and wrongly mark one 'superseded' — showing a live request as
  // dead. customer_id is constant within the per-rental and per-customer panels, so
  // adding it is a no-op there (LINK_SELECT already selects customer_id). Then include
  // amount so genuinely-distinct same-rental links with NULL categories (e.g. a deposit
  // request and a general balance request) don't collapse. A true re-send (same customer
  // + target + amount, newer created_at) still shares the key and supersedes the older.
  return `${row.customer_id ?? ""}|${row.rental_id ?? ""}|${row.extension_id ?? ""}|${normalizeCategories(row.target_categories)}|${Number(row.amount || 0).toFixed(2)}`;
}

function isCaptured(row: any): boolean {
  // An uncaptured pre-authorization hold can carry status 'Applied'/'Partial'
  // while capture_status='requires_capture' — that is authorized, NOT money in
  // hand. Mirror the availableCredit fix (use-customer-balance): the status
  // branch only counts when it is NOT an uncaptured hold. A real capture
  // (capture_status='captured') or a real paid_at / payment intent still wins.
  return (
    row.capture_status === "captured" ||
    row.stripe_payment_intent_id != null ||
    row.paid_at != null ||
    (["Applied", "Completed", "Partial"].includes(row.status) &&
      row.capture_status !== "requires_capture")
  );
}

function isDepositHold(row: any): boolean {
  return (
    row.payment_type === "InitialFee" &&
    row.capture_status === "requires_capture" &&
    row.preauth_expires_at != null
  );
}

// A single unpaid link that staff cancelled via void-payment-link. The void writes
// capture_status='cancelled' + status='Reversed'; either marks the link as dead.
function isVoided(row: any): boolean {
  return row.capture_status === "cancelled" || row.status === "Reversed";
}

// Exported for unit testing / reuse. `now` is injectable for deterministic tests.
export function derivePaymentLinks(
  rows: any[],
  extensionUrlById: Record<string, string> = {},
  now: number = Date.now(),
): PaymentLink[] {
  // Newest created_at per target key → detect superseded links.
  const newestByKey = new Map<string, number>();
  for (const r of rows) {
    const k = targetKey(r);
    const t = new Date(r.created_at).getTime();
    const prev = newestByKey.get(k);
    if (prev == null || t > prev) newestByKey.set(k, t);
  }

  return rows.map((r) => {
    let status: PaymentLinkStatus;
    // Precedence: money-in-hand (deposit hold / captured) is classified BEFORE 'voided',
    // so a genuinely captured payment that was later reversed (status='Reversed' via
    // reverse-payment) still reads 'Paid', not 'Voided'. A voided link is unpaid, so it
    // never matches isCaptured and correctly falls through to 'voided'.
    if (isDepositHold(r)) {
      status = "deposit_hold";
    } else if (isCaptured(r)) {
      status = "paid";
    } else if (isVoided(r)) {
      status = "voided";
    } else if (r.verification_status === "rejected") {
      // Staff DECLINED this payment via the Accept/Reject flow. reject_payment only
      // flips verification_status — it never touches capture_status/status/paid_at — so
      // without this branch the panel keeps showing a declined payment as an open
      // 'Awaiting'/'Expired'/'Superseded' link (the confirmed Goniko/Paulette bug).
      status = "rejected";
    } else if (r.verification_status === "approved") {
      // Staff-approved but not (yet) captured on Stripe. Show 'Approved' to match the
      // Payments tab rather than 'Awaiting'. (Approved AND captured is already 'paid'
      // above via isCaptured, so this only affects the uncaptured case.)
      status = "approved";
    } else {
      const created = new Date(r.created_at).getTime();
      const newest = newestByKey.get(targetKey(r)) ?? created;
      if (newest > created) {
        status = "superseded";
      } else if (now - created >= EXPIRY_MS) {
        status = "expired";
      } else {
        status = "awaiting";
      }
    }
    return {
      id: r.id,
      amount: Number(r.amount || 0),
      status,
      rawStatus: r.status ?? null,
      captureStatus: r.capture_status ?? null,
      paymentType: r.payment_type ?? null,
      method: r.method ?? null,
      bookingSource: r.booking_source ?? null,
      createdAt: r.created_at,
      paidAt: r.paid_at ?? null,
      rentalId: r.rental_id ?? null,
      stripeCheckoutSessionId: r.stripe_checkout_session_id ?? null,
      stripePaymentIntentId: r.stripe_payment_intent_id ?? null,
      extensionId: r.extension_id ?? null,
      targetCategories: Array.isArray(r.target_categories) ? r.target_categories : null,
      checkoutUrl: r.extension_id ? extensionUrlById[r.extension_id] ?? null : null,
      preauthExpiresAt: r.preauth_expires_at ?? null,
    };
  });
}

async function fetchLinks(
  column: "rental_id" | "customer_id",
  value: string,
  tenantId: string,
): Promise<PaymentLink[]> {
  const { data, error } = await supabaseUntyped
    .from("payments")
    .select(LINK_SELECT)
    .eq(column, value)
    .eq("tenant_id", tenantId)
    .not("stripe_checkout_session_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data as any[]) || [];

  // Extension links are the only ones with a stored, reusable customer URL — join
  // them so "Copy link" works for renewals without any schema change.
  const extIds = Array.from(new Set(rows.map((r) => r.extension_id).filter(Boolean)));
  const extUrlById: Record<string, string> = {};
  if (extIds.length > 0) {
    const { data: exts } = await supabaseUntyped
      .from("rental_extensions")
      .select("id, checkout_url")
      .in("id", extIds);
    for (const e of (exts as any[]) || []) {
      if (e.checkout_url) extUrlById[e.id] = e.checkout_url;
    }
  }

  return derivePaymentLinks(rows, extUrlById);
}

export function useRentalPaymentLinks(rentalId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["rental-payment-links", tenant?.id, rentalId],
    queryFn: () => fetchLinks("rental_id", rentalId!, tenant!.id),
    enabled: !!rentalId && !!tenant?.id,
    staleTime: 15_000,
  });
}

export function useCustomerPaymentLinks(customerId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["customer-payment-links", tenant?.id, customerId],
    queryFn: () => fetchLinks("customer_id", customerId!, tenant!.id),
    enabled: !!customerId && !!tenant?.id,
    staleTime: 15_000,
  });
}

// A payment request/link as shown on the tenant-wide "Payment Requests" view (Invoices
// page), enriched with the customer name so operators can see every request they sent
// in one place. Status uses the SAME derivePaymentLinks logic as the per-rental/customer
// panel, so the labels are guaranteed consistent across all three surfaces.
export interface TenantPaymentRequest extends PaymentLink {
  customerName: string | null;
  customerId: string | null;
}

async function fetchTenantPaymentRequests(tenantId: string): Promise<TenantPaymentRequest[]> {
  const { data, error } = await supabaseUntyped
    .from("payments")
    .select(`${LINK_SELECT}, customers:customer_id ( name )`)
    .eq("tenant_id", tenantId)
    .not("stripe_checkout_session_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data as any[]) || [];
  // derivePaymentLinks preserves input order 1:1, so index i lines up with rows[i].
  const derived = derivePaymentLinks(rows);
  return derived.map((link, i) => ({
    ...link,
    customerName: rows[i]?.customers?.name ?? null,
    customerId: rows[i]?.customer_id ?? null,
  }));
}

export function useTenantPaymentRequests() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["tenant-payment-requests", tenant?.id],
    queryFn: () => fetchTenantPaymentRequests(tenant!.id),
    enabled: !!tenant?.id,
    staleTime: 15_000,
  });
}
