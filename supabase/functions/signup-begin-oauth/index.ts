// =============================================================================
// signup-begin-oauth — the Google half of step 1.
//
// ⚠️  NOT DEPLOYED. This function exists in the repo only. Deploying it, and
//     enabling a Google provider on the Supabase project, are two decisions to
//     be taken together — until both are done the browser never calls this
//     (the button is behind NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED, which is off).
//
// WHY IT EXISTS
// -------------
// `signup-begin` cannot serve a Google sign-up, and cannot be made to without
// redeploying a function that is live on production and taking real signups:
//
//   * it CREATES the auth user (`auth.admin.createUser`), whereas Google has
//     already created it by the time the browser comes back;
//   * it hard-requires a 10-character password, which an OAuth user has none of;
//   * and its identity probes refuse an address that already has an auth user —
//     a Google-created user falls into its "auth user with no profile" branch
//     and is answered EMAIL_EXISTS_SIGN_IN.
//
// Meanwhile EVERY later step (signup-resume, signup-slug-check,
// signup-payment-intent, signup-provision) starts by reading
// `app_metadata.d247_signup` and 404s with SIGNUP_NOT_FOUND when it is absent —
// and `signup-begin` is the only thing that writes it. So a Google user without
// this function is signed in and completely stuck.
//
// WHAT IT DOES
// ------------
// Takes the session Google just minted and stamps that same blob onto the
// existing user. It creates nothing, charges nothing, and touches no table.
//
// WHAT IT REFUSES
// ---------------
// The same three relationships `signup-begin` refuses, for the same reasons:
// portal staff, a booking-site renter, and (implicitly) anyone whose session is
// not a Google one. It ALSO differs from `signup-begin` in one deliberate way —
// its answers are not privacy-collapsed. `signup-begin` is unauthenticated, so a
// distinct code per relationship would let anyone probe an arbitrary address;
// this endpoint requires a valid session for the address in question, so the
// caller is telling US who they are and there is no oracle to close.
//
// verify_jwt is left at the project default (true). That is not the gate on its
// own — the anon key satisfies it — which is why `auth.getUser()` is called
// explicitly below, exactly as every other signup function does.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getSignupPlan } from "../_shared/signup-plans.ts";
import { getSignupStripeMode } from "../_shared/signup-stripe.ts";
import {
  checkThrottle,
  clientIp,
  isDisposableEmail,
  recordAttempt,
  signupError,
  SIGNUP_META_KEY,
  SIGNUP_META_VERSION,
  type SignupMetadata,
} from "../_shared/signup-state.ts";
import { clean, MAX } from "../_shared/tenant-provisioning.ts";

const LOG = "[signup-begin-oauth]";
const HOUR_MS = 60 * 60 * 1000;

interface BeginOauthRequest {
  planId?: string;
}

/**
 * The providers this endpoint will start a signup for.
 *
 * Deliberately a list and not "any session": a session minted by
 * `signInWithPassword` belongs to an account that either already went through
 * `signup-begin` (so it has the blob) or is somebody else's — a renter, a staff
 * member — and stamping a signup onto it would be starting a purchase on an
 * account whose owner did not ask for one.
 */
const ALLOWED_PROVIDERS = new Set(["google"]);

function providersOf(user: {
  app_metadata?: Record<string, unknown> | null;
}): string[] {
  const meta = user.app_metadata ?? {};
  const list = Array.isArray(meta.providers) ? meta.providers : [];
  const single = typeof meta.provider === "string" ? [meta.provider] : [];
  return [...new Set([...single, ...list].filter((p): p is string => typeof p === "string"))];
}

/**
 * The operator's name, from whichever key the provider used.
 *
 * It ends up on `app_users.first_name` via `signup-provision`, so an empty
 * string here is a portal whose owner row has no name on it. The local part of
 * the address is a poor last resort but it is a real, recognisable string, which
 * is better than a blank.
 */
