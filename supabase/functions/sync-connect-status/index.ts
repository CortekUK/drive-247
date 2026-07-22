import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getTenantChargeContext } from "../_shared/stripe-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// sync-connect-status
// -------------------
// Refreshes each tenant's LIVE Stripe Connect account state onto their tenant row.
//
// Why this exists: `stripe_onboarding_complete` is a local flag written once at
// onboarding and never revalidated. Stripe can disable charges on a connected
// account afterwards (verification lapsed, requirements past due, risk review) and
// the product has no idea — the operator only discovers it when a checkout call
// throws, surfacing as an opaque non-2xx toast. This syncs the truth so an
// unchargeable account is visible before anyone tries to charge a customer.
//
//   { tenantId }  -> sync one tenant, returns its full account status
//   { all: true } -> sync every onboarded tenant (intended for a cron schedule)
//
// Read-only against Stripe; the only writes are status columns on `tenants`.
// Never throws on a single tenant's failure in `all` mode — one broken account
// must not stop the sweep.

interface AccountStatus {
  tenantId: string;
  slug: string | null;
  connectAccountId: string | null;
  mode: string;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  detailsSubmitted: boolean | null;
  disabledReason: string | null;
  currentlyDue: string[];
  pastDue: string[];
  capabilities: Record<string, string>;
  error: string | null;
}

async function syncOne(supabase: any, tenantId: string, slug: string | null): Promise<AccountStatus> {
  const base: AccountStatus = {
    tenantId, slug, connectAccountId: null, mode: "unknown",
    chargesEnabled: null, payoutsEnabled: null, detailsSubmitted: null,
    disabledReason: null, currentlyDue: [], pastDue: [], capabilities: {}, error: null,
  };

  try {
    const { stripe, connectAccountId, mode } = await getTenantChargeContext(supabase, tenantId);
    base.connectAccountId = connectAccountId;
    base.mode = mode;

    // Managed tenants with no connected account charge on the platform account —
    // there is no Connect account to inspect, and that is not an error.
    if (!connectAccountId) {
      base.error = "No connected account (charges run on the platform account)";
      return base;
    }

    const account = await stripe.accounts.retrieve(connectAccountId);
    const req = (account.requirements ?? {}) as Record<string, any>;

    base.chargesEnabled = account.charges_enabled ?? null;
    base.payoutsEnabled = account.payouts_enabled ?? null;
    base.detailsSubmitted = account.details_submitted ?? null;
    base.disabledReason = req.disabled_reason ?? null;
    base.currentlyDue = Array.isArray(req.currently_due) ? req.currently_due : [];
    base.pastDue = Array.isArray(req.past_due) ? req.past_due : [];
    base.capabilities = (account.capabilities ?? {}) as Record<string, string>;

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        stripe_charges_enabled: base.chargesEnabled,
        stripe_payouts_enabled: base.payoutsEnabled,
        stripe_account_disabled_reason: base.disabledReason,
        stripe_requirements_due: base.currentlyDue,
        stripe_status_synced_at: new Date().toISOString(),
      })
      .eq("id", tenantId);
    if (updateError) base.error = `Status fetched but not persisted: ${updateError.message}`;

    return base;
  } catch (e) {
    // Surface the real Stripe message — that is the entire point of this function.
    base.error = (e as { message?: string })?.message || String(e);
    return base;
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);
    const token = authHeader.replace("Bearer ", "").trim();

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // Callers: the scheduled sweep (service-role key) or a super admin from the UI.
    let authorized = token === serviceKey;
    if (!authorized) {
      const supabaseAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!
      );
      const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
      if (userError || !user) return errorResponse("Unauthorized", 401);
      const { data: appUsers } = await supabase
        .from("app_users")
        .select("is_super_admin")
        .eq("auth_user_id", user.id);
      authorized = Array.isArray(appUsers) && appUsers.some((u: any) => u.is_super_admin === true);
    }
    if (!authorized) return errorResponse("Only super admins can sync Connect account status", 403);

    const { tenantId, all } = await req.json().catch(() => ({}));

    if (all) {
      const { data: tenants } = await supabase
        .from("tenants")
        .select("id, slug")
        .eq("stripe_onboarding_complete", true);

      const results: AccountStatus[] = [];
      for (const t of tenants || []) {
        results.push(await syncOne(supabase, t.id, t.slug));
      }
      const broken = results.filter((r) => r.chargesEnabled === false);
      if (broken.length) {
        console.warn(`[sync-connect-status] ${broken.length} tenant(s) cannot accept charges:`,
          broken.map((b) => `${b.slug}(${b.disabledReason ?? "unknown"})`).join(", "));
      }
      return jsonResponse({ synced: results.length, brokenCount: broken.length, results });
    }

    if (!tenantId) return errorResponse("tenantId is required (or pass all: true)");

    const { data: tenant } = await supabase
      .from("tenants").select("id, slug").eq("id", tenantId).single();
    if (!tenant) return errorResponse("Tenant not found", 404);

    return jsonResponse({ status: await syncOne(supabase, tenant.id, tenant.slug) });
  } catch (error) {
    console.error("sync-connect-status error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
