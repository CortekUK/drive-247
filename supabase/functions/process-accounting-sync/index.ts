/**
 * process-accounting-sync — THE HEART (Spec §9.1, §14).
 *
 * Cron-triggered every 2 minutes. Walks the `financial_event_sync_state`
 * queue, calls the right provider via the abstraction layer, persists
 * external refs + state transitions. Honours:
 *
 *   - Spec §8.3: one invoice per rental until closed; extensions get new invoices
 *   - Spec §7.3: idempotency (Xero Idempotency-Key)
 *   - Spec §14.2: error classification → retry / mark-expired / surface
 *   - Spec §14 backoff schedule: 1m, 5m, 30m, 2h, 12h, dead-letter
 *
 * Claims a bounded batch (ACCOUNTING_SYNC_BATCH_SIZE, default 40) through the
 * `process_accounting_sync_claim_batch` RPC, which uses FOR UPDATE SKIP LOCKED
 * so overlapping cron ticks take disjoint rows, leases each claim so a dead
 * worker's batch is reclaimed rather than stranded, and skips dead-lettered
 * rows. Each row goes through:
 *
 *   1. ensureContact(provider, event) → external contact id
 *   2. handleEventByType(event, contactId):
 *      - rental_charge / damage_charge / mileage_charge / late_fee /
 *        insurance_charge / charging_cost / discount → ensureInvoice + append line
 *      - extension_charge → ALWAYS new invoice (rental-to-invoice rule)
 *      - payment_receipt → recordPayment against open invoice
 *      - refund → createCreditNote against source invoice
 *      - deposit_capture → new invoice with "Customer Deposit" line
 *      - security_hold_release / maintenance_expense / partner_payout → skip
 *
 * State machine: pending → syncing → synced / failed.
 * Failures: bump attempts, set next_attempt_at per backoff, write last_error/code.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getProvider } from "../_shared/accounting/factory.ts";
import {
  AccountingProvider,
  InvoiceLine,
  ProviderError,
  ProviderName,
  SyncErrorClass,
} from "../_shared/accounting/types.ts";
import { nextAttemptAfter } from "../_shared/accounting/backoff.ts";
import { isFinalisedStatus } from "../_shared/accounting/rental-status.ts";

// Rows claimed per tick. Deliberately well below the old value of 100: each row
// costs 2–3 provider API calls (ensure contact → find invoice → create/append),
// so a 100-row batch meant 200–300 Xero calls against a 60-calls/minute limit.
// That guaranteed a 429 partway through every large batch.
const BATCH_SIZE = Number(Deno.env.get("ACCOUNTING_SYNC_BATCH_SIZE") ?? 40);

// How long a claimed row may stay in-flight before another tick may reclaim it.
// Must exceed the worst-case processing time for one row.
const CLAIM_TIMEOUT_MINUTES = Number(Deno.env.get("ACCOUNTING_SYNC_CLAIM_TIMEOUT_MINUTES") ?? 15);

// Provider API budget for a single tick, expressed in ACTUAL API CALLS, not
// rows. The cron fires every 2 minutes, so the budget is (limit/min × 2) with
// headroom left for the OAuth refresh cron sharing the same quota.
//
// The previous formula was `Math.ceil(LIMIT * (2 / 60)) * 60`, which collapses
// to 120 for Xero regardless of the configured limit — above BATCH_SIZE, so
// the guard could never fire even once.
const RATE_LIMIT_XERO = Number(Deno.env.get("ACCOUNTING_SYNC_RATE_LIMIT_XERO") ?? 55);
const TICK_MINUTES = 2;
const CALLS_PER_ROW = 3;   // worst case: ensureContact + findInvoice + create/append

/**
 * Unique id for this cron-tick invocation. The `rental_sync_locks` table uses
 * it to track ownership so we only release locks we own.
 */
const WORKER_ID = crypto.randomUUID();

type FinancialEventRow = {
  id: string;
  tenant_id: string;
  rental_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  event_type: string;
  amount_cents: number;
  tax_cents: number;
  currency: string;
  occurred_at: string;
  description: string | null;
  metadata: Record<string, unknown>;
};