function displayName(user: {
  user_metadata?: Record<string, unknown> | null;
  email?: string | null;
}): string {
  const meta = user.user_metadata ?? {};
  for (const key of ["name", "full_name", "given_name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      return clean(value, MAX.firstName);
    }
  }
  const local = (user.email ?? "").split("@")[0] ?? "";
  return clean(local, MAX.firstName);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    const missing = !supabaseUrl ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY";
    console.error(`${LOG} CONFIG_MISSING: ${missing} is not set`);
    return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, {
      env: missing,
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return signupError("UNAUTHENTICATED", "Missing authorization header", 401);
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return signupError("UNAUTHENTICATED", "Unauthorized", 401);

    const email = (user.email ?? "").trim().toLowerCase();
    if (!email) {
      // Google always returns one, but a provider that does not would produce a
      // tenant whose owner cannot be emailed or reset.
      return signupError("EMAIL_INVALID", "That account has no email address", 400);
    }

    let body: BeginOauthRequest;
    try {
      body = await req.json();
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }

    const plan = getSignupPlan(body?.planId);
    if (!plan) return signupError("PLAN_UNKNOWN", "Unknown plan", 400);

    // -----------------------------------------------------------------------
    // Idempotent short-circuit, BEFORE the throttle.
    //
    // The browser can legitimately arrive here twice — React StrictMode in
    // development double-invokes the return effect, and a refresh mid-call
    // repeats it. Re-stamping would reset `createdAt` and, worse, overwrite a
    // blob that has since collected a Stripe customer and subscription id, which
    // reads downstream as "never paid".
    // -----------------------------------------------------------------------
    const existing = user.app_metadata?.[SIGNUP_META_KEY];
    if (existing && existing.v === SIGNUP_META_VERSION) {
      console.log(`${LOG} ${user.id} already has a signup (${existing.status})`);
      return jsonResponse({
        success: true,
        email,
        planId: existing.planId ?? plan.id,
        stage: "already_in_signup",
      });
    }

    const ip = clientIp(req);
    const rules = [
      { scope: "signup_begin_oauth_user", key: user.id, limit: 5, windowMs: HOUR_MS },
      { scope: "signup_begin_oauth_ip", key: ip ?? "unknown", limit: 20, windowMs: HOUR_MS },
    ];
    const allowed = await checkThrottle(supabase, rules);
    await recordAttempt(supabase, {
      scope: "begin_oauth",
      ip_address: ip,
      email,
      auth_user_id: user.id,
      plan_id: plan.id,
      outcome: allowed ? "allowed" : "blocked",
      throttleRules: rules.map((r) => ({ scope: r.scope, key: r.key })),
    });
    if (!allowed) {
      return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
    }

    // -----------------------------------------------------------------------
    // Who is this?
    // -----------------------------------------------------------------------
    const providers = providersOf(user);
    if (!providers.some((p) => ALLOWED_PROVIDERS.has(p))) {
      console.log(`${LOG} refused ${email}: providers [${providers.join(", ")}]`);
      return signupError(
        "EMAIL_EXISTS_SIGN_IN",
        "An account already exists for this email",
        409,
        { resumable: true },
      );
    }

    // Same speed bump as the password path, and for the same reason: this
    // address becomes the login for a portal they are about to pay for.
    if (isDisposableEmail(email)) {
      return signupError(
        "EMAIL_DISPOSABLE",
        "Please use a permanent business email address",
        400,
        { field: "email" },
      );
    }

    const { data: staffMatches, error: staffError } = await supabase
      .from("app_users")
      .select("id, email")
      .ilike("email", email);
    if (staffError) throw staffError;
    // `ilike` narrows in Postgres; JS re-checks exactly so a legal underscore in
    // the address cannot wildcard-match someone else.
    if (
      (staffMatches || []).some(
        (u: { email: string | null }) => (u.email || "").toLowerCase() === email,
      )
    ) {
      console.log(`${LOG} refused ${email}: already a portal staff account`);
      return signupError("EMAIL_IS_STAFF", "This email already has a portal account", 409);
    }

    const { data: renter, error: renterError } = await supabase
      .from("customer_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (renterError) throw renterError;
    if (renter) {
      // NEVER convert a renter's account: they use it to sign in to a tenant's
      // booking site, and an operator account on the same row would be a
      // different person's data on a shared identity.
      console.log(`${LOG} refused ${email}: already a booking-site renter`);
      return signupError(
        "EMAIL_IS_CUSTOMER",
        "This email is already registered as a renter",
        409,
      );
    }

    // -----------------------------------------------------------------------
    // Stamp it.
    // -----------------------------------------------------------------------
    const now = new Date().toISOString();
    const meta: SignupMetadata = {
      v: SIGNUP_META_VERSION,
      status: "account_created",
      planId: plan.id,
      fullName: displayName(user),
      email,
      // Locked now, exactly as `signup-begin` locks it. Later steps read THIS
      // rather than the env var, so flipping SIGNUP_STRIPE_MODE mid-flight
      // cannot strand an in-progress signup on the wrong Stripe account.
      mode: getSignupStripeMode(),
      createdAt: now,
      updatedAt: now,
      milestones: [],
    };

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { [SIGNUP_META_KEY]: meta },
      // `signup-provision` reads `meta.fullName`, not this — but the portal's
      // own auth store reads `user_metadata.role`, and a head_admin who signed
      // up through Google must look identical to one who used a password.
      user_metadata: { ...(user.user_metadata ?? {}), role: "head_admin" },
    });
    if (updateError) {
      console.error(`${LOG} updateUserById failed:`, updateError);
      await recordAttempt(supabase, {
        scope: "begin_oauth",
        ip_address: ip,
        email,
        auth_user_id: user.id,
        plan_id: plan.id,
        outcome: "error",
        error_code: "INTERNAL",
        metadata: { message: updateError.message },
      });
      return signupError("INTERNAL", "Could not start your signup", 500);
    }

    console.log(`${LOG} started signup for ${user.id} (${email}) on plan ${plan.id}`);
    await recordAttempt(supabase, {
      scope: "begin_oauth",
      ip_address: ip,
      email,
      auth_user_id: user.id,
      plan_id: plan.id,
      outcome: "ok",
    });

    return jsonResponse({
      success: true,
      email,
      planId: plan.id,
      stage: "account_created",
    });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
