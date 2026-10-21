// customer-start-verification — a customer starts (or abandons) their own ID
// check from the customer portal v2 (Settings → Verification).
//
// The operator starts a check for a customer with create-ai-verification-
// session, which takes the customer id from the body. This is the customer's
// own door to the same pipeline: the customer is the auth user behind the JWT,
// linked to the tenant through `customer_users`, never an id from the body.
//
//   start   { tenant_id, document_type: 'drivers_license' | 'id_card' }
//           → { ok, sessionId, qrUrl, expiresAt }
//           Inserts the same `identity_verifications` row the operator's
//           function does (provider 'ai', status 'init', a QR token good for
//           3 hours), with the document the customer chose. The QR opens the
//           capture page (/verify/<token>, the existing one); a computer can
//           instead upload the three photos to customer-documents under
//           ai-verification/<sessionId>/ and call process-ai-verification —
//           the same two steps the capture page runs.
//           Re-verifying does NOT demote a verified customer to "pending" the
//           way the operator's start does: their verdict stands until the new
//           check decides.
//   cancel  { tenant_id, session_id } → { ok }
//           Ends one of the caller's own unfinished checks: status 'expired',
//           QR token cleared, so the page falls back to the last decided one.
//
// Same rate limit as the operator's function: 10 starts an hour per customer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENTS = ['drivers_license', 'id_card'] as const;
const VERIFIED = ['verified', 'manually_verified', 'approved'];

const respond = (body: Record<string, unknown>, status = 200) => {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

const bearer = (value: string | null) => {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match ? match[1].trim() : null;
};

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return respond({ ok: false, error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return respond({ ok: false, error: 'Verification is not set up yet.' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { action?: unknown; tenant_id?: unknown; document_type?: unknown; session_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: 'The request could not be read.' }, 400);
  }
  const action = body?.action === 'cancel' ? 'cancel' : body?.action === 'start' ? 'start' : null;
  const tenantId = typeof body?.tenant_id === 'string' ? body.tenant_id : '';
  if (!action || !UUID_RE.test(tenantId)) return respond({ ok: false, error: 'The request could not be read.' }, 400);

  const token = bearer(req.headers.get('authorization'));
  if (!token) return respond({ ok: false, error: 'Sign in to continue.' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return respond({ ok: false, error: 'Your session has expired. Sign in again.' }, 401);

  try {
    const { data: link, error: linkError } = await admin
      .from('customer_users')
      .select('customer_id')
      .eq('auth_user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link?.customer_id) return respond({ ok: false, code: 'not_customer', error: 'Your account is not linked to this site.' }, 403);
    const customerId = link.customer_id as string;

    if (action === 'cancel') {
      const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
      if (!UUID_RE.test(sessionId)) return respond({ ok: false, error: 'The request could not be read.' }, 400);
      const { data: ended, error: endError } = await admin
        .from('identity_verifications')
        .update({ status: 'expired', review_status: 'expired', qr_session_token: null, updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .in('status', ['init', 'pending'])
        .select('id');
      if (endError) throw endError;
      if (!ended?.length) return respond({ ok: false, error: 'That check has already finished.' }, 409);

      // A customer who was never decided goes back to "not verified" rather
      // than staying "pending" on a check that no longer exists.
      const { data: customer } = await admin.from('customers').select('identity_verification_status').eq('id', customerId).maybeSingle();
      if (customer?.identity_verification_status === 'pending') {
        const { data: decided } = await admin
          .from('identity_verifications')
          .select('review_result')
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .in('review_result', ['GREEN', 'RED', 'RETRY', 'YELLOW'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const restored = decided?.review_result === 'GREEN' ? 'verified' : decided?.review_result === 'RED' ? 'rejected' : 'unverified';
        await admin.from('customers').update({ identity_verification_status: restored }).eq('id', customerId).eq('tenant_id', tenantId);
      }
      return respond({ ok: true });
    }

    const documentType = DOCUMENTS.includes(body?.document_type as (typeof DOCUMENTS)[number]) ? (body.document_type as string) : null;
    if (!documentType) return respond({ ok: false, error: 'Choose a driving licence or an ID card.' }, 400);

    const { data: tenant } = await admin.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
    if (!tenant?.slug) return respond({ ok: false, error: 'The request could not be read.' }, 400);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('identity_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('verification_provider', 'ai')
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= 10) {
      return respond({ ok: false, code: 'rate_limited', error: 'Too many checks started in the last hour. Please try again later.' }, 429);
    }

    // Any check still open is superseded: one live QR code at a time.
    await admin
      .from('identity_verifications')
      .update({ status: 'expired', review_status: 'expired', qr_session_token: null })
      .eq('customer_id', customerId)
      .eq('tenant_id', tenantId)
      .in('status', ['init', 'pending']);

    const qrToken = `${crypto.randomUUID()}-${Date.now().toString(36)}`;
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const base = Deno.env.get('BOOKING_APP_URL') || `https://${tenant.slug}.drive-247.com`;
    const qrUrl = `${base}/verify/${qrToken}?doc=${documentType === 'drivers_license' ? 'licence' : 'id'}`;

    const { error: insertError } = await admin.from('identity_verifications').insert({
      customer_id: customerId,
      tenant_id: tenantId,
      provider: 'ai',
      verification_provider: 'ai',
      external_user_id: customerId,
      session_id: sessionId,
      status: 'init',
      review_status: 'init',
      verification_step: 'init',
      document_type: documentType,
      qr_session_token: qrToken,
      qr_session_expires_at: expiresAt.toISOString(),
    });
    if (insertError) throw insertError;

    const { data: customer } = await admin.from('customers').select('identity_verification_status').eq('id', customerId).maybeSingle();
    if (!VERIFIED.includes(String(customer?.identity_verification_status ?? ''))) {
      await admin.from('customers').update({ identity_verification_status: 'pending' }).eq('id', customerId).eq('tenant_id', tenantId);
    }

    console.log('customer-start-verification: started', { tenant_id: tenantId, session_id: sessionId, document_type: documentType });
    return respond({ ok: true, sessionId, qrUrl, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('customer-start-verification failed:', error instanceof Error ? error.message : error);
    return respond({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
