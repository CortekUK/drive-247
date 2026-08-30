/**
 * void-rental-accounting — Sprint 6 patch: manual-void flow.
 *
 * When an operator manually cancels a rental in the portal (status flips to
 * 'Cancelled' / 'Void'), any already-synced invoice for that rental in Xero /
 * Zoho needs to be voided so the operator's books don't carry phantom revenue.
 *
 * Called by the portal's rental cancel mutation right after the status flip.
 * Loops every active accounting connection for the tenant and voids the open
 * invoice if one was previously synced.
 *
 * This is intentionally separate from `process-accounting-sync` so the void
 * happens immediately on cancel (not on the next 2-min cron tick) — operators
 * expect their books to reflect the cancel without delay.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getProvider } from "../_shared/accounting/factory.ts";
import { ProviderError, ProviderName } from "../_shared/accounting/types.ts";
import { isCancelledStatus } from "../_shared/accounting/rental-status.ts";

interface Payload {
  rentalId: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.rentalId) return errorResponse("rentalId required", 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Unauthorised", 401);

    // Verify the caller can act on this rental — same RLS pattern as other
    // mutating fns. We just need *some* signed-in user; the SR client below
    // does the actual work.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Look up the rental, confirm it's actually cancelled (defense in depth —
    // we don't want a misfired call voiding an active rental's invoice).
    const { data: rental } = await supabase
      .from("rentals")
      .select("id, tenant_id, status")
      .eq("id", body.rentalId)
      .maybeSingle();
    if (!rental) return errorResponse("Rental not found", 404);
    if (!isCancelledStatus((rental as { status?: string }).status ?? null)) {
      return errorResponse(`Rental status is '${(rental as { status?: string }).status}' — not cancelled`, 400);
    }
    const tenantId = (rental as { tenant_id: string }).tenant_id;

    // Find every distinct external invoice that's been synced for this rental
    // across all providers. There can be more than one (e.g. extension → its
    // own invoice). All of them get voided.
    const { data: invoiceRowsRaw } = await supabase
      .from("financial_event_sync_state")
      .select("provider, external_invoice_id, financial_events!inner(rental_id)")
      .eq("financial_events.rental_id", body.rentalId)
      .eq("tenant_id", tenantId)
      .not("external_invoice_id", "is", null)
      .eq("state", "synced");
    const rows = (invoiceRowsRaw ?? []) as Array<{
      provider: ProviderName;
      external_invoice_id: string;
    }>;

    // Dedupe by (provider, invoice_id) since multiple events point at the
    // same invoice.
    const seen = new Set<string>();
    const targets: Array<{ provider: ProviderName; externalInvoiceId: string }> = [];
    for (const r of rows) {
      const key = `${r.provider}:${r.external_invoice_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ provider: r.provider, externalInvoiceId: r.external_invoice_id });
    }

    if (targets.length === 0) {
      return jsonResponse({ ok: true, message: "No synced invoices to void", voided: [] });
    }

    const voided: Array<{ provider: ProviderName; externalInvoiceId: string }> = [];
    const failed: Array<{ provider: ProviderName; externalInvoiceId: string; error: string }> = [];

    for (const t of targets) {
      try {
        const provider = await getProvider(supabase, tenantId, t.provider);
        await provider.voidInvoice(t.externalInvoiceId);
        voided.push(t);

        // Also flip every sync_state row pointing at this invoice to 'voided'
        // so the operator sees it in the sync log AND we never try to append
        // new lines to a voided invoice.
        await supabase
          .from("financial_event_sync_state")
          .update({
            external_status: "VOIDED",
            last_error: null,
            last_error_code: null,
          })
          .eq("tenant_id", tenantId)
          .eq("provider", t.provider)
          .eq("external_invoice_id", t.externalInvoiceId);
      } catch (err) {
        const msg = err instanceof ProviderError ? err.message : String(err);
        console.error(`void ${t.provider}/${t.externalInvoiceId} failed:`, msg);
        failed.push({ ...t, error: msg.slice(0, 500) });
      }
    }

    return jsonResponse({
      ok: failed.length === 0,
      voided,
      failed,
    }, failed.length === 0 ? 200 : 207);
  } catch (err) {
    console.error("void-rental-accounting error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
