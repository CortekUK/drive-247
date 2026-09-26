/**
 * Finances — the reads. Every row the model needs, read in full.
 *
 * Rules (docs/FINANCES_DESIGN.md §6):
 *   - Never a truncated total: every select is paged with `.range()` until a
 *     short page comes back (lib/finances/paging.ts), ordered by `id` so rows
 *     cannot slide between pages.
 *   - Tenant-scoped: every table that carries `tenant_id` is filtered by it.
 *     `payment_applications` is read by the ids of this tenant's charges (and,
 *     under a scope, payments) instead — the same join the drift report uses.
 *     Its live RLS policy is `USING (true)` and its `tenant_id` is filled by a
 *     trigger with no backfill on record, so a `tenant_id` filter could drop an
 *     old allocation and make a correct bill read as "doesn't add up".
 *   - supabase-js never throws: every `{ error }` becomes a thrown
 *     FinanceLoadError, so the page shows an error state, never a zero.
 *   - The payment-plan tables, and `payments.payment_plan_occurrence_id`, are
 *     read only when they exist. `plansAvailable` (from usePaymentPlansFeature)
 *     is only a hint: its probe is a HEAD request, and postgrest-js turns a
 *     bodiless 404 into a success, so on a database WITHOUT the tables it
 *     answers "available". The loader therefore confirms with a real GET of
 *     `payment_plans`: "relation does not exist" / PGRST205 means no plans —
 *     nothing plan-shaped is read, the occurrence column is not selected, and
 *     the page still loads. Any other error is an error.
 *   - A scope (`rentalId` / `customerId`) narrows every read — the same model
 *     on a rental's or a customer's page (slice 2b).
 */

import { fetchAllByIds, fetchAllPages, FinanceLoadError, type PageFetcher } from "@/lib/finances/paging";
import { isMissingRelation } from "@/lib/payment-plans-ui/feature";
import type {
  FinanceRawData,
  FinanceScope,
  RawAccrual,
  RawApplication,
  RawAttempt,
  RawCharge,
  RawCustomer,
  RawExtension,
  RawInvoice,
  RawOccurrence,
  RawPayment,
  RawPlan,
  RawRental,
  RawVehicle,
} from "@/lib/finances/types";

/** The slice of a Supabase client the loader uses — tests hand in a fake. */
export interface FinanceClient {
  from: (table: string) => any;
}

export const RENTAL_COLUMNS =
  "id, rental_number, customer_id, vehicle_id, status, approval_status, is_pay_as_you_go, payg_closed_at, start_date, created_at";
export const CHARGE_COLUMNS =
  "id, type, rental_id, customer_id, vehicle_id, extension_id, category, amount, remaining_amount, due_date, entry_date, created_at, reference";
export const APPLICATION_COLUMNS = "id, payment_id, charge_entry_id, amount_applied";
export const PAYMENT_COLUMNS =
  "id, customer_id, rental_id, vehicle_id, extension_id, amount, remaining_amount, refund_amount, status, capture_status, payment_type, method, payment_date, paid_at, created_at, verification_status, stripe_payment_intent_id, stripe_checkout_session_id, square_payment_id, square_order_id, square_payment_link_id, payment_provider, booking_source";
export const PLAN_PAYMENT_COLUMN = "payment_plan_occurrence_id";
export const INVOICE_COLUMNS = "id, rental_id, invoice_number, created_at";
export const EXTENSION_COLUMNS = "id, rental_id, sequence_number, status, created_at";
/** The hook's own PAYG read (use-customer-balance.ts), tenant-wide. */
export const ACCRUAL_COLUMNS = "id, rental_id, daily_rate, tax_amount, service_fee_amount, rentals!inner(customer_id, payg_closed_at)";
export const PLAN_COLUMNS = "id, rental_id, customer_id, status, timezone";
export const OCCURRENCE_COLUMNS = "id, plan_id, rental_id, seq, due_date, amount, amount_paid, collection_method, status, next_attempt_at";
export const ATTEMPT_COLUMNS =
  "id, occurrence_id, attempt_no, status, provider, provider_account, provider_mode, provider_ref, checkout_session_id, payment_id, decline_code, error_code, created_by, created_at";

type Build = (q: any) => any;

