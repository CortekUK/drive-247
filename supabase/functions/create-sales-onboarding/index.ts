// =============================================================================
// create-sales-onboarding
//
// One-shot super-admin / sales-agent provisioning for George's Sales tab.
// Given a filled onboarding form it:
//   1. verifies the caller (super admin OR sales agent),
//   2. guards slug + email uniqueness (fixes a real duplicate-credential bug),
//   3. extracts brand colours from free text -> full tenant palette,
//   4. inserts the tenant (production => live money / boldsign live),
//   5. grants 100 live welcome credits,
//   6. creates the head_admin auth user + app_user,
//   7. creates the live 0-day subscription plan (the hard paywall),
//   8. records the submission (best-effort), and
//   9. returns a ready-to-send client message with the login details.
//
// Everything after the tenant insert is fully rolled back on failure so a
// half-provisioned tenant (or a password that won't work) never reaches George.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { extractBrandColorsFromText, buildTenantPalette } from "../_shared/brand-colors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";

const LOG = "[create-sales-onboarding]";

interface OnboardingRequest {
  companyName?: string;
  firstName?: string;
  slug?: string;
  contactEmail?: string;
  businessPhone?: string;
  vehicleType?: string;
  fleetSize?: string;
  location?: string;
  operatingHours?: string;
  businessColours?: string;
  logoUrl?: string;
  wantsMarketing?: boolean;
  hasMetaAdAccount?: boolean;
  metaDailyBudget?: string;
  otherInfo?: string;
  tenantType?: "production" | "test";
  subscriptionAmount?: number;
  subscriptionCurrency?: string;
}