type SyncStateRow = {
  id: string;
  financial_event_id: string;
  tenant_id: string;
  provider: ProviderName;
  state: string;
  attempts: number;
  external_invoice_id: string | null;
};

interface Summary {
  picked: number;
  synced: number;
  failed: number;
  skipped_no_mapping: number;
  skipped_event_type: number;
  rate_limited_deferred: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const summary: Summary = {
      picked: 0,
      synced: 0,
      failed: 0,
      skipped_no_mapping: 0,
      skipped_event_type: 0,
      rate_limited_deferred: 0,
      errors: [],
    };

    // Claim a batch. The RPC locks with FOR UPDATE SKIP LOCKED, reclaims rows
    // whose in-flight lease expired, and never hands back dead-lettered rows.
    //
    // There is deliberately NO fallback path here. The original code fell back
    // to a PostgREST SELECT-then-bulk-UPDATE whenever this RPC errored — and
    // because the RPC was never actually created, that fallback ran on every
    // tick for three months. It cannot lock, so it claimed 100 rows at once and
    // stranded every row it did not reach in state='syncing', where nothing
    // would ever look at them again. A loud failure here is strictly better
    // than a silent path that corrupts the queue.
    const { data: batchRaw, error: batchErr } = await supabase.rpc("process_accounting_sync_claim_batch", {
      p_batch_size: BATCH_SIZE,
      p_claim_timeout_minutes: CLAIM_TIMEOUT_MINUTES,
    });
    if (batchErr) {
      console.error("process-accounting-sync: claim RPC failed — NOT falling back:", batchErr);
      return errorResponse(
        `Claim RPC unavailable: ${batchErr.message}. Apply migration 20260813120000_fix_accounting_sync_claim_and_deadletter.sql.`,
        500,
      );
    }

    const batch = (batchRaw ?? []) as Array<SyncStateRow & FinancialEventRow & {
      sync_id: string;
    }>;
    summary.picked = batch.length;

    // Per-provider API-call budget for THIS tick. Counted in calls, not rows —
    // one row costs up to CALLS_PER_ROW calls, and undercounting is what pushed
    // us past Xero's 60/min ceiling and into the 429s.
    const remaining: Record<ProviderName, number> = {
      xero: RATE_LIMIT_XERO * TICK_MINUTES,
    };

