// get-tenant-onboarding-link
//
// Generates a Stripe hosted onboarding (AccountLink) URL for a tenant's
// connected account, resolved ACCOUNT-AWARE via getTenantChargeContext — so a
// tenant on the UAE platform ('own') gets a link built with the UAE key for
// their own_stripe_account_id, and a managed/UK tenant gets the UK one.
//
// Why this exists: the legacy get-connect-onboarding-link is hardcoded to the
// UK live key + tenants.stripe_account_id, so it can NEVER complete onboarding
// for a UAE-migrated tenant's own account (e.g. GMT acct_1U5TF...). That
// mismatch is why those accounts sit "Restricted / details not submitted"
// forever — the operator has no reachable path to finish them.
//
// Auth: service-role key OR a super-admin user JWT (same gate as
// sync-connect-status). Returns { url } — send it to the operator; it drops
// them straight onto THEIR account's hosted onboarding form (business profile
// + Stripe Services Agreement acceptance).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getTenantChargeContext } from '../_shared/stripe-client.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing authorization header', 401)
    const token = authHeader.replace('Bearer ', '').trim()

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

    let authorized = token === serviceKey
    if (!authorized) {
      const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token)
      if (userError || !user) return errorResponse('Unauthorized', 401)
      const { data: appUsers } = await supabase
        .from('app_users')
        .select('is_super_admin')
        .eq('auth_user_id', user.id)
      authorized = Array.isArray(appUsers) && appUsers.some((u: any) => u.is_super_admin === true)
    }
    if (!authorized) return errorResponse('Only super admins can generate onboarding links', 403)

    const { tenantId, returnUrl, refreshUrl } = await req.json().catch(() => ({}))
    if (!tenantId) return errorResponse('tenantId is required', 400)

    // Account-aware: UAE client + own_stripe_account_id for 'own' tenants.
    const { stripe, connectAccountId, platformAccount, mode } = await getTenantChargeContext(supabase, tenantId)
    if (!connectAccountId) {
      return errorResponse('Tenant has no connected account to onboard (managed tenants charge on the platform account).', 400)
    }

    const origin = req.headers.get('origin') || 'https://portal.drive-247.com'
    const accountLink = await stripe.accountLinks.create({
      account: connectAccountId,
      type: 'account_onboarding',
      return_url: returnUrl || `${origin}/settings?tab=stripe-connect&status=success`,
      refresh_url: refreshUrl || `${origin}/settings?tab=stripe-connect&status=refresh`,
    })

    return jsonResponse({
      url: accountLink.url,
      account: connectAccountId,
      platformAccount,
      mode,
      expiresAt: accountLink.expires_at,
    })
  } catch (err) {
    console.error('[get-tenant-onboarding-link] error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Failed to create onboarding link', 500)
  }
})