export async function loadFinanceData(
  client: FinanceClient,
  tenantId: string,
  scope: FinanceScope = {},
  plansAvailable = false,
): Promise<FinanceRawData> {
  if (!tenantId) throw new Error("No tenant context available");
  const rentalId = scope.rentalId || null;
  const customerId = scope.customerId || null;
  const scoped = !!(rentalId || customerId);

  /** A paged, tenant-filtered, id-ordered read of one table. */
  const pages = <T>(label: string, table: string, columns: string, narrow: Build = (q) => q): PageFetcher<T> =>
    (from, to) => narrow(client.from(table).select(columns).eq("tenant_id", tenantId)).order("id", { ascending: true }).range(from, to);

  const all = <T>(label: string, table: string, columns: string, narrow?: Build) =>
    fetchAllPages<T>(label, pages<T>(label, table, columns, narrow));

  const byIds = <T>(label: string, table: string, columns: string, column: string, ids: Iterable<string | null | undefined>, tenantFilter = true) =>
    fetchAllByIds<T>(label, ids, (chunkIds) => (from, to) => {
      let q = client.from(table).select(columns);
      if (tenantFilter) q = q.eq("tenant_id", tenantId);
      return q.in(column, chunkIds).order("id", { ascending: true }).range(from, to);
    });

  const narrowBy = (rentalColumn: string, customerColumn: string): Build => (q) => {
    let n = q;
    if (rentalId) n = n.eq(rentalColumn, rentalId);
    if (customerId) n = n.eq(customerColumn, customerId);
    return n;
  };

  /**
   * The plan tables' verdict, from a real GET (see the header). Missing → no
   * plans and no occurrence column; any other failure → thrown.
   */
  const plansRead: Promise<{ on: boolean; rows: RawPlan[] }> = !plansAvailable
    ? Promise.resolve({ on: false, rows: [] })
    : all<RawPlan>("payment plans", "payment_plans", PLAN_COLUMNS, narrowBy("rental_id", "customer_id")).then(
        (rows) => ({ on: true, rows }),
        (err) => {
          if (err instanceof FinanceLoadError && isMissingRelation(err.cause)) return { on: false, rows: [] as RawPlan[] };
          throw err;
        },
      );

  const readPayments = (withPlanColumn: boolean) =>
    all<RawPayment>(
      "payments",
      "payments",
      withPlanColumn ? `${PAYMENT_COLUMNS}, ${PLAN_PAYMENT_COLUMN}` : PAYMENT_COLUMNS,
      narrowBy("rental_id", "customer_id"),
    );
  // Belt and braces: the column arrives with the plan tables (one migration),
  // but a database caught between the two must not take the page down.
  const paymentsRead = plansRead.then(({ on }) =>
    !on
      ? readPayments(false)
      : readPayments(true).catch((err) => {
          if (err instanceof FinanceLoadError && err.code === "42703" && err.pgMessage.includes(PLAN_PAYMENT_COLUMN)) return readPayments(false);
          throw err;
        }),
  );

  // ── round 1: the tenant's (or the scope's) own rows ─────────────────────
  const [rentals, chargesOwn, accruals, planResult, payments] = await Promise.all([
    all<RawRental>("rentals", "rentals", RENTAL_COLUMNS, narrowBy("id", "customer_id")),
    all<RawCharge>("charges", "ledger_entries", CHARGE_COLUMNS, (q) => narrowBy("rental_id", "customer_id")(q.eq("type", "Charge"))),
    all<RawAccrual>("pay-as-you-go accruals", "payg_accruals", ACCRUAL_COLUMNS, (q) =>
      narrowBy("rental_id", "rentals.customer_id")(q.eq("invoice_status", "open").is("rentals.payg_closed_at", null)),
    ),
    plansRead,
    paymentsRead,
  ]);
  const plansOn = planResult.on;
  const plans = planResult.rows;

  // ── round 2: allocations, and the plan rows under the plans ──────────────
  const [applicationsByCharge, applicationsByPayment, occurrences] = await Promise.all([
    byIds<RawApplication>("payment allocations", "payment_applications", APPLICATION_COLUMNS, "charge_entry_id", chargesOwn.map((c) => c.id), false),
    // Unscoped, every allocation of this tenant's payments lands on one of the
    // charges read above. Under a scope a payment can settle a charge on
    // another rental, so its allocations are read by payment as well.
    scoped
      ? byIds<RawApplication>("payment allocations", "payment_applications", APPLICATION_COLUMNS, "payment_id", payments.map((p) => p.id), false)
      : Promise.resolve([] as RawApplication[]),
    !plansOn
      ? Promise.resolve([] as RawOccurrence[])
      : scoped
        ? byIds<RawOccurrence>("payment plan occurrences", "payment_plan_occurrences", OCCURRENCE_COLUMNS, "plan_id", plans.map((p) => p.id))
        : all<RawOccurrence>("payment plan occurrences", "payment_plan_occurrences", OCCURRENCE_COLUMNS),
  ]);

  const seenApplication = new Set<string>();
  const applications: RawApplication[] = [];
  for (const a of [...applicationsByCharge, ...applicationsByPayment]) {
    const k = a.id ?? `${a.payment_id}|${a.charge_entry_id}|${a.amount_applied}`;
    if (seenApplication.has(k)) continue;
    seenApplication.add(k);
    applications.push(a);
  }

  // ── round 3: whatever the rows above point at that is not loaded yet ────
  const chargeIds = new Set(chargesOwn.map((c) => c.id));
  const missingCharges = applications.map((a) => a.charge_entry_id).filter((id) => id && !chargeIds.has(id));
  const attemptsPromise = !plansOn
    ? Promise.resolve([] as RawAttempt[])
    : scoped
      ? byIds<RawAttempt>("payment plan attempts", "payment_plan_attempts", ATTEMPT_COLUMNS, "occurrence_id", occurrences.map((o) => o.id))
      : all<RawAttempt>("payment plan attempts", "payment_plan_attempts", ATTEMPT_COLUMNS);
  const [extraCharges, attempts] = await Promise.all([
    byIds<RawCharge>("charges", "ledger_entries", CHARGE_COLUMNS, "id", missingCharges),
    attemptsPromise,
  ]);

  const rentalIds = new Set(rentals.map((r) => r.id));
  const missingRentals = [
    ...chargesOwn.map((c) => c.rental_id),
    ...extraCharges.map((c) => c.rental_id),
    ...payments.map((p) => p.rental_id),
    ...accruals.map((a) => a.rental_id),
    ...plans.map((p) => p.rental_id),
    ...occurrences.map((o) => o.rental_id),
  ].filter((id) => id && !rentalIds.has(id));
  const extraRentals = await byIds<RawRental>("rentals", "rentals", RENTAL_COLUMNS, "id", missingRentals);
  const allRentals = [...rentals, ...extraRentals];
  const allRentalIds = allRentals.map((r) => r.id);

  const customerIds = [
    ...allRentals.map((r) => r.customer_id),
    ...chargesOwn.map((c) => c.customer_id),
    ...payments.map((p) => p.customer_id),
    ...plans.map((p) => p.customer_id),
    ...accruals.map((a) => a.rentals?.customer_id ?? null),
  ];
  const vehicleIds = [...allRentals.map((r) => r.vehicle_id), ...chargesOwn.map((c) => c.vehicle_id), ...payments.map((p) => p.vehicle_id)];

  const [invoices, extensions, customers, vehicles] = await Promise.all([
    scoped
      ? byIds<RawInvoice>("invoices", "invoices", INVOICE_COLUMNS, "rental_id", allRentalIds)
      : all<RawInvoice>("invoices", "invoices", INVOICE_COLUMNS),
    scoped
      ? byIds<RawExtension>("extensions", "rental_extensions", EXTENSION_COLUMNS, "rental_id", allRentalIds)
      : all<RawExtension>("extensions", "rental_extensions", EXTENSION_COLUMNS),
    byIds<RawCustomer>("customers", "customers", "id, name", "id", customerIds),
    byIds<RawVehicle>("vehicles", "vehicles", "id, reg", "id", vehicleIds),
  ]);

  return {
    rentals: allRentals,
    charges: chargesOwn,
    linkedCharges: extraCharges,
    applications,
    payments,
    invoices,
    extensions,
    accruals,
    customers,
    vehicles,
    plans,
    occurrences,
    attempts,
    plansAvailable: plansOn,
  };
}