/** Uppercase the first char, leave the rest untouched. */
function capitalizeFirst(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Symbol/prefix for the client-facing amount line. */
function currencySymbol(currency: string): string {
  switch (currency.toLowerCase()) {
    case "usd":
      return "$";
    case "gbp":
      return "£";
    case "eur":
      return "€";
    case "aed":
      return "AED ";
    default:
      return currency.toUpperCase() + " ";
  }
}

/** Dollars from cents, dropping a trailing ".00" for clean copy. */
function formatDollars(amountCents: number): string {
  const dollars = amountCents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Service-role client — everything runs with this (bypasses RLS).
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // ---------------------------------------------------------------------
    // 2. Auth — caller must be an active super admin OR sales agent.
    // ---------------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse("Missing authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const { data: caller, error: callerError } = await supabase
      .from("app_users")
      .select("id, is_active, is_super_admin, is_sales_agent")
      .eq("auth_user_id", user.id)
      .single();

    if (callerError || !caller) {
      return errorResponse("User not found", 403);
    }
    if (!caller.is_active || !(caller.is_super_admin || caller.is_sales_agent)) {
      return errorResponse("Only super admins or sales agents can onboard tenants", 403);
    }
    const createdBy: string = caller.id;

    // ---------------------------------------------------------------------
    // 3. Validate + sanitize.
    // ---------------------------------------------------------------------
    const body = (await req.json()) as OnboardingRequest;

    const companyName = (body.companyName || "").trim();
    const firstName = (body.firstName || "").trim();
    const contactEmail = (body.contactEmail || "").trim();
    const rawSlug = (body.slug || "").trim();
    const tenantType: "production" | "test" = body.tenantType === "test" ? "test" : "production";
    const isProduction = tenantType === "production";
    const currency = (body.subscriptionCurrency || "usd").toLowerCase();
    const subscriptionAmount = Number(body.subscriptionAmount);

    if (!companyName) {
      return errorResponse("Company name is required", 400);
    }
    if (!contactEmail) {
      return errorResponse("Contact email is required", 400);
    }
    if (!Number.isFinite(subscriptionAmount) || subscriptionAmount <= 0) {
      return errorResponse("Subscription amount must be greater than 0", 400);
    }

    const slug = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 3 || slug.length > 50) {
      return errorResponse(
        "Slug must start with a letter, be 3–50 characters, and use only lowercase letters, numbers, and hyphens",
        400,
      );
    }

    const amountCents = Math.round(subscriptionAmount * 100);
    const portalUrl = `https://${slug}.portal.drive-247.com`;
    const bookingUrl = `https://${slug}.drive-247.com`;

    // Shared field set for the best-effort submission row (created OR failed).
    const submissionBase = {
      created_by: createdBy,
      first_name: firstName || null,
      business_name: companyName,
      slug,
      vehicle_type: body.vehicleType || null,
      fleet_size: body.fleetSize || null,
      location: body.location || null,
      business_phone: body.businessPhone || null,
      business_email: contactEmail,
      operating_hours: body.operatingHours || null,
      business_colours: body.businessColours || null,
      logo_url: body.logoUrl || null,
      wants_marketing: typeof body.wantsMarketing === "boolean" ? body.wantsMarketing : null,
      has_meta_ad_account: typeof body.hasMetaAdAccount === "boolean" ? body.hasMetaAdAccount : null,
      meta_daily_budget: body.metaDailyBudget || null,
      other_info: body.otherInfo || null,
      subscription_amount: amountCents,
      subscription_currency: currency,
      portal_url: portalUrl,
      booking_url: bookingUrl,
    };

    /** Best-effort failed-submission record. Never throws. */
    const recordFailure = async (message: string) => {
      try {
        await supabase.from("sales_onboarding_submissions").insert({
          ...submissionBase,
          status: "failed",
          error_message: message,
        });
      } catch (e) {
        console.error(`${LOG} could not record failed submission:`, e);
      }
    };

    // ---------------------------------------------------------------------
    // 4. Uniqueness guards (fix the known duplicate-credential bug).
    // ---------------------------------------------------------------------
    const { data: existingSlug } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingSlug) {
      return errorResponse("Slug already taken", 409);
    }

    // Case-insensitive email match. `ilike` narrows; JS verifies exactly so a
    // legal underscore in the address can't cause a false duplicate.
    const { data: emailMatches } = await supabase
      .from("app_users")
      .select("id, email")
      .ilike("email", contactEmail);
    const emailTaken = (emailMatches || []).some(
      (u: { email: string | null }) => (u.email || "").toLowerCase() === contactEmail.toLowerCase(),
    );
    if (emailTaken) {
      return errorResponse("An account already exists for this email", 409);
    }

    // ---------------------------------------------------------------------
    // 5. Password (deterministic; client must change on first login).
    // ---------------------------------------------------------------------
    const password = capitalizeFirst(slug.toLowerCase().replace(/[^a-z0-9]/g, "")) + "123!";

    // ---------------------------------------------------------------------
    // 6. Brand colours -> full tenant palette.
    // ---------------------------------------------------------------------
    const colors = await extractBrandColorsFromText(body.businessColours, null);
    const palette = buildTenantPalette(colors);

    // ---------------------------------------------------------------------
    // 7. Insert tenant. AFTER-INSERT triggers auto-grant 1000 test credits +
    //    seed CMS pages (incl. site-settings).
    // ---------------------------------------------------------------------
    const modeCols = isProduction
      ? { boldsign_mode: "live", subscription_stripe_mode: "live", subscription_account: "uk" }
      : { boldsign_mode: "test", subscription_stripe_mode: "test", subscription_account: "uk" };

    const logoCols = body.logoUrl
      ? { logo_url: body.logoUrl, dark_logo_url: body.logoUrl, auth_logo_url: body.logoUrl }
      : {};

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        company_name: companyName,
        admin_name: firstName || null,
        slug,
        contact_email: contactEmail,
        contact_phone: body.businessPhone || null,
        address: body.location || null,
        business_hours: body.operatingHours || null,
        status: "active",
        tenant_type: tenantType,
        ...palette,
        ...logoCols,
        ...modeCols,
      })
      .select()
      .single();

    if (tenantError || !tenant) {
      console.error(`${LOG} tenant insert failed:`, tenantError);
      await recordFailure(`Tenant insert failed: ${tenantError?.message || "unknown error"}`);
      return errorResponse("Failed to create tenant", 500);
    }

    const tenantId: string = tenant.id;

    // ---------------------------------------------------------------------
    // 8. 100 live welcome credits (non-fatal).
    // ---------------------------------------------------------------------
    try {
      const { error: creditError } = await supabase.rpc("add_credits", {
        p_tenant_id: tenantId,
        p_amount: 100,
        p_type: "gift",
        p_description: "Welcome bonus: 100 live credits",
        p_is_test_mode: false,
      });
      if (creditError) {
        console.error(`${LOG} add_credits failed (non-fatal):`, creditError);
      }
    } catch (e) {
      console.error(`${LOG} add_credits threw (non-fatal):`, e);
    }

    // Best-effort tenant cleanup used by the rollback paths below.
    const deleteTenant = async () => {
      try {
        await supabase.from("tenants").delete().eq("id", tenantId);
      } catch (e) {
        console.error(`${LOG} rollback: delete tenant failed:`, e);
      }
    };

    // ---------------------------------------------------------------------
    // 9. Create the head_admin auth user.
    // ---------------------------------------------------------------------
    const { data: authUser, error: createAuthError } = await supabase.auth.admin.createUser({
      email: contactEmail,
      password,
      email_confirm: true,
      user_metadata: { name: `${companyName} Admin`, role: "head_admin" },
    });

    if (createAuthError || !authUser?.user) {
      console.error(`${LOG} auth.admin.createUser failed:`, createAuthError);
      await deleteTenant();
      await recordFailure(`Auth user creation failed: ${createAuthError?.message || "unknown error"}`);
      return errorResponse("Failed to create login user", 500);
    }
    const authUserId = authUser.user.id;

    const deleteAuthUser = async () => {
      try {
        await supabase.auth.admin.deleteUser(authUserId);
      } catch (e) {
        console.error(`${LOG} rollback: delete auth user failed:`, e);
      }
    };

    // ---------------------------------------------------------------------
    // 10. Create the app_user (head_admin, must change password).
    // ---------------------------------------------------------------------
    const { data: appUser, error: appUserError } = await supabase
      .from("app_users")
      .insert({
        auth_user_id: authUserId,
        email: contactEmail,
        name: `${companyName} Admin`,
        role: "head_admin",
        is_active: true,
        must_change_password: true,
        tenant_id: tenantId,
      })
      .select()
      .single();

    if (appUserError || !appUser) {
      console.error(`${LOG} app_users insert failed:`, appUserError);
      await deleteAuthUser();
      await deleteTenant();
      await recordFailure(`App user creation failed: ${appUserError?.message || "unknown error"}`);
      return errorResponse("Failed to create user profile", 500);
    }

    const deleteAppUser = async () => {
      try {
        await supabase.from("app_users").delete().eq("id", appUser.id);
      } catch (e) {
        console.error(`${LOG} rollback: delete app_user failed:`, e);
      }
    };

    // ---------------------------------------------------------------------
    // 11. Live 0-day subscription plan — this is the hard paywall. Any failure
    //     here fully rolls back (no active plan => the paywall never fires).
    // ---------------------------------------------------------------------
    try {
      const mode: "test" | "live" = isProduction ? "live" : "test";
      const stripe = getSubscriptionStripeClientForAccount("uk", mode);

      const price = await stripe.prices.create({
        unit_amount: amountCents,
        currency,
        recurring: { interval: "month" },
        product_data: { name: "Drive247 Platform Subscription" },
        metadata: { tenant_id: tenantId, plan_name: "Monthly Subscription" },
      });

      const { error: planError } = await supabase.from("subscription_plans").insert({
        tenant_id: tenantId,
        name: "Monthly Subscription",
        description: null,
        features: [],
        amount: amountCents,
        currency,
        interval: "month",
        stripe_price_id: price.id,
        stripe_product_id: price.product,
        stripe_account: "uk",
        trial_days: 0,
        billing_model: "trial",
        is_active: true,
        sort_order: 0,
      });

      if (planError) {
        throw planError;
      }
    } catch (e) {
      console.error(`${LOG} subscription plan creation failed:`, e);
      await deleteAppUser();
      await deleteAuthUser();
      await deleteTenant();
      await recordFailure(
        `Subscription plan creation failed: ${(e as Error)?.message || "unknown error"}`,
      );
      return errorResponse("Failed to create subscription plan", 500);
    }

    // ---------------------------------------------------------------------
    // 12. Record the successful submission (best-effort, non-fatal).
    // ---------------------------------------------------------------------
    try {
      await supabase.from("sales_onboarding_submissions").insert({
        ...submissionBase,
        tenant_id: tenantId,
        extracted_colors: colors,
        generated_email: contactEmail,
        status: "created",
      });
    } catch (e) {
      console.error(`${LOG} could not record submission (non-fatal):`, e);
    }

    // ---------------------------------------------------------------------
    // 13. Build the client message + respond.
    // ---------------------------------------------------------------------
    const amountLabel = `${currencySymbol(currency)}${formatDollars(amountCents)}`;
    const message =
      `Hi ${firstName || "there"},\n\n` +
      `Your ${companyName} portal is ready! 🎉\n\n` +
      `🔑 Login details\n` +
      `Email: ${contactEmail}\n` +
      `Password: ${password}\n` +
      `(You'll set your own password on first login.)\n\n` +
      `🖥️  Admin portal (log in here): ${portalUrl}\n` +
      `🚗  Your booking site: ${bookingUrl}\n\n` +
      `When you first log in you'll activate your subscription (${amountLabel}/month) to unlock your dashboard.\n\n` +
      `Any questions, just reply here!`;

    console.log(`${LOG} provisioned tenant ${tenantId} (${slug}) for ${contactEmail}`);

    return jsonResponse({
      success: true,
      tenantId,
      slug,
      companyName,
      adminEmail: contactEmail,
      adminPassword: password,
      portalUrl,
      bookingUrl,
      subscriptionAmount: amountCents,
      subscriptionCurrency: currency,
      colors,
      message,
    });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return errorResponse((error as Error)?.message || "Internal server error", 500);
  }
});
