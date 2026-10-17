/**
 * send-verification-link-v2 — email a customer their ID-check link.
 *
 * Called by the v2 add-customer dialog's ID check screen
 * (apps/portal/src/components/customers-v2/verify-id-screen-v2.tsx), next to
 * "Copy link" (Ghulam, Oct 7 2026: "a proper mechanism to share the link via
 * email").
 *
 * A NEW function (V2_PLAN §7): no existing function changes behaviour.
 *
 * The browser sends only the session id and, optionally, an address to send
 * to. Everything else is resolved here, scoped to the caller's tenant:
 *   - the verification row by `session_id` AND `tenant_id` (§5) — still open,
 *     not completed, not expired;
 *   - its customer, by id AND tenant, for the name and the default address;
 *   - the link itself, rebuilt from the row's `qr_session_token` exactly as
 *     create-ai-verification-session builds it — so this cannot be used to
 *     mail an arbitrary URL to anyone;
 *   - the tenant's brand, for the same branded layout notifications use.
 *
 * Body:     { sessionId: string, email?: string, tenantSlug?: string }
 * Returns:  { success: true, to } | { error }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { resolveTenantId } from '../_shared/resolve-tenant.ts';
import {
  emailBodyToPlainText,
  escapeEmailHtml,
  renderNotificationEmailHtml,
} from '../_shared/notification-email-layout-v2.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The same link create-ai-verification-session puts in the QR code. */
function buildVerifyUrl(tenantSlug: string, token: string): string {
  const baseUrl = Deno.env.get('BOOKING_APP_URL') || `https://${tenantSlug}.drive-247.com`;
  return `${baseUrl}/verify/${token}`;
}

function untilLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
      timeZoneName: 'short',
    });
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return errorResponse('Unauthorized', 401);

    const { data: appUser } = await supabase
      .from('app_users')
      .select('id, tenant_id, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();
    if (!appUser) return errorResponse('User not found', 403);

    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const override = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!sessionId) return errorResponse('sessionId is required');
    if (override && !EMAIL_RE.test(override)) return errorResponse("That email address doesn't look right.");

    const tenantRes = await resolveTenantId(supabase, req, appUser, body.tenantSlug ?? null);
    if (!tenantRes.tenantId) return errorResponse(tenantRes.errorMessage ?? 'No tenant context', tenantRes.errorStatus);
    const tenantId = tenantRes.tenantId;

    // The session — this tenant's, still open.
    const { data: session } = await supabase
      .from('identity_verifications')
      .select('customer_id, status, qr_session_token, qr_session_expires_at')
      .eq('session_id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!session?.qr_session_token) return errorResponse('Verification session not found', 404);
    if (session.status === 'completed') return errorResponse('This check is already finished.', 409);
    if (session.qr_session_expires_at && new Date(session.qr_session_expires_at).getTime() < Date.now()) {
      return errorResponse('This code has expired. Make a new one first.', 410);
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('name, email')
      .eq('id', session.customer_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!customer) return errorResponse('Customer not found', 404);

    const to = override || (customer.email ?? '').trim().toLowerCase();
    if (!to) return errorResponse('Add an email address to send the link to.');

    const { data: tenant } = await supabase
      .from('tenants')
      .select('slug, company_name, email_from, logo_url, primary_color, accent_color, contact_email, contact_phone, phone')
      .eq('id', tenantId)
      .single();
    if (!tenant?.slug) return errorResponse('Tenant not found', 404);

    const url = buildVerifyUrl(tenant.slug, session.qr_session_token);
    const company = (tenant.company_name || 'Drive 247').trim();
    const first = (customer.name || '').trim().split(/\s+/)[0] || 'there';
    const until = session.qr_session_expires_at ? untilLabel(session.qr_session_expires_at) : '';

    const bodyHtml = `
<p>Hi ${escapeEmailHtml(first)},</p>
<p>${escapeEmailHtml(company)} needs to verify your driving licence before your rental. It takes about two minutes on your phone: a photo of your licence, front and back, and a quick selfie.</p>
<p><a href="${escapeEmailHtml(url)}">Verify my ID</a></p>
${until ? `<p>This link works until ${escapeEmailHtml(until)}.</p>` : ''}
<p>If you weren't expecting this, you can ignore this email.</p>`;

    const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const html = renderNotificationEmailHtml({
      bodyHtml,
      brand: {
        companyName: company,
        logoUrl: text(tenant.logo_url),
        primaryColor: text(tenant.primary_color),
        accentColor: text(tenant.accent_color),
        contactEmail: text(tenant.contact_email),
        contactPhone: text(tenant.contact_phone) ?? text(tenant.phone),
      },
      preheader: 'Two minutes on your phone: your licence and a selfie.',
    });

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return errorResponse("Email isn't set up on the server yet, so nothing was sent.", 500);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${company} <${tenant.email_from || 'noreply@drive-247.com'}>`,
        to: [to],
        subject: `Verify your ID for ${company}`,
        html,
        text: emailBodyToPlainText(bodyHtml),
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
      }),
    });
    if (!res.ok) {
      console.error('[SEND-VERIFICATION-LINK-V2] Resend failed:', res.status, await res.text().catch(() => ''));
      return errorResponse("I couldn't send the email. Try again, or copy the link instead.", 502);
    }

    return jsonResponse({ success: true, to });
  } catch (err) {
    console.error('[SEND-VERIFICATION-LINK-V2]', err);
    return errorResponse('Something went wrong sending the link.', 500);
  }
});
