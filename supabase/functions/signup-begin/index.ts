// =============================================================================
// signup-begin — step 1 of the self-serve inbound onboarding flow.
//
// Creates the operator's auth.users row and stamps the in-flight signup blob
// onto `app_metadata.d247_signup`. Nothing else: no tenant, no Stripe object,
// no money. The browser then signs in with the password it just chose, and
// every LATER step runs with that user's own JWT.
//
// This is the ONLY signup function with `verify_jwt = false`, because by
// definition the caller has no user JWT yet. Its gate is therefore in code:
// honeypot, minimum form dwell time, an IP + email throttle, a disposable
// domain list, and four identity probes that make a second attempt for the same
// address resumable rather than duplicative.
//
// IRREVERSIBLE: once this returns 200 the auth user exists and nothing in the
// UI can delete it. Everything that can fail is therefore checked BEFORE the
// createUser call.
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
import { clean, EMAIL_RE, MAX } from "../_shared/tenant-provisioning.ts";

const LOG = "[signup-begin]";

/** A human cannot type a name, an email and a 10-char password this fast. */
const MIN_DWELL_MS = 1500;

const HOUR_MS = 60 * 60 * 1000;

interface BeginRequest {
  fullName?: string;
  email?: string;
  password?: string;
  planId?: string;
  /** Honeypot. Rendered off-screen; any value means a bot filled the form. */
  companyWebsite?: string;
  /** Date.now() captured when the account step mounted. */
  formStartedAt?: number;
}

/**
 * Every auth user whose address matches, via the GoTrue admin API.
 *
 * Done as a raw fetch rather than `auth.admin.listUsers()` because that method
 * pages through EVERY user on the project — tens of thousands of booking
 * customers — to find one address. `?filter=` is server-side.
 *
 * The result is treated as a NARROWING hint: GoTrue's filter is a partial
 * match, so we re-check the address exactly in JS.
 */
