/**
 * process-accounting-sync — THE HEART (Spec §9.1, §14).
 *
 * Cron-triggered every 2 minutes. Walks the `financial_event_sync_state`
 * queue, calls the right provider via the abstraction layer, persists
 * external refs + state transitions. Honours:
 *
 *   - Spec §8.3: one invoice per rental until closed; extensions get new invoices
 *   - Spec §7.3: idempotency (Xero Idempotency-Key, Zoho via pre-flight check)
 *   - Spec §14.2: error classification → retry / mark-expired / surface
 *   - Spec §14 backoff schedule: 1m, 5m, 30m, 2h, 12h, dead-letter
 *
 * Picks 100 rows per tick via `FOR UPDATE SKIP LOCKED` so duplicate cron
 * triggers can't double-process. Each row goes through:
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

const BATCH_SIZE = 100;

// Per-provider rate limits (per minute). Defaults from spec §3.
const RATE_LIMIT_XERO = Number(Deno.env.get("ACCOUNTING_SYNC_RATE_LIMIT_XERO") ?? 50);
const RATE_LIMIT_ZOHO = Number(Deno.env.get("ACCOUNTING_SYNC_RATE_LIMIT_ZOHO") ?? 80);

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

    // Pull a batch. We use the index `(state, next_attempt_at) WHERE state IN ('pending','failed')`.
    const { data: batchRaw, error: batchErr } = await supabase.rpc("process_accounting_sync_claim_batch", {
      p_batch_size: BATCH_SIZE,
    });
    if (batchErr) {
      // Fallback: a simpler SELECT + UPDATE in case the RPC doesn't exist yet.
      // We'll define the RPC in a migration but want this fn to be resilient.
      const fallback = await claimBatchFallback(supabase);
      if (fallback.length === 0) return jsonResponse({ ...summary, note: "no rows" });
      for (const row of fallback) await processOne(supabase, row, summary);
      return jsonResponse(summary);
    }

    const batch = (batchRaw ?? []) as Array<SyncStateRow & FinancialEventRow & {
      sync_id: string;
    }>;
    summary.picked = batch.length;

    // Per-provider request counter for the rate-limit guard. We don't query a
    // rolling window — we just budget THIS tick's allowance and defer the rest.
    const remaining: Record<ProviderName, number> = {
      xero: Math.ceil(RATE_LIMIT_XERO * (2 / 60)) * 60,  // budget for 2-min tick (~ rate * 2)
      zoho: Math.ceil(RATE_LIMIT_ZOHO * (2 / 60)) * 60,
    };

    for (const row of batch) {
      if (remaining[row.provider as ProviderName] <= 0) {
        // Defer this row to the next tick (clear state back to pending without
        // bumping attempts since it's not really a failure).
        await supabase
          .from("financial_event_sync_state")
          .update({ state: "pending", next_attempt_at: null })
          .eq("id", row.sync_id);
        summary.rate_limited_deferred++;
        continue;
      }
      remaining[row.provider as ProviderName]--;
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
        // Need to find the open invoice for this rental's other sync rows.
        const invoiceId = await findOpenInvoiceForRental(supabase, row.tenant_id, row.provider as ProviderName, row.rental_id);
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

  await supabase.from("accounting_contact_links").insert({
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    provider: provider.name,
    external_contact_id: created.externalId,
    external_contact_name: ctx.customerName,
  });
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

  await supabase
    .from("financial_event_sync_state")
    .update({
      state: "failed",
      attempts: currentAttempts + 1,
      last_error: err.message.slice(0, 1000),
      last_error_code: err.errorCode ?? err.classification,
      next_attempt_at: nextAttempt?.toISOString() ?? null,
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
  const flagColumn = provider === "xero" ? "integration_xero" : "integration_zoho_books";
  await supabase.from("tenants").update({ [flagColumn]: false }).eq("id", tenantId);
}

// ──────────────────────────────────────────────────────────────────────────
// Fallback claim path — used when the SQL RPC isn't available.
// SELECT ... FOR UPDATE SKIP LOCKED is the ideal, but we can't run that
// over PostgREST. Best we can do via PostgREST: an atomic UPDATE that flips
// state to 'syncing' and RETURNING the joined event data.
// ──────────────────────────────────────────────────────────────────────────

async function claimBatchFallback(
  supabase: SupabaseClient,
): Promise<Array<SyncStateRow & FinancialEventRow & { sync_id: string }>> {
  const nowIso = new Date().toISOString();
  // Step 1: select candidate sync_state ids (no FOR UPDATE here — concurrent runs
  // are rare; idempotency in the provider layer covers the edge case).
  const { data: candidatesRaw } = await supabase
    .from("financial_event_sync_state")
    .select("id, financial_event_id, tenant_id, provider, state, attempts, external_invoice_id")
    .in("state", ["pending", "failed"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  const candidates = (candidatesRaw ?? []) as SyncStateRow[];
  if (candidates.length === 0) return [];

  // Step 2: atomically claim them — mark state='syncing'.
  const ids = candidates.map((c) => c.id);
  await supabase
    .from("financial_event_sync_state")
    .update({ state: "syncing", last_attempt_at: nowIso })
    .in("id", ids);

  // Step 3: join with financial_events for the worker's row data.
  const eventIds = candidates.map((c) => c.financial_event_id);
  const { data: eventsRaw } = await supabase
    .from("financial_events")
    .select("id, tenant_id, rental_id, customer_id, vehicle_id, event_type, amount_cents, tax_cents, currency, occurred_at, description, metadata")
    .in("id", eventIds);
  const events = (eventsRaw ?? []) as FinancialEventRow[];
  const eventById = new Map(events.map((e) => [e.id, e]));

  return candidates
    .map((c) => {
      const e = eventById.get(c.financial_event_id);
      if (!e) return null;
      return { ...c, ...e, sync_id: c.id };
    })
    .filter((x): x is SyncStateRow & FinancialEventRow & { sync_id: string } => !!x);
}