    for (const row of batch) {
      const p = row.provider as ProviderName;
      // Reserve the worst case before starting the row. If the row cannot be
      // funded in full we stop rather than begin work we may not finish — a
      // half-processed row is how invoices end up duplicated.
      if (remaining[p] < CALLS_PER_ROW) {
        // Release the claim so the next tick picks it up. This is not a
        // failure, so attempts is untouched and claimed_at is cleared.
        await supabase
          .from("financial_event_sync_state")
          .update({ state: "pending", next_attempt_at: null, claimed_at: null })
          .eq("id", row.sync_id);
        summary.rate_limited_deferred++;
        continue;
      }
      remaining[p] -= CALLS_PER_ROW;
      await processOne(supabase, row, summary);
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("process-accounting-sync error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

/**
 * Process one (event, provider) pair. Catches every throw and classifies it.
 * Updates the sync_state row accordingly.
 */
async function processOne(
  supabase: SupabaseClient,
  row: SyncStateRow & FinancialEventRow & { sync_id: string },
  summary: Summary,
): Promise<void> {
  // Acquire a per-rental mutex BEFORE we read the open invoice / append a line.
  // Without this, two cron-tick workers can both GET the same Xero invoice and
  // both PUT it back with their respective new lines — the second PUT silently
  // overwrites the first PUT's line (Xero's PUT replaces all lines).
  //
  // Lock is keyed on (tenant_id, rental_id, provider) and auto-expires after
  // 5 minutes so a crashed worker can't wedge a rental. Events with NO rental_id
  // (e.g. tenant-level discounts later) bypass locking.
  let lockHeld = false;
  if (row.rental_id) {
    const { data: acquired } = await supabase.rpc("try_acquire_rental_sync_lock", {
      p_tenant_id: row.tenant_id,
      p_rental_id: row.rental_id,
      p_provider: row.provider,
      p_worker_id: WORKER_ID,
      p_ttl_seconds: 300,
    });
    if (!acquired) {
      // Another worker is currently mutating this rental's invoice. Push the
      // row back to 'pending' so the next tick (after the lock holder finishes)
      // picks it up. NOT a failure → don't bump attempts.
      await supabase
        .from("financial_event_sync_state")
        .update({ state: "pending", next_attempt_at: null })
        .eq("id", row.sync_id);
      summary.rate_limited_deferred++;
      return;
    }
    lockHeld = true;
  }

  try {
    const provider = await getProvider(supabase, row.tenant_id, row.provider as ProviderName);

    // Look up the per-event-type mapping (account code + tax code).
    const mapping = await loadMapping(supabase, row.tenant_id, row.provider as ProviderName, row.event_type);
    if (!mapping) {
      // No mapping = validation error — surface to operator (no retry).
      await markFailed(supabase, row.sync_id, row.attempts,
        new ProviderError(`No account mapping for event_type=${row.event_type}. Open Configure mappings to set one.`, "validation", undefined, "NO_MAPPING"));
      summary.skipped_no_mapping++;
      return;
    }

    // Resolve customer + vehicle/rental metadata (denormalised so we don't
    // need 50 joins inside each handler).
    const ctx = await loadEventContext(supabase, row);

    // Find-or-create the provider contact for this customer.
    const contactExternalId = await ensureContact(supabase, provider, row, ctx);

    // Branch by event type.
    let externalRef: { externalId: string } | null = null;
    let updatedFields: Record<string, unknown> = {};

    switch (row.event_type) {
      case "rental_charge":
      case "damage_charge":
      case "mileage_charge":
      case "late_fee":
      case "insurance_charge":
      case "charging_cost":
      case "discount":
        // Append to OPEN rental invoice (or create one if first event for the rental).
        externalRef = await ensureInvoiceWithLine(supabase, provider, row, ctx, contactExternalId, mapping);
        updatedFields = { external_invoice_id: externalRef?.externalId };
        break;

      case "extension_charge":
        // ALWAYS new invoice (spec §8.3). The rental's extension number is in the metadata.
        externalRef = await createExtensionInvoice(provider, row, ctx, contactExternalId, mapping);
        updatedFields = { external_invoice_id: externalRef?.externalId };
        break;

      case "deposit_capture":
        externalRef = await ensureInvoiceWithLine(supabase, provider, row, ctx, contactExternalId, mapping);
        updatedFields = { external_invoice_id: externalRef?.externalId };
        break;

      case "payment_receipt": {
        // Find the open invoice for this rental, else fall back to its most
        // recent invoice.
        //
        // The fallback is load-bearing. findOpenInvoiceForRental deliberately
        // returns null once the rental is finalised (closed/cancelled/completed)
        // so no new lines get appended — but a payment arriving after the rental
        // closes is the normal case, not an edge case: final settlement, a late
        // installment, a deposit shortfall. Without the fallback every one of
        // those failed with "No open invoice", retried on the transient
        // schedule, and dead-lettered — leaving Xero showing an unpaid invoice
        // for a rental the customer had in fact paid in full.
        //
        // `refund` below already had this fallback; payment_receipt did not.
        const invoiceId =
          (await findOpenInvoiceForRental(supabase, row.tenant_id, row.provider as ProviderName, row.rental_id))
          ?? (await findLatestInvoiceForRental(supabase, row.tenant_id, row.provider as ProviderName, row.rental_id));
        if (!invoiceId) {
          await markFailed(supabase, row.sync_id, row.attempts,
            new ProviderError("No open invoice for this rental yet — payment will retry once an invoice exists", "transient", undefined, "WAITING_FOR_INVOICE"));
          return;
        }
        // Need the payment_account sentinel mapping for the bank/clearing account.
        const paymentAcct = await loadPaymentAccountMapping(supabase, row.tenant_id, row.provider as ProviderName);
        if (!paymentAcct) {
          await markFailed(supabase, row.sync_id, row.attempts,
            new ProviderError("No payment account set — Configure mappings → Payment account", "validation", undefined, "NO_PAYMENT_ACCOUNT"));
          summary.skipped_no_mapping++;
          return;
        }
        const paid = await provider.recordPayment({
          invoiceExternalId: invoiceId,
          amountCents: row.amount_cents,
          currency: row.currency,
          paidAt: row.occurred_at.slice(0, 10),
          paymentAccountCode: paymentAcct.external_account_code,
          reference: row.description ?? undefined,
        });
        externalRef = paid;
        updatedFields = { external_invoice_id: invoiceId, external_payment_id: paid.externalId };
        break;
      }

      case "refund": {
        // Need the source invoice — typically the rental's open invoice.
        const invoiceId = await findOpenInvoiceForRental(supabase, row.tenant_id, row.provider as ProviderName, row.rental_id)
          ?? await findLatestInvoiceForRental(supabase, row.tenant_id, row.provider as ProviderName, row.rental_id);
        if (!invoiceId) {
          await markFailed(supabase, row.sync_id, row.attempts,
            new ProviderError("No invoice to credit for this refund — original sale not yet synced", "transient", undefined, "WAITING_FOR_INVOICE"));
          return;
        }
        const note = await provider.createCreditNote({
          invoiceExternalId: invoiceId,
          amountCents: Math.abs(row.amount_cents),
          currency: row.currency,
          issueDate: row.occurred_at.slice(0, 10),
          reason: row.description ?? "Refund",
          lines: [{
            description: row.description ?? "Refund",
            quantity: 1,
            unitAmountCents: Math.abs(row.amount_cents),
            accountCode: mapping.external_account_code,
            taxCode: mapping.external_tax_code ?? undefined,
            reference: row.description ?? undefined,
          }],
        });
        externalRef = note;
        updatedFields = { external_invoice_id: invoiceId, external_credit_note_id: note.externalId };
        break;
      }

      case "security_hold_release":
      case "maintenance_expense":
      case "partner_payout":
        // No-op for sync in MVP — but mark synced so we don't keep retrying.
        await markSynced(supabase, row.sync_id, {});
        summary.skipped_event_type++;
        return;

      default:
        await markFailed(supabase, row.sync_id, row.attempts,
          new ProviderError(`Unknown event_type: ${row.event_type}`, "validation"));
        summary.failed++;
        return;
    }

    // Persist external refs + flip to 'synced'.
    await markSynced(supabase, row.sync_id, updatedFields);
    summary.synced++;
  } catch (err) {
    if (err instanceof ProviderError && err.classification === "duplicate") {
      // Silent success — idempotency hit. Mark synced.
      await markSynced(supabase, row.sync_id, { last_error: null, last_error_code: "DUPLICATE_IDEMPOTENT" });
      summary.synced++;
      return;
    }
    const provErr = err instanceof ProviderError ? err : new ProviderError(String(err), "unknown");
    await markFailed(supabase, row.sync_id, row.attempts, provErr);
    if (provErr.classification === "auth") {
      // Flip the connection to 'expired' + insert a reminder so the operator reconnects.
      await flagConnectionExpired(supabase, row.tenant_id, row.provider as ProviderName, provErr.message);
    }
    summary.failed++;
    summary.errors.push(`${row.provider}/${row.sync_id}: ${provErr.message.slice(0, 200)}`);
  } finally {
    // Always release the per-rental lock if we acquired it. Best-effort —
    // worst case the lock just times out after 5 minutes.
    if (lockHeld && row.rental_id) {
      try {
        await supabase.rpc("release_rental_sync_lock", {
          p_tenant_id: row.tenant_id,
          p_rental_id: row.rental_id,
          p_provider: row.provider,
          p_worker_id: WORKER_ID,
        });
      } catch (releaseErr) {
        console.error("release_rental_sync_lock failed:", releaseErr);
      }
    }
  }
}

/**
 * Find-or-create the contact for this event's customer. Cached via
 * accounting_contact_links so we never POST /Contacts twice for the same
 * customer+provider.
 */
async function ensureContact(
  supabase: SupabaseClient,
  provider: AccountingProvider,
  row: FinancialEventRow & { sync_id: string },
  ctx: EventContext,
): Promise<string> {
  if (!row.customer_id) {
    throw new ProviderError("Event has no customer_id — cannot create invoice", "validation", undefined, "NO_CUSTOMER");
  }
  const { data: existing } = await supabase
    .from("accounting_contact_links")
    .select("external_contact_id")
    .eq("tenant_id", row.tenant_id)
    .eq("customer_id", row.customer_id)
    .eq("provider", provider.name)
    .maybeSingle();
  if (existing?.external_contact_id) return existing.external_contact_id as string;

  const created = await provider.upsertContact({
    name: ctx.customerName ?? "Customer",
    email: ctx.customerEmail ?? undefined,
    phone: ctx.customerPhone ?? undefined,
    externalIdHint: row.customer_id.slice(0, 30),     // ContactNumber idempotency anchor
  });

  // Upsert, not insert. Two rows for the same customer can be claimed by
  // different ticks and both reach here before either has written the link; a
  // bare insert makes the loser throw a unique violation, which gets classified
  // 'unknown' and burns a retry on work that actually succeeded.
  await supabase
    .from("accounting_contact_links")
    .upsert(
      {
        tenant_id: row.tenant_id,
        customer_id: row.customer_id,
        provider: provider.name,
        external_contact_id: created.externalId,
        external_contact_name: ctx.customerName,
      },
      // Column order matches the accounting_contact_links_uniq index exactly.
      { onConflict: "tenant_id,provider,customer_id", ignoreDuplicates: true },
    );
  return created.externalId;
}

/**
 * The rental-to-invoice grouping rule (spec §8.3):
 *   - ONE invoice per rental UNTIL the rental status = 'closed'
 *   - Extension creates a NEW invoice (handled elsewhere)
 *   - Manual void → new draft (handled elsewhere)
 *
 * Implementation: find an existing sync_state row for the same (tenant, rental,
 * provider) with a non-null external_invoice_id and parent rental status NOT
 * 'closed'. Append. Otherwise create.
 */
async function ensureInvoiceWithLine(
  supabase: SupabaseClient,
  provider: AccountingProvider,
  row: FinancialEventRow & { sync_id: string },
  ctx: EventContext,
  contactExternalId: string,
  mapping: AccountMappingRow,
): Promise<{ externalId: string }> {
  const line: InvoiceLine = {
    description: row.description ?? `${row.event_type} · ${ctx.rentalRef ?? row.rental_id ?? ""}`.trim(),
    quantity: 1,
    unitAmountCents: row.amount_cents,
    accountCode: mapping.external_account_code,
    taxCode: mapping.external_tax_code ?? undefined,
    taxRate: mapping.external_tax_rate ?? undefined,
    reference: ctx.vehicleReg ?? undefined,
  };

  const openInvoice = row.rental_id
    ? await findOpenInvoiceForRental(supabase, row.tenant_id, provider.name, row.rental_id)
    : null;

  if (openInvoice) {
    return provider.appendInvoiceLine({ invoiceExternalId: openInvoice, line });
  }

  return provider.createInvoice({
    contactExternalId,
    invoiceNumber: ctx.rentalRef ? `INV-${ctx.rentalRef}` : `INV-${row.id.slice(0, 8)}`,
    issueDate: row.occurred_at.slice(0, 10),
    currency: row.currency,
    reference: ctx.vehicleReg ? `${ctx.rentalRef ?? row.rental_id ?? ""} · ${ctx.vehicleReg}` : ctx.rentalRef ?? undefined,
    lines: [line],
    sourceRentalId: row.rental_id ?? undefined,
  });
}

async function createExtensionInvoice(
  provider: AccountingProvider,
  row: FinancialEventRow & { sync_id: string },
  ctx: EventContext,
  contactExternalId: string,
  mapping: AccountMappingRow,
): Promise<{ externalId: string }> {
  const extNum = (row.metadata?.extension_number as number | undefined) ?? 1;
  return provider.createInvoice({
    contactExternalId,
    invoiceNumber: ctx.rentalRef ? `INV-${ctx.rentalRef}-EXT-${extNum}` : `INV-EXT-${row.id.slice(0, 8)}`,
    issueDate: row.occurred_at.slice(0, 10),
    currency: row.currency,
    reference: ctx.rentalRef ? `${ctx.rentalRef} · EXT-${extNum}${ctx.vehicleReg ? ` · ${ctx.vehicleReg}` : ""}` : undefined,
    lines: [{
      description: row.description ?? `Rental extension #${extNum}`,
      quantity: 1,
      unitAmountCents: row.amount_cents,
      accountCode: mapping.external_account_code,
      taxCode: mapping.external_tax_code ?? undefined,
      reference: ctx.vehicleReg ?? undefined,
    }],
    sourceRentalId: row.rental_id ?? undefined,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────────────────────────────

interface EventContext {
  rentalRef: string | null;
  rentalStatus: string | null;
  vehicleReg: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
}

async function loadEventContext(supabase: SupabaseClient, row: FinancialEventRow): Promise<EventContext> {
  const promises: Array<Promise<unknown>> = [];
  let rentalRef: string | null = null;
  let rentalStatus: string | null = null;
  let vehicleReg: string | null = null;
  let customerName: string | null = null;
  let customerEmail: string | null = null;
  let customerPhone: string | null = null;

  if (row.rental_id) {
    promises.push(
      supabase.from("rentals").select("rental_number, status").eq("id", row.rental_id).maybeSingle().then((r) => {
        const d = r.data as { rental_number?: string; status?: string } | null;
        rentalRef = d?.rental_number ?? row.rental_id!.slice(0, 8);
        rentalStatus = d?.status ?? null;
      }),
    );
  }
  if (row.vehicle_id) {
    promises.push(
      supabase.from("vehicles").select("reg").eq("id", row.vehicle_id).maybeSingle().then((r) => {
        vehicleReg = (r.data as { reg?: string } | null)?.reg ?? null;
      }),
    );
  }
  if (row.customer_id) {
    promises.push(
      supabase.from("customers").select("name, email, phone").eq("id", row.customer_id).maybeSingle().then((r) => {
        const d = r.data as { name?: string; email?: string; phone?: string } | null;
        customerName = d?.name ?? null;
        customerEmail = d?.email ?? null;
        customerPhone = d?.phone ?? null;
      }),
    );
  }
  await Promise.all(promises);
  return { rentalRef, rentalStatus, vehicleReg, customerName, customerEmail, customerPhone };
}

interface AccountMappingRow {
  external_account_code: string;
  external_account_name: string | null;
  external_tax_code: string | null;
  external_tax_rate: number | null;
}

async function loadMapping(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
  eventType: string,
): Promise<AccountMappingRow | null> {
  const { data } = await supabase
    .from("accounting_account_mappings")
    .select("external_account_code, external_account_name, external_tax_code, external_tax_rate")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("event_type", eventType)
    .maybeSingle();
  return (data as AccountMappingRow | null) ?? null;
}

async function loadPaymentAccountMapping(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
): Promise<AccountMappingRow | null> {
  const { data } = await supabase
    .from("accounting_account_mappings")
    .select("external_account_code, external_account_name, external_tax_code, external_tax_rate")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("is_payment_account_sentinel", true)
    .maybeSingle();
  return (data as AccountMappingRow | null) ?? null;
}

async function findOpenInvoiceForRental(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
  rentalId: string | null,
): Promise<string | null> {
  if (!rentalId) return null;
  // Find the latest sync_state row for this rental + provider that already
  // has an external_invoice_id AND whose rental isn't closed/cancelled.
  // Sprint 6 patch — use the canonical isFinalisedStatus helper so closed,
  // cancelled, completed, returned, voided etc. ALL prevent appending lines.
  // Previously only 'closed' and 'completed' were treated as closed, so
  // 'Cancelled' rentals would still get new invoice lines appended.
  const { data: rental } = await supabase.from("rentals").select("status").eq("id", rentalId).maybeSingle();
  const status = (rental as { status?: string } | null)?.status ?? null;
  if (isFinalisedStatus(status)) return null;

  const { data } = await supabase
    .from("financial_event_sync_state")
    .select("external_invoice_id, financial_events!inner(rental_id, event_type)")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("state", "synced")
    .not("external_invoice_id", "is", null)
    .eq("financial_events.rental_id", rentalId)
    .neq("financial_events.event_type", "extension_charge")  // extension invoices don't get more lines
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { external_invoice_id?: string } | null) ?? {}).external_invoice_id ?? null;
}

async function findLatestInvoiceForRental(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
  rentalId: string | null,
): Promise<string | null> {
  if (!rentalId) return null;
  const { data } = await supabase
    .from("financial_event_sync_state")
    .select("external_invoice_id, financial_events!inner(rental_id)")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .not("external_invoice_id", "is", null)
    .eq("financial_events.rental_id", rentalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { external_invoice_id?: string } | null) ?? {}).external_invoice_id ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// State transitions
// ──────────────────────────────────────────────────────────────────────────

async function markSynced(
  supabase: SupabaseClient,
  syncStateId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("financial_event_sync_state")
    .update({
      state: "synced",
      synced_at: new Date().toISOString(),
      last_error: null,
      last_error_code: null,
      next_attempt_at: null,
      claimed_at: null,          // release the in-flight lease
      ...fields,
    })
    .eq("id", syncStateId);
}

async function markFailed(
  supabase: SupabaseClient,
  syncStateId: string,
  currentAttempts: number,
  err: ProviderError,
): Promise<void> {
  // Use the shared backoff helper (Sprint 6 refactor — unit-tested in
  // apps/portal/src/__tests__/lib/accounting-backoff.test.ts).
  const nextAttempt = nextAttemptAfter(currentAttempts, err.classification);

  // A null next_attempt_at means "do not auto-retry" — dead-letter, or an
  // auth/validation error needing operator action. That MUST be recorded
  // explicitly: the claim predicate treats a null next_attempt_at on its own as
  // "claim immediately", so relying on null alone made dead-letter a no-op and
  // let rows accumulate 56,000+ attempts against a threshold of 5.
  const deadLettered = nextAttempt === null;

  await supabase
    .from("financial_event_sync_state")
    .update({
      state: "failed",
      attempts: currentAttempts + 1,
      last_error: err.message.slice(0, 1000),
      last_error_code: err.errorCode ?? err.classification,
      next_attempt_at: nextAttempt?.toISOString() ?? null,
      dead_lettered_at: deadLettered ? new Date().toISOString() : null,
      claimed_at: null,          // release the in-flight lease
    })
    .eq("id", syncStateId);
}

async function flagConnectionExpired(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
  reason: string,
): Promise<void> {
  await supabase
    .from("accounting_connections")
    .update({ status: "expired", last_error: reason.slice(0, 500) })
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("status", "active");
  const flagColumn = "integration_xero";
  await supabase.from("tenants").update({ [flagColumn]: false }).eq("id", tenantId);
}

// ──────────────────────────────────────────────────────────────────────────
// NOTE: the old `claimBatchFallback` lived here and has been deleted.
//
// It existed because FOR UPDATE SKIP LOCKED cannot be expressed over PostgREST,
// so it approximated a claim with SELECT-then-bulk-UPDATE. That approximation
// is unsound: it flips the whole batch to 'syncing' up front, and any row the
// worker does not reach before it dies is stranded in a state the claim query
// never re-selects. Because the RPC it was meant to back up was never created,
// this path ran on every tick from 2026-05-26 and stranded 36 production rows.
//
// The claim is now exclusively `process_accounting_sync_claim_batch`
// (migration 20260813120000), which locks properly and leases rows so a dead
// worker's batch is reclaimed rather than lost. If that RPC is missing the
// function now fails loudly instead of silently degrading.
// ──────────────────────────────────────────────────────────────────────────
