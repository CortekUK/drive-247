import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

/**
 * retry-credit-failed-agreements
 *
 * Recovers rental agreements that were parked as `document_status='credit_failed'`
 * because the tenant's live e-sign credit wallet was empty when the agreement
 * (original OR extension) was auto-generated.
 *
 * For each still-Active rental with credit_failed agreement(s), it collapses the
 * (possibly many) failed rows into a SINGLE fresh agreement that covers the
 * rental's CURRENT full period (start_date -> current end_date) and re-invokes
 * the existing generation path (the portal `/api/esign` route) — no BoldSign
 * PDF logic is duplicated here.
 *
 * Triggers:
 *   1. After a live credit top-up — `subscription-webhook` invokes this with { tenantId }.
 *   2. Scheduled hourly sweep (pg_cron) with no body → processes every tenant.
 *
 * Idempotent:
 *   - Skips a rental that already has a valid (sent/delivered/signed/completed)
 *     agreement covering the current period, and just cleans up its stale
 *     credit_failed rows.
 *   - In live mode, skips rentals whose wallet still can't cover one agreement,
 *     so it never manufactures a fresh credit_failed row.
 *
 * verify_jwt = false — called server-to-server (webhook + cron) with the service role.
 */

const PORTAL_BASE_DOMAIN = Deno.env.get('PORTAL_BASE_DOMAIN') || 'portal.drive-247.com';
const DEFAULT_ESIGN_COST = 7;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

async function collapseFailed(supabase: Supa, rentalId: string): Promise<number> {
  // credit_failed rows carry no BoldSign document and no signed doc, so deleting
  // them is safe and truly "collapses" the many failed attempts.
  const { data, error } = await supabase
    .from('rental_agreements')
    .delete()
    .eq('rental_id', rentalId)
    .eq('document_status', 'credit_failed')
    .select('id');
  if (error) {
    console.warn('collapseFailed error for rental', rentalId, error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processRental(supabase: Supa, rentalId: string): Promise<Record<string, unknown>> {
  const { data: rental } = await supabase
    .from('rentals')
    .select(
      'id, status, start_date, end_date, tenant_id, customer_id, customers:customer_id(name, email), tenants:tenant_id(slug, boldsign_mode)',
    )
    .eq('id', rentalId)
    .single();

  if (!rental) return { skipped: 'rental_not_found' };
  if (rental.status !== 'Active') return { skipped: 'not_active' };

  const tenantId = rental.tenant_id as string;
  const customer = rental.customers as { name?: string; email?: string } | null;
  const email = customer?.email;
  const name = customer?.name;
  if (!email || !name) return { skipped: 'missing_customer_contact' };

  const tenant = rental.tenants as { slug?: string; boldsign_mode?: string } | null;
  const boldsignMode = tenant?.boldsign_mode || 'test';
  const isLive = boldsignMode !== 'test';

  // Idempotency: is a valid agreement already covering the current full period?
  const endStr = String(rental.end_date).slice(0, 10);
  const { data: validRows } = await supabase
    .from('rental_agreements')
    .select('id, period_end_date, document_status')
    .eq('rental_id', rentalId)
    .in('document_status', ['sent', 'delivered', 'signed', 'completed']);
  const alreadyCovered = (validRows || []).some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any) => a.period_end_date && String(a.period_end_date).slice(0, 10) === endStr,
  );
  if (alreadyCovered) {
    const collapsed = await collapseFailed(supabase, rentalId);
    return { skipped: 'already_covered', collapsedFailed: collapsed };
  }

  // Live-mode pre-check: don't attempt if the wallet still can't cover one agreement
  // (would only create another credit_failed row).
  if (isLive) {
    const { data: costRow } = await supabase
      .from('credit_costs')
      .select('cost_credits')
      .eq('category', 'esign')
      .eq('is_active', true)
      .maybeSingle();
    const cost = Number(costRow?.cost_credits ?? DEFAULT_ESIGN_COST) || DEFAULT_ESIGN_COST;
    const { data: wallet } = await supabase
      .from('tenant_credit_wallets')
      .select('balance')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const balance = Number(wallet?.balance ?? 0);
    if (balance < cost) return { skipped: 'insufficient_credits', balance, required: cost };
  }

  const slug = tenant?.slug;
  if (!slug) return { skipped: 'no_tenant_slug' };

  // Re-invoke the existing generation path (portal /api/esign). agreementType
  // 'original' regenerates a single agreement over start_date -> current end_date,
  // revokes prior non-terminal originals, and emails the customer.
  const url = `https://${slug}.${PORTAL_BASE_DOMAIN}/api/esign`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rentalId,
        customerEmail: email,
        customerName: name,
        tenantId,
        agreementType: 'original',
      }),
    });
  } catch (e) {
    return { error: `esign_fetch_failed: ${String(e)}` };
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.ok) {
    return { error: data?.error || `esign_failed_${resp.status}`, detail: data?.detail };
  }

  const collapsed = await collapseFailed(supabase, rentalId);
  return {
    regenerated: true,
    documentId: data?.envelopeId ?? data?.documentId ?? null,
    collapsedFailed: collapsed,
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { tenantId, rentalId } = (body ?? {}) as { tenantId?: string; rentalId?: string };

    // Gather credit_failed agreements in scope.
    let failedQ = supabase
      .from('rental_agreements')
      .select('id, rental_id, tenant_id')
      .eq('document_status', 'credit_failed');
    if (tenantId) failedQ = failedQ.eq('tenant_id', tenantId);
    if (rentalId) failedQ = failedQ.eq('rental_id', rentalId);

    const { data: failed, error: failedErr } = await failedQ;
    if (failedErr) return errorResponse(failedErr.message, 500);
    if (!failed || failed.length === 0) {
      return jsonResponse({ ok: true, processed: 0, results: [] });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rentalIds = [...new Set(failed.map((f: any) => f.rental_id as string))];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    for (const rId of rentalIds) {
      try {
        const outcome = await processRental(supabase, rId as string);
        results.push({ rentalId: rId, ...outcome });
      } catch (e) {
        results.push({ rentalId: rId, error: String(e) });
      }
    }

    const regenerated = results.filter((r) => r.regenerated).length;
    console.log(
      `retry-credit-failed-agreements: ${rentalIds.length} rental(s) scanned, ${regenerated} regenerated`,
    );

    return jsonResponse({ ok: true, processed: results.length, regenerated, results });
  } catch (err) {
    console.error('retry-credit-failed-agreements error:', err);
    return errorResponse(`Internal error: ${String(err)}`, 500);
  }
});