async function findAuthUserByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
): Promise<any | null> {
  const url = `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=20`;
  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) {
    // A failed probe must not create a duplicate account, and must not leak the
    // outage to the user as "email taken". Throw so the caller 500s honestly.
    throw new Error(`GoTrue admin lookup failed (${res.status})`);
  }
  const body = await res.json().catch(() => null);
  const users: any[] = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => String(u?.email ?? "").toLowerCase() === email) ?? null;
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
  const ip = clientIp(req);

  try {
    let body: BeginRequest;
    try {
      body = (await req.json()) as BeginRequest;
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }
    if (!body || typeof body !== "object") {
      return signupError("INVALID_BODY", "Invalid request body", 400);
    }

    const fullName = clean(body.fullName, MAX.firstName);
    const email = clean(body.email, MAX.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const plan = getSignupPlan(body.planId);

    // -----------------------------------------------------------------------
    // Honeypot. Repo precedent: submit-application returns a silent success so
    // the bot records a win and moves on, instead of learning which field is
    // the trap. Nothing is created and nothing is throttled.
    // -----------------------------------------------------------------------
    if (clean(body.companyWebsite, 200)) {
      console.log(`${LOG} honeypot tripped from ip=${ip ?? "unknown"} — silently ignored`);
      return jsonResponse({
        success: true,
        email,
        planId: plan?.id ?? clean(body.planId, 32),
        stage: "account_created",
      });
    }

    // -----------------------------------------------------------------------
    // Minimum dwell time.
    //
    // SOFT by design. A missing `formStartedAt`, or a NEGATIVE delta (the
    // client's clock is ahead of ours — extremely common), is logged and
    // allowed: a skewed clock is not evidence of abuse, and blocking on it
    // would lock a real operator out of signing up entirely with no way to
    // self-diagnose. Only a real, positive, impossibly-short dwell is rejected,
    // and it is rejected as RATE_LIMITED so the copy the user sees ("wait and
    // try again") is a true and recoverable instruction — two seconds later the
    // same submission passes.
    // -----------------------------------------------------------------------
    const startedAt = typeof body.formStartedAt === "number" ? body.formStartedAt : null;
    if (startedAt === null) {
      console.log(`${LOG} no formStartedAt supplied — dwell check skipped`);
    } else {
      const dwell = Date.now() - startedAt;
      if (dwell < 0) {
        console.log(`${LOG} negative dwell (${dwell}ms) — client clock skew, allowed`);
      } else if (dwell < MIN_DWELL_MS) {
        console.warn(`${LOG} rejected: dwell ${dwell}ms < ${MIN_DWELL_MS}ms, ip=${ip ?? "unknown"}`);
        return signupError("RATE_LIMITED", "That was too quick — please try again.", 429, {
          reason: "too_fast",
        });
      }
    }

    // -----------------------------------------------------------------------
    // Validation. Everything the client already checked, re-checked here — the
    // client is not a trust boundary.
    // -----------------------------------------------------------------------
    if (!plan) {
      return signupError("PLAN_UNKNOWN", "Unknown plan", 400);
    }
    if (fullName.length < 2) {
      return signupError("VALIDATION_FAILED", "Please enter your full name", 400, {
        field: "fullName",
      });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return signupError("EMAIL_INVALID", "That is not a valid email address", 400, {
        field: "email",
      });
    }
    if (isDisposableEmail(email)) {
      return signupError("EMAIL_DISPOSABLE", "Please use a permanent business email", 400, {
        field: "email",
      });
    }
    // Length and composition only. No maximum-complexity theatre: this password
    // is typed once and then used to sign into a portal, and every extra rule
    // pushes operators towards reusing one they already have.
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return signupError("WEAK_PASSWORD", "Password does not meet the requirements", 400, {
        field: "password",
      });
    }

    // -----------------------------------------------------------------------
    // Throttle. IP first (the cheap, broad control), then email.
    // -----------------------------------------------------------------------
    const rules = [
      ...(ip ? [{ scope: "signup_begin_ip", key: ip, limit: 5, windowMs: HOUR_MS }] : []),
      { scope: "signup_begin_email", key: email, limit: 3, windowMs: HOUR_MS },
    ];
    const allowed = await checkThrottle(supabase, rules);

    // The gate row is what the NEXT caller counts, so it is written for a block
    // as well as an allow — otherwise a blocked flood would never accumulate.
    await recordAttempt(supabase, {
      scope: "begin",
      ip_address: ip,
      email,
      plan_id: plan.id,
      outcome: allowed ? "allowed" : "blocked",
      metadata: { fullNameLength: fullName.length },
      throttleScope: ip ? "signup_begin_ip" : "signup_begin_email",
      throttleKey: ip ?? email,
    });

    if (!allowed) {
      return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
    }

    // -----------------------------------------------------------------------
    // Identity probes, in cost order. Each maps to a DISTINCT 409 code because
    // the right next action differs completely: sign in at your portal / use a
    // different address / enter your password and resume.
    // -----------------------------------------------------------------------

    // 1. Portal staff. `ilike` narrows in Postgres; JS re-checks exactly so a
    //    legal underscore in the address cannot wildcard-match someone else.
    const { data: staffMatches, error: staffError } = await supabase
      .from("app_users")
      .select("id, email")
      .ilike("email", email);
    if (staffError) throw staffError;
    if (
      (staffMatches || []).some(
        (u: { email: string | null }) => (u.email || "").toLowerCase() === email,
      )
    ) {
      return signupError(
        "EMAIL_IS_STAFF",
        "This email already has a Drive247 portal account",
        409,
      );
    }

    // 2/3/4. Any existing auth user for this address.
    const existingAuthUser = await findAuthUserByEmail(supabaseUrl, serviceKey, email);
    if (existingAuthUser) {
      const { data: renter, error: renterError } = await supabase
        .from("customer_users")
        .select("id")
        .eq("auth_user_id", existingAuthUser.id)
        .limit(1)
        .maybeSingle();
      if (renterError) throw renterError;

      if (renter) {
        // NEVER reset their password to let them "resume" — that would silently
        // break a real renter's login on a tenant's booking site.
        return signupError(
          "EMAIL_IS_CUSTOMER",
          "This email is already registered as a renter",
          409,
          { field: "email" },
        );
      }

      const priorSignup = existingAuthUser.app_metadata?.[SIGNUP_META_KEY];
      if (priorSignup && priorSignup.v === SIGNUP_META_VERSION) {
        return signupError("EMAIL_IN_SIGNUP", "A signup is already in progress", 409, {
          resumable: true,
          status: priorSignup.status ?? "account_created",
        });
      }

      // A stray auth user with no profile of any kind. They still hold the
      // address, and we cannot mint a second account for it.
      return signupError("EMAIL_EXISTS_SIGN_IN", "An account already exists for this email", 409, {
        resumable: true,
      });
    }

    // -----------------------------------------------------------------------
    // Create the account.
    //
    // `email_confirm: true` because apps/web has NO confirmation route to send
    // anyone to, and `custom-auth-email` explicitly skips signup emails — a
    // pending confirmation would be a dead end nobody could clear.
    // -----------------------------------------------------------------------
    const now = new Date().toISOString();
    const meta: SignupMetadata = {
      v: SIGNUP_META_VERSION,
      status: "account_created",
      planId: plan.id,
      fullName,
      email,
      // Locked now. Later steps read THIS, not the env var, so flipping
      // SIGNUP_STRIPE_MODE mid-flight cannot strand an in-progress signup on
      // the wrong Stripe account.
      mode: getSignupStripeMode(),
      createdAt: now,
      updatedAt: now,
      milestones: [],
    };

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: fullName, role: "head_admin" },
      app_metadata: { [SIGNUP_META_KEY]: meta },
    });

    if (createError || !created?.user) {
      console.error(`${LOG} auth.admin.createUser failed:`, createError);
      // Closes the check-then-create race: two tabs submitting the same address
      // concurrently both pass the probes above, and only GoTrue stops the
      // second. Report it as the resumable conflict it is, not a 500.
      if (/already (been )?registered|already exists/i.test(createError?.message || "")) {
        return signupError(
          "EMAIL_EXISTS_SIGN_IN",
          "An account already exists for this email",
          409,
          { resumable: true },
        );
      }
      await recordAttempt(supabase, {
        scope: "begin",
        ip_address: ip,
        email,
        plan_id: plan.id,
        outcome: "error",
        error_code: "INTERNAL",
        metadata: { message: createError?.message ?? "unknown" },
      });
      return signupError("INTERNAL", "Could not create your account", 500);
    }

    console.log(`${LOG} created auth user ${created.user.id} for ${email} on plan ${plan.id}`);

    await recordAttempt(supabase, {
      scope: "begin",
      ip_address: ip,
      email,
      auth_user_id: created.user.id,
      plan_id: plan.id,
      outcome: "ok",
    });

    // The password is NOT echoed and NOT stored anywhere: the browser already
    // has it and signs in with it immediately.
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
