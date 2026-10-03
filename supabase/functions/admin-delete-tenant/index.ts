import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getSubscriptionStripeClientForAccount } from '../_shared/subscription-stripe.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteTenantRequest {
  tenant_id: string;
}

Deno.serve(async (req) => {
  console.log('admin-delete-tenant function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Client with user's JWT for verification
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user session and check if they're a super admin
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Failed to verify user session:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is a super admin
    const { data: currentUserData, error: roleError } = await supabase
      .from('app_users')
      .select('role, is_active, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (roleError || !currentUserData) {
      console.error('Failed to get user role:', roleError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // is_active is already selected here but was never checked, so a
    // deactivated super admin could still delete tenants.
    if (!currentUserData.is_super_admin || currentUserData.is_active === false) {
      console.error('User is not a super admin');
      return new Response(
        JSON.stringify({ error: 'Only super admins can delete tenants' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { tenant_id }: DeleteTenantRequest = await req.json();

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting tenant:', tenant_id);

    // ── STOP THE BILLING FIRST ───────────────────────────────────────────────
    //
    // Every subscription table cascades on tenants(id), so deleting the tenant
    // erases tenant_subscriptions, tenant_subscription_invoices and
    // subscription_plans — while the Stripe subscription keeps renewing. The
    // charge lands on a card we no longer hold a record of, for a tenant that no
    // longer exists, with no invoice history and no screen that will ever show
    // it. It is money taken from someone who has stopped being a customer.
    //
    // This has already happened: an audit found nine orphaned Stripe
    // subscriptions whose tenant ids return no rows, four of them ACTIVE in
    // live mode and one trialing. One tenant was orphaned on both platform
    // accounts and so was being billed twice.
    //
    // Cancel before deleting, and REFUSE to delete if we cannot confirm the
    // cancellation. Leaving a tenant undeleted is trivially recoverable; a
    // subscription billing into the void is not.
    const cancellations: Array<Record<string, unknown>> = [];
    try {
      const { data: liveSubs, error: liveSubsError } = await supabaseAdmin
        .from('tenant_subscriptions')
        .select('id, stripe_subscription_id, stripe_account, status')
        .eq('tenant_id', tenant_id)
        .in('status', ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']);

      if (liveSubsError) throw new Error(`Could not read subscriptions: ${liveSubsError.message}`);

      if (liveSubs && liveSubs.length > 0) {
        for (const sub of liveSubs) {
          if (!sub.stripe_subscription_id) continue;

          // ACCOUNT IS PER-ROW, BUT MODE IS NOT RECORDED ANYWHERE.
          //
          // This originally read the mode once from tenants.subscription_stripe_mode
          // and paired it with each row's account. Those are independent axes:
          // a tenant flagged 'test' can still hold a LIVE legacy UK subscription
          // (delta-force does today, with an open live invoice). Pairing uk+test
          // built a client for a DIFFERENT Stripe account, the cancel came back
          // 'resource_missing', that was classified "already absent" — and the
          // tenant was deleted with the live subscription still renewing. The
          // exact orphan this guard exists to prevent, produced by the guard.
          //
          // So try BOTH modes for the row's account, and only accept "not found"
          // once every reachable cell has said so. reconcile-subscriptions
          // already treats account x mode as a 2x2 grid; this now matches it.
          const account = sub.stripe_account === 'uae' ? 'uae' : 'uk';
          const modes: Array<'live' | 'test'> = ['live', 'test'];

          let canceled = false;
          let sawHardError: string | null = null;
          const missedIn: string[] = [];

          for (const mode of modes) {
            let stripe;
            try {
              stripe = getSubscriptionStripeClientForAccount(account, mode);
            } catch (_keyErr) {
              // No key configured for this cell — we cannot prove anything about
              // it, so it must not count as "confirmed absent".
              sawHardError = `no Stripe key configured for ${account}/${mode}`;
              continue;
            }
            try {
              await stripe.subscriptions.cancel(sub.stripe_subscription_id);
              console.log(`Canceled ${account}/${mode} subscription ${sub.stripe_subscription_id} before deleting tenant ${tenant_id}`);
              cancellations.push({ subscription: sub.stripe_subscription_id, account, mode, result: 'canceled' });
              canceled = true;
              break;
            } catch (cancelErr) {
              const code = (cancelErr as any)?.code;
              const msg = String((cancelErr as any)?.message ?? cancelErr);
              if (code === 'resource_missing' || /no such subscription/i.test(msg)) {
                missedIn.push(`${account}/${mode}`);
                continue; // genuinely not on this cell — try the other mode
              }
              // A real failure (network, auth, rate limit). Never delete on this.
              sawHardError = `${account}/${mode}: ${msg}`;
              break;
            }
          }

          if (canceled) continue;

          if (sawHardError) {
            throw new Error(
              `Could not cancel Stripe subscription ${sub.stripe_subscription_id} (${sawHardError}). ` +
              `Tenant NOT deleted — cancel it in Stripe first, then retry.`
            );
          }

          // Confirmed absent everywhere we could look. It cannot bill anyone.
          console.warn(`Subscription ${sub.stripe_subscription_id} not found in ${missedIn.join(', ')} — treating as already cancelled`);
          cancellations.push({
            subscription: sub.stripe_subscription_id,
            account,
            checked: missedIn,
            result: 'already-absent',
          });
        }
      }
    } catch (billingErr) {
      const message = String((billingErr as any)?.message ?? billingErr);
      console.error('Refusing to delete tenant with live billing:', message);
      return new Response(
        JSON.stringify({ error: message, stage: 'stripe-cancellation', cancellations }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all app_users for this tenant to delete their auth accounts
    const { data: appUsers, error: appUsersError } = await supabaseAdmin
      .from('app_users')
      .select('id, auth_user_id, email')
      .eq('tenant_id', tenant_id);

    if (appUsersError) {
      console.error('Error fetching app_users:', appUsersError);
    }

    const deletedAuthUsers: string[] = [];
    const failedAuthUsers: string[] = [];

    // Delete auth users for this tenant
    if (appUsers && appUsers.length > 0) {
      for (const appUser of appUsers) {
        if (appUser.auth_user_id) {
          try {
            const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(appUser.auth_user_id);
            if (deleteAuthError) {
              console.error(`Failed to delete auth user ${appUser.auth_user_id}:`, deleteAuthError);
              failedAuthUsers.push(appUser.email);
            } else {
              console.log(`Deleted auth user: ${appUser.email}`);
              deletedAuthUsers.push(appUser.email);
            }
          } catch (err) {
            console.error(`Exception deleting auth user ${appUser.auth_user_id}:`, err);
            failedAuthUsers.push(appUser.email);
          }
        }
      }
    }

    // Get vehicle IDs for this tenant (needed for pnl_entries)
    const { data: vehicles } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('tenant_id', tenant_id);

    const vehicleIds = vehicles ? vehicles.map(v => v.id) : [];

    // Delete all related data in order of dependencies
    const deletionResults: Record<string, number | string> = {};

    // Delete pnl_entries by vehicle_id
    if (vehicleIds.length > 0) {
      const { data: pnlData, error: pnlError } = await supabaseAdmin
        .from('pnl_entries')
        .delete()
        .in('vehicle_id', vehicleIds)
        .select('id');
      deletionResults.pnl_entries = pnlError ? pnlError.message : (pnlData?.length || 0);
    }

    /*
     * Every row that must go before `DELETE FROM tenants` can succeed.
     *
     * A FK to tenants(id) that is NOT `ON DELETE CASCADE` will refuse the final
     * delete, and the whole call 500s with a message naming one constraint. The
     * list used to carry four such tables and name them "verified against prod".
     * It has since fallen eleven behind: the referral and promo-code tables
     * arrived afterwards and nobody came back here, so deleting a tenant that
     * had ever been referred, or that owned a referral code, failed with
     *
     *   violates foreign key constraint
     *   "platform_promo_codes_owner_tenant_id_fkey" on table
     *   "platform_promo_codes"
     *
     * and fixing just that one only moved the failure to `referrals`. The list
     * below is the full set, taken from the migrations rather than from memory.
     *
     * TWO THINGS TO KNOW BEFORE EDITING:
     *
     *   1. The column is NOT always `tenant_id` — platform_promo_codes uses
     *      `owner_tenant_id`, and referrals points at a tenant TWICE. That is
     *      why these are [table, column] pairs and not bare names.
     *   2. Order is child-before-parent, and the referral group is NOT ordered
     *      by this list — see `unpickReferrals` below, which runs first.
     *
     * If a new table takes a non-cascading FK to tenants, it belongs here, and
     * the symptom of forgetting is a 500 on a delete nobody can explain.
     */

    /*
     * The referral group has to be unpicked by hand, and a first attempt that
     * simply listed the tables in `tenantScopedRows` failed against prod twice
     * over. Both reasons matter:
     *
     *   referral_events -> referrals -> promo_code_redemptions -> platform_promo_codes
     *
     *   1. ORDER. Deleting the redemption first is refused — "Key (id)=(…) is
     *      still referenced from table referrals" — and deleting the referral
     *      first is refused by referral_events. The chain has to be walked from
     *      the far end, which is the opposite of the order a reader would guess
     *      from the tenant columns.
     *   2. OWNERSHIP. A referral joins TWO tenants, and the rows hanging off it
     *      can belong to the OTHER one. Deleting referral_events by `tenant_id`
     *      leaves exactly the row that blocks the referral, because that event
     *      belongs to the referrer and the tenant being deleted was the
     *      referred. So the children are deleted by `referral_id`, from
     *      referrals found at EITHER end.
     */
    const unpickReferrals = async () => {
      const { data: refs } = await supabaseAdmin
        .from('referrals')
        .select('id')
        .or(`referrer_tenant_id.eq.${tenant_id},referred_tenant_id.eq.${tenant_id}`);
      const referralIds = (refs ?? []).map((r: { id: string }) => r.id);

      if (referralIds.length) {
        for (const [table, column] of [
          ['referral_events', 'referral_id'],
          ['referral_claims', 'resolved_referral_id'],
        ] as const) {
          const { data, error } = await supabaseAdmin
            .from(table).delete().in(column, referralIds).select('id');
          deletionResults[table] = error ? error.message : (data?.length || 0);
        }
        const { data, error } = await supabaseAdmin
          .from('referrals').delete().in('id', referralIds).select('id');
        deletionResults.referrals = error ? error.message : (data?.length || 0);
      }

      // Promo codes this tenant owns, and the rows pointing at them. Scans are
      // keyed by the CODE, so a scan by another tenant still blocks the code.
      const { data: codes } = await supabaseAdmin
        .from('platform_promo_codes').select('id').eq('owner_tenant_id', tenant_id);
      const codeIds = (codes ?? []).map((c: { id: string }) => c.id);
      if (codeIds.length) {
        await supabaseAdmin.from('referral_subscription_scans').delete().in('found_promo_code_id', codeIds);
        await supabaseAdmin.from('promo_code_redemptions').delete().in('promo_code_id', codeIds);
      }
      for (const [table, column] of [
        ['promo_code_redemptions', 'tenant_id'],
        ['platform_promo_codes', 'owner_tenant_id'],
      ] as const) {
        const { data, error } = await supabaseAdmin
          .from(table).delete().eq(column, tenant_id).select('id');
        deletionResults[table] = error ? error.message : (data?.length || 0);
      }
    };

    try {
      await unpickReferrals();
    } catch (err) {
      deletionResults.referral_group = `Error: ${err}`;
    }

    const tenantScopedRows: Array<[table: string, column: string]> = [
      // ── blocking: FK to tenants(id) with NO ACTION ──────────────────────
      // The referral group above has already gone; what remains is independent.
      ['referral_savings', 'tenant_id'],
      ['referral_subscription_scans', 'tenant_id'],
      ['referral_tier_state', 'tenant_id'],
      ['trax_support_tickets', 'tenant_id'],
      ['trax_support_conversations', 'tenant_id'],
      ['rental_additional_drivers', 'tenant_id'],
      ['bonzah_insurance_policies', 'tenant_id'],
      ['gig_driver_images', 'tenant_id'],
      // ── not blocking; cleared for tidiness ──────────────────────────────
      ['promocodes', 'tenant_id'],
      ['ledger_entries', 'tenant_id'],
      ['payments', 'tenant_id'],
      ['fines', 'tenant_id'],
      ['reminders', 'tenant_id'],
      ['service_records', 'tenant_id'],
      ['rentals', 'tenant_id'],
      ['vehicles', 'tenant_id'],
      ['customers', 'tenant_id'],
      ['app_users', 'tenant_id'],
      ['audit_logs', 'tenant_id'],
    ];

    for (const [table, column] of tenantScopedRows) {
      // Two passes over `referrals` on different columns, so the key is the
      // pair — keyed by table alone, the second would overwrite the first's
      // count and hide a failure.
      const key = column === 'tenant_id' ? table : `${table}.${column}`;
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq(column, tenant_id)
          .select('id');

        deletionResults[key] = error ? error.message : (data?.length || 0);
      } catch (err) {
        deletionResults[key] = `Error: ${err}`;
      }
    }

    // Finally delete the tenant
    const { error: tenantError } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenant_id);

    if (tenantError) {
      console.error('Error deleting tenant:', tenantError);
      return new Response(
        JSON.stringify({
          error: `Failed to delete tenant: ${tenantError.message}`,
          deletionResults,
          deletedAuthUsers,
          failedAuthUsers
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Tenant deleted successfully:', tenant_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Tenant and all associated data deleted successfully',
        cancellations,
        deletionResults,
        deletedAuthUsers,
        failedAuthUsers
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
