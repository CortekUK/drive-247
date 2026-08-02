// =============================================================================
// signup-provision — step 3, the one-shot provisioner for self-serve signups.
//
// Turns a paid signup into a live tenant: validates the business form, verifies
// the payment against Stripe, derives a brand palette, inserts the tenant, the
// owner's app_user and the subscription plan, links the Stripe subscription to
// the new tenant, and publishes the booking-site CMS content.
//
// The provisioning ORDER and the helpers are the ones create-sales-onboarding
// has been running in production; the portable parts of that function are
// copied into _shared/tenant-provisioning.ts and _shared/tenant-cms-content.ts
// (see the banner in those files for why by copy and not by extraction).
//
// TWO CONCERNS THAT MUST NEVER BE CONFLATED
// -----------------------------------------
//  * PROVISIONING is rolled back on failure. A half-built tenant — one with a
//    login but no plan, or a plan but no subscription row — is worse than no
//    tenant at all, because the owner can sign in and find a broken product.
//  * THE PAYMENT IS NEVER ROLLED BACK. The card has been charged and the
//    subscription is live. Cancelling it to "clean up" would take the
//    operator's money and leave them with nothing. On every failure the Stripe
//    objects are left exactly as they are, and the user retries into the same
//    subscription.
//
// The auth user is likewise NEVER deleted at any point: they hold a paid
// subscription, and deleting the login would lock them out of the thing they
// just bought.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { extractBrandColorsFromText, buildTenantPalette } from "../_shared/brand-colors.ts";
import { getSignupPlan } from "../_shared/signup-plans.ts";
import {
  getOrCreateSignupPrice,
  getSignupStripeClient,
  getSignupStripeMode,
  periodPatch,
  resolveCard,
  resolveSubscriptionPeriod,
  SIGNUP_STRIPE_ACCOUNT,
  SignupConfigError,
} from "../_shared/signup-stripe.ts";
import {
  checkThrottle,
  clientIp,
  markMilestone,
  PROVISION_LOCK_MS,
  PROVISION_MILESTONES,
  readSignupMeta,
  recordAttempt,
  signupError,
  writeSignupMeta,
  type SignupBusinessSnapshot,
} from "../_shared/signup-state.ts";
import {
  clean,
  cleanOrNull,
  deriveTimezone,
  isHttpUrl,
  deriveSlugFromName,
  isReservedSlug,
  isUniqueViolation,
  MAX,
  normalizePhone,
  normalizeSlug,
  parseOperatingHours,
  scheduleToHourCols,
  suggestSlugs,
  type HourCols,
} from "../_shared/tenant-provisioning.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { buildCmsContent, seedTenantCmsContent } from "../_shared/tenant-cms-content.ts";

const LOG = "[signup-provision]";


/**
 * Escape user-supplied text before it goes into the welcome email's HTML.
 *
 * `companyName` is free text the operator typed on a public form. Interpolating
 * it raw would let a business name containing markup rewrite the email body —
 * and an email is a place where a forged "click here to verify" block is
 * unusually convincing.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HOUR_MS = 60 * 60 * 1000;

/** Stripe statuses that mean this signup has been paid for. */
const PAID_STATUSES = new Set(["active", "trialing"]);

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};
const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * A human-readable `tenants.business_hours` line from the structured schedule.
 *
 * The sales path gets this for free because its form collects free text. Ours
 * only collects checkboxes and time selects, and leaving business_hours NULL is
 * not cosmetic: the booking site's About and Contact pages render it, and the
 * generated CMS copy falls back to "Get in touch to arrange a pickup time" when
 * it is empty. Contiguous days are collapsed into a range ("Mon–Fri"), which is
 * how every operator writes them.
 */
function scheduleDisplayText(
  schedule: { alwaysOpen?: boolean; days?: string[]; opensAt?: string; closesAt?: string } | undefined,
): string {
  if (!schedule) return "";
  if (schedule.alwaysOpen === true) return "Open 24/7";

  const picked = DAY_ORDER.filter((d) => (schedule.days ?? []).includes(d));
  if (!picked.length || !schedule.opensAt || !schedule.closesAt) return "";

  const runs: string[][] = [];
  for (const day of picked) {
    const last = runs[runs.length - 1];
    const prevIndex = last ? DAY_ORDER.indexOf(last[last.length - 1]) : -2;
    if (last && DAY_ORDER.indexOf(day) === prevIndex + 1) last.push(day);
    else runs.push([day]);
  }

  const dayText = runs
    .map((run) =>
      run.length > 1
        ? `${DAY_LABELS[run[0]]}–${DAY_LABELS[run[run.length - 1]]}`
        : DAY_LABELS[run[0]]
    )
    .join(", ");

  return `${dayText} ${schedule.opensAt}–${schedule.closesAt}`;
}

interface ProvisionRequest {
  companyName?: string;
  slug?: string;
  location?: string;
  businessPhone?: string;
  fleetSize?: string;
  vehicleType?: string;
  businessColours?: string;
  logoUrl?: string;
  operatingSchedule?: {
    alwaysOpen?: boolean;
    days?: string[];
    opensAt?: string;
    closesAt?: string;
  };
  acceptedTerms?: boolean;
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
    // =====================================================================
    // 0. Auth, idempotency, lock.
    // =====================================================================
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return signupError("UNAUTHENTICATED", "Missing authorization header", 401);
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return signupError("UNAUTHENTICATED", "Unauthorized", 401);
    const authUserId = user.id;

    let meta = readSignupMeta(user);
    if (!meta) return signupError("SIGNUP_NOT_FOUND", "No signup in progress", 404);

    // ---- Idempotency: already provisioned? -------------------------------
    // Returned as a 200 SUCCESS with the full result, not a 409. A second tab
    // (or a retry after a dropped response) asked "did this work?" and the
    // honest answer is yes — surfacing an error there would show a failure
    // panel over a tenant that exists and works.
    if (meta.tenantId) {
      const { data: existingTenant } = await supabase
        .from("tenants")
        .select("id, slug, company_name")
        .eq("id", meta.tenantId)
        .maybeSingle();

      if (existingTenant) {
        console.log(`${LOG} idempotent hit — tenant ${existingTenant.id} already provisioned`);
        return jsonResponse({
          success: true,
          tenantId: existingTenant.id,
          slug: existingTenant.slug,
          companyName: existingTenant.company_name ?? meta.business?.companyName ?? "",
          portalUrl: meta.portalUrl ?? `https://${existingTenant.slug}.portal.drive-247.com`,
          bookingUrl: meta.bookingUrl ?? `https://${existingTenant.slug}.drive-247.com`,
          portalSignInUrl: meta.portalSignInUrl ?? null,
          contentSeeded: meta.contentSeeded !== false,
          milestones: meta.milestones ?? [],
        });
      }
      // The tenant id is stale (a rollback that could not clear the metadata).
      console.warn(`${LOG} meta.tenantId ${meta.tenantId} has no tenant row — treating as a fresh run`);
    }

    // ---- Lock -------------------------------------------------------------
    // Two tabs submitting the business form at the same moment must produce ONE
    // tenant. The loser gets a 409 the UI treats as "keep polling", not as an
    // error, and converges on the winner's result via the milestone poller.
    if (meta.provisionLockAt) {
      const age = Date.now() - new Date(meta.provisionLockAt).getTime();
      if (age >= 0 && age < PROVISION_LOCK_MS) {
        console.log(`${LOG} lock held for ${authUserId} (${age}ms old) — rejecting concurrent run`);
        return signupError("PROVISION_IN_PROGRESS", "Your portal is already being built", 409);
      }
      console.warn(`${LOG} taking over a stale lock (${age}ms old) for ${authUserId}`);
    }

    const allowed = await checkThrottle(supabase, [
      { scope: "signup_provision", key: authUserId, limit: 5, windowMs: HOUR_MS },
    ]);
    await recordAttempt(supabase, {
      scope: "provision",
      ip_address: clientIp(req),
      email: meta.email,
      auth_user_id: authUserId,
      plan_id: meta.planId,
      outcome: allowed ? "allowed" : "blocked",
      throttleScope: "signup_provision",
      throttleKey: authUserId,
    });
    if (!allowed) {
      return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
    }

    let body: ProvisionRequest;
    try {
      body = (await req.json()) as ProvisionRequest;
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }
    if (!body || typeof body !== "object") {
      return signupError("INVALID_BODY", "Invalid request body", 400);
    }

    // Milestones are RESET here, not appended to. A retry after a rolled-back
    // failure must restart the boot screen at 0/8 — leaving the previous run's
    // milestones would show a bar that is already full while nothing has
    // actually been rebuilt.
    const lockStamp = new Date().toISOString();
    meta = await writeSignupMeta(supabase, authUserId, {
      status: "provisioning",
      provisionLockAt: lockStamp,
      provisionAttempts: (meta.provisionAttempts ?? 0) + 1,
      milestones: [],
      lastError: null,
    });

    // Confirm we actually HOLD the lock we just took.
    //
    // The check above and the write are not atomic, so two tabs submitting in
    // the same instant can both pass it. GoTrue serialises the two writes, so
    // re-reading afterwards tells us which one landed last: whoever does not
    // see their own stamp yields. Without this the loser would run on to the
    // tenant INSERT and surface a confusing "that web address is already taken"
    // for a slug their own other tab was in the middle of claiming.
    const { data: lockCheck } = await supabase.auth.admin.getUserById(authUserId);
    const heldBy = readSignupMeta(lockCheck?.user)?.provisionLockAt;
    if (heldBy && heldBy !== lockStamp) {
      console.log(`${LOG} lost the lock race for ${authUserId} (held at ${heldBy}) — yielding`);
      return signupError("PROVISION_IN_PROGRESS", "Your portal is already being built", 409);
    }

    // ---- Recovery: a tenant row from a run that never reported back --------
    //
    // `pendingTenantId` is written the instant the tenant is inserted, so it is
    // the only trace left when an isolate is killed mid-run (wall-clock limit,
    // redeploy, OOM). Without this branch that retry restarts from scratch,
    // hits its OWN tenant in the slug pre-check and returns SLUG_TAKEN — to a
    // customer whose card is already charged, for ever.
    //
    // Which way it goes is decided by ONE question: does a `tenant_subscriptions`
    // row point at that tenant? That row is step 7a, the documented point of no
    // return.
    //
    //   yes → the run got past the point of no return and died before recording
    //         it. The tenant is usable (owner account, plan and subscription all
    //         exist); everything after 7a is non-fatal. Promote and hand it over.
    //   no  → nothing references it and nothing in Stripe points at it. Discard
    //         it completely so the retry is genuinely fresh — including the
    //         owner's app_user, whose UNIQUE(auth_user_id) would otherwise make
    //         every future attempt fail at step 5.
    if (!meta.tenantId && meta.pendingTenantId) {
      const pendingId = meta.pendingTenantId;
      const { data: pendingTenant } = await supabase
        .from("tenants")
        .select("id, slug, company_name")
        .eq("id", pendingId)
        .maybeSingle();

      if (!pendingTenant) {
        console.warn(`${LOG} pendingTenantId ${pendingId} has no tenant row — clearing`);
        meta = await writeSignupMeta(supabase, authUserId, { pendingTenantId: null });
      } else {
        const { data: linkedSub } = await supabase
          .from("tenant_subscriptions")
          .select("id")
          .eq("tenant_id", pendingId)
          .limit(1)
          .maybeSingle();

        if (linkedSub) {
          console.warn(
            `${LOG} recovering tenant ${pendingId} — it is past the point of no return but was never recorded`,
          );
          const portalUrl = meta.portalUrl ?? `https://${pendingTenant.slug}.portal.drive-247.com`;
          const bookingUrl = meta.bookingUrl ?? `https://${pendingTenant.slug}.drive-247.com`;
          meta = await writeSignupMeta(supabase, authUserId, {
            status: "provisioned",
            tenantId: pendingId,
            pendingTenantId: null,
            slug: pendingTenant.slug,
            portalUrl,
            bookingUrl,
            provisionLockAt: null,
            lastError: null,
          });
          return jsonResponse({
            success: true,
            tenantId: pendingId,
            slug: pendingTenant.slug,
            companyName: pendingTenant.company_name ?? meta.business?.companyName ?? "",
            portalUrl,
            bookingUrl,
            portalSignInUrl: meta.portalSignInUrl ?? null,
            // We cannot know whether step 8 ran, and claiming it did would hide
            // a booking site still showing platform copy. The success panel's
            // "some pages still show our default copy" note is the honest answer.
            contentSeeded: false,
            milestones: PROVISION_MILESTONES,
          });
        }

        console.warn(`${LOG} discarding half-built tenant ${pendingId} before retrying`);
        const discardErrors: string[] = [];
        for (
          const step of [
            () => supabase.from("subscription_plans").delete().eq("tenant_id", pendingId),
            () => supabase.from("app_users").delete().eq("auth_user_id", authUserId),
            () => supabase.from("tenants").delete().eq("id", pendingId),
          ]
        ) {
          const { error } = await step();
          if (error) discardErrors.push(error.message ?? String(error));
        }

        if (discardErrors.length) {
          // Leaving `pendingTenantId` set is deliberate: it is the only pointer
          // support has to the row, and a "fresh" run from here would fail at
          // the slug pre-check or on app_users' unique auth_user_id anyway.
          console.error(`${LOG} could not discard tenant ${pendingId}:`, discardErrors);
          // A tenant we could not remove must never be loggable-into or
          // billable — the same guard `deleteTenant` applies on a failed
          // rollback.
          const { error: suspendError } = await supabase
            .from("tenants")
            .update({ status: "suspended" })
            .eq("id", pendingId);
          if (suspendError) {
            console.error(`${LOG} could not suspend tenant ${pendingId}:`, suspendError);
          }
          return signupError(
            "INTERNAL",
            "We couldn't finish setting up your portal. Please talk to us and we'll finish it for you.",
            500,
            { tenantId: pendingId },
          );
        }

        meta = await writeSignupMeta(supabase, authUserId, {
          pendingTenantId: null,
          milestones: [],
        });
      }
    }

    /**
     * Terminal failure. Releases the lock, records the reason so a resume can
     * show it, and returns the machine-readable code the UI branches on.
     * Deliberately does NOT touch anything in Stripe.
     */
    const fail = async (
      code: string,
      message: string,
      status: number,
      detail?: Record<string, unknown>,
    ): Promise<Response> => {
      try {
        await writeSignupMeta(supabase, authUserId, {
          status: "failed",
          provisionLockAt: null,
          lastError: { code, message, at: new Date().toISOString() },
        });
      } catch (e) {
        console.error(`${LOG} could not record failure state (non-fatal):`, e);
      }
      await recordAttempt(supabase, {
        scope: "provision",
        email: meta!.email,
        auth_user_id: authUserId,
        plan_id: meta!.planId,
        outcome: "error",
        error_code: code,
        stripe_customer_id: meta!.stripeCustomerId ?? null,
        stripe_subscription_id: meta!.stripeSubscriptionId ?? null,
        metadata: { message, ...(detail ?? {}) },
      });
      return signupError(code, message, status, detail);
    };

    // =====================================================================
    // 1. Validate + normalise EVERYTHING. Front-loaded, exactly as the sales
    //    path does it: a typo must cost a 400, never a provision-then-rollback.
    // =====================================================================
    if (body.acceptedTerms !== true) {
      return await fail("TERMS_NOT_ACCEPTED", "Please accept the Terms and Privacy Policy", 400, {
        field: "acceptedTerms",
      });
    }

    const companyName = clean(body.companyName, MAX.companyName);
    if (companyName.length < 2) {
      return await fail("VALIDATION_FAILED", "Please enter your business name", 400, {
        field: "companyName",
      });
    }

    // The business form no longer asks for a subdomain — the operator gives us a
    // name and we derive the address. `body.slug` is still honoured when present
    // so an older client (or a future admin-side caller) keeps working, and so
    // that a deploy in which the browser bundle lags this function does not 400
    // every signup.
    let slug: string;
    const requestedSlug = normalizeSlug(clean(body.slug, 100));

    if (requestedSlug) {
      slug = requestedSlug;
      if (
        !/^[a-z][a-z0-9-]*$/.test(slug) ||
        slug.length < 3 ||
        slug.length > 50 ||
        slug.replace(/[^a-z0-9]/g, "").length < 3
      ) {
        return await fail("SLUG_INVALID", "That web address is not valid", 400, {
          field: "slug",
          slug,
        });
      }
      if (isReservedSlug(slug)) {
        return await fail("SLUG_RESERVED", "That web address is reserved", 409, {
          field: "slug",
          slug,
          suggestions: await suggestSlugs(supabase, companyName || slug),
        });
      }
    } else {
      const derived = await deriveSlugFromName(supabase, companyName);
      if (!derived) {
        // Every candidate was illegal or taken. The only thing the operator can
        // act on is their business name, so the error has to point there rather
        // than at a field the form no longer shows.
        return await fail(
          "SLUG_INVALID",
          "We couldn't create a web address from that business name. Try a slightly different name.",
          400,
          { field: "companyName" },
        );
      }
      slug = derived;
      console.log(`${LOG} derived slug "${slug}" from company name "${companyName}"`);
    }

    const location = cleanOrNull(body.location, MAX.location);
    const businessColours = cleanOrNull(body.businessColours, MAX.colours);
    const fleetSize = cleanOrNull(body.fleetSize, MAX.short);
    const vehicleType = cleanOrNull(body.vehicleType, MAX.short);

    // +1 on the cap so an over-long URL OVERFLOWS and is rejected below, rather
    // than being silently truncated into a broken <img src>.
    const logoUrl = clean(body.logoUrl, MAX.url + 1);
    if (logoUrl && (!isHttpUrl(logoUrl) || logoUrl.length > MAX.url)) {
      return await fail("VALIDATION_FAILED", "Logo URL must be a valid http(s) URL", 400, {
        field: "logoUrl",
      });
    }

    const rawPhone = clean(body.businessPhone, MAX.phone);
    const phoneDigits = rawPhone.replace(/\D/g, "");
    if (rawPhone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      return await fail("VALIDATION_FAILED", "Business phone must have 7 to 15 digits", 400, {
        field: "businessPhone",
      });
    }
    const phoneDisplay = rawPhone || null;
    const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;

    // Structured schedule first (nothing to interpret), free text as a fallback.
    // scheduleToHourCols RANGE-checks each "HH:MM": an out-of-range value would
    // not merely store nonsense, it would abort the whole tenant INSERT on the
    // Postgres `time` columns.
    const scheduleText = scheduleDisplayText(body.operatingSchedule);
    const hourCols: HourCols =
      scheduleToHourCols(body.operatingSchedule, scheduleText) ??
      parseOperatingHours(scheduleText);
    const businessHours = (hourCols.business_hours as string | null) ?? null;

    // Company-name uniqueness is DELIBERATELY not enforced here, unlike the
    // sales path which 409s on it. On a public form that is a permanent dead
    // end — a second "Elite Motors" could never sign up at all. The slug is the
    // real unique key; the duplicate is logged for support instead.
    let duplicateName = false;
    try {
      const { data: nameMatches } = await supabase
        .from("tenants")
        .select("id, company_name")
        .ilike("company_name", companyName);
      duplicateName = (nameMatches || []).some(
        (t: { company_name: string | null }) =>
          (t.company_name || "").trim().toLowerCase() === companyName.toLowerCase(),
      );
      if (duplicateName) {
        console.warn(`${LOG} company name "${companyName}" is already used by another tenant — allowed, slug "${slug}" disambiguates`);
      }
    } catch (e) {
      console.warn(`${LOG} duplicate-name probe failed (non-fatal):`, e);
    }

    // Pre-check the slug. This is advisory — the 23505 catch on the INSERT is
    // what actually closes the race — but it turns the common case into a fast
    // 409 with suggestions instead of a rollback.
    const { data: slugTaken } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (slugTaken) {
      return await fail("SLUG_TAKEN", "That web address is already taken", 409, {
        field: "slug",
        slug,
        suggestions: await suggestSlugs(supabase, slug),
      });
    }

    const businessSnapshot: SignupBusinessSnapshot = {
      companyName,
      slug,
      ...(location ? { location } : {}),
      ...(phoneDisplay ? { businessPhone: phoneDisplay } : {}),
      ...(fleetSize ? { fleetSize } : {}),
      ...(vehicleType ? { vehicleType } : {}),
      ...(businessColours ? { businessColours } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(body.operatingSchedule ? { operatingSchedule: body.operatingSchedule } : {}),
    };
    // Persisted BEFORE any writes so a failure at any later step still restores
    // the user's form on resume.
    meta = await writeSignupMeta(supabase, authUserId, { business: businessSnapshot });
    await markMilestone(supabase, authUserId, "validated");

    // =====================================================================
    // 2. Verify the payment against STRIPE. Never against app_metadata.
    // =====================================================================
    const plan = getSignupPlan(meta.planId);
    if (!plan) return await fail("PLAN_UNKNOWN", "Unknown plan", 400);

    // Fleet size against the plan's allowance.
    //
    // The browser checks this too, purely so it can name the plan that WOULD
    // fit. This is the check that enforces it: the form is a public surface and
    // the number arrives in the request body, so a client-side rule alone would
    // let anyone provision a 500-vehicle operation on the $99 tier.
    //
    // Only enforced when a parseable count is supplied. `fleetSize` used to be a
    // free-text band ("11–25 vehicles") and older in-flight signups may still
    // carry one; rejecting those would strand a customer who has already paid.
    if (fleetSize) {
      const vehicles = Number.parseInt(String(fleetSize).replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(vehicles) && vehicles > 0 && vehicles > plan.maxVehicles) {
        return await fail(
          "VALIDATION_FAILED",
          `${plan.name} covers up to ${plan.maxVehicles} vehicles. You entered ${vehicles}.`,
          400,
          { field: "fleetSize", maxVehicles: plan.maxVehicles, entered: vehicles },
        );
      }
    }

    const mode = meta.mode ?? getSignupStripeMode();
    let stripe;
    try {
      stripe = getSignupStripeClient(mode);
    } catch (e) {
      if (e instanceof SignupConfigError) {
        console.error(`${LOG} CONFIG_MISSING: ${e.env} is not set`);
        return await fail("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, {
          env: e.env,
        });
      }
      throw e;
    }

    if (!meta.stripeSubscriptionId) {
      return await fail("PAYMENT_REQUIRED", "No payment has been made for this signup", 402);
    }

    let subscription: any;
    try {
      subscription = await stripe.subscriptions.retrieve(meta.stripeSubscriptionId, {
        expand: ["latest_invoice.payment_intent", "default_payment_method"],
      });
    } catch (e) {
      console.error(`${LOG} could not retrieve subscription ${meta.stripeSubscriptionId}:`, e);
      return await fail("STRIPE_UNAVAILABLE", "We couldn't reach our payment provider", 502);
    }

    // Ownership. `stripeSubscriptionId` came from the caller's OWN
    // service-role-written metadata and can't be supplied by the client, but
    // asserting the Stripe-side link too means a crafted or corrupted id can
    // never be turned into someone else's paid subscription.
    if (subscription.metadata?.d247_signup_auth_user !== authUserId) {
      console.error(
        `${LOG} subscription ${subscription.id} belongs to ${subscription.metadata?.d247_signup_auth_user}, not ${authUserId}`,
      );
      return await fail("PAYMENT_REQUIRED", "We couldn't verify your payment", 402);
    }

    if (!PAID_STATUSES.has(subscription.status)) {
      if (subscription.status === "incomplete_expired" || subscription.status === "canceled") {
        return await fail(
          "PAYMENT_EXPIRED",
          "That payment attempt expired before it completed",
          402,
        );
      }
      return await fail("PAYMENT_INCOMPLETE", "Your payment has not completed yet", 402);
    }

    await markMilestone(supabase, authUserId, "payment_verified");

    // =====================================================================
    // 3. Brand palette. extractBrandColorsFromText never throws — it falls back
    //    to a word/hex palette and then to the platform default — so branding
    //    can never block a paid provision.
    // =====================================================================
    const colors = await extractBrandColorsFromText(businessColours, null);
    const palette = buildTenantPalette(colors);
    await markMilestone(supabase, authUserId, "brand_ready");

    // =====================================================================
    // Rollback bookkeeping for steps 4–6.
    //
    // Nothing in Stripe points at the tenant until step 7c, so a rollback here
    // is CLEAN: the subscription simply stays unlinked and the retry re-uses
    // it. Each cleanup records whether it actually landed, so a partial
    // rollback is reported instead of silently leaving an orphan.
    // =====================================================================
    const orphans: string[] = [];
    let tenantId: string | null = null;
    let appUserId: string | null = null;
    let planRowId: string | null = null;

    const rollbackNote = () =>
      orphans.length ? ` | MANUAL CLEANUP REQUIRED: ${orphans.join(", ")}` : "";

    const deleteTenant = async () => {
      if (!tenantId) return;
      try {
        const { error } = await supabase.from("tenants").delete().eq("id", tenantId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete tenant ${tenantId} failed:`, e);
        orphans.push(`tenant ${tenantId} (${slug})`);
        // A tenant we could not delete must never be loggable-into or billable.
        try {
          await supabase.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
        } catch (e2) {
          console.error(`${LOG} rollback: could not suspend tenant ${tenantId}:`, e2);
        }
      }
    };

    const deleteAppUser = async () => {
      if (!appUserId) return;
      try {
        const { error } = await supabase.from("app_users").delete().eq("id", appUserId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete app_user ${appUserId} failed:`, e);
        orphans.push(`app_user ${appUserId}`);
      }
    };

    const deletePlanRow = async () => {
      if (!planRowId) return;
      try {
        const { error } = await supabase.from("subscription_plans").delete().eq("id", planRowId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete subscription_plan ${planRowId} failed:`, e);
        orphans.push(`subscription_plan ${planRowId}`);
      }
    };

    /** Undo steps 4–6. The auth user and every Stripe object are left alone. */
    const rollback = async () => {
      await deletePlanRow();
      await deleteAppUser();
      await deleteTenant();
      // Drop the pointer too, so the next attempt is genuinely fresh rather
      // than running step 0's recovery against a row that is already gone. It
      // matters most when `deleteTenant` could only SUSPEND the row: leaving
      // the pointer would make the retry adopt a suspended tenant, whereas
      // clearing it produces an honest SLUG_TAKEN with alternatives.
      try {
        await writeSignupMeta(supabase, authUserId, { pendingTenantId: null });
      } catch (e) {
        console.error(`${LOG} rollback: could not clear pendingTenantId (non-fatal):`, e);
      }
    };

    // =====================================================================
    // 4. Tenant.
    // =====================================================================
    const portalUrl = `https://${slug}.portal.drive-247.com`;
    const bookingUrl = `https://${slug}.drive-247.com`;
    const isProduction = mode === "live";

    // stripe_mode (booking payments) and bonzah_mode stay on their 'test' DB
    // defaults for BOTH tenant types on purpose — live Stripe Connect and live
    // Bonzah each need per-tenant onboarding that has not happened yet, so
    // flipping them here would break checkout on day one. The operator turns
    // them on from Portal → Settings.
    //
    // subscription_account MUST be 'uae': that is the account this signup's
    // Price, Customer and Subscription were all created on.
    const modeCols = isProduction
      ? {
        boldsign_mode: "live",
        subscription_stripe_mode: "live",
        subscription_account: SIGNUP_STRIPE_ACCOUNT,
      }
      : {
        boldsign_mode: "test",
        subscription_stripe_mode: "test",
        subscription_account: SIGNUP_STRIPE_ACCOUNT,
      };

    // favicon included: without it the operator's browser tab keeps our icon.
    const logoCols = logoUrl
      ? { logo_url: logoUrl, dark_logo_url: logoUrl, auth_logo_url: logoUrl, favicon_url: logoUrl }
      : {};

    // WITHOUT these the tenant inherits the platform defaults — tenants.app_name
    // DEFAULTs to the literal 'Drive 917', which the portal sidebar, login and
    // <title> render verbatim (it is not NULL, so the `app_name || company_name`
    // fallbacks never fire).
    const identityCols = {
      app_name: companyName,
      admin_email: meta.email,
      phone: phoneE164,
      meta_title: location
        ? `${companyName} — Car Rentals in ${location}`
        : `${companyName} — Car Rentals`,
      meta_description: location
        ? `Car rental services from ${companyName} in ${location}.`
        : `Car rental services from ${companyName}.`,
    };

    // Only set the timezone when we could actually work it out; otherwise the
    // column default stands rather than us guessing wrong.
    const derivedTimezone = deriveTimezone(location);
    const tzCols = derivedTimezone ? { timezone: derivedTimezone } : {};

    // The owner's given name, for `tenants.admin_name`. First token only — the
    // column is a display name, not a full legal name.
    const firstName = meta.fullName.split(/\s+/)[0] || meta.fullName;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        company_name: companyName,
        admin_name: firstName,
        slug,
        contact_email: meta.email,
        contact_phone: phoneDisplay,
        address: location,
        business_hours: businessHours,
        status: "active",
        tenant_type: isProduction ? "production" : "test",
        ...identityCols,
        ...palette,
        ...logoCols,
        ...modeCols,
        ...hourCols,
        ...tzCols,
      })
      .select("id")
      .single();

    if (tenantError || !tenant) {
      console.error(`${LOG} tenant insert failed:`, tenantError);
      // Closes the check-then-insert race: two people who both passed the
      // pre-check a moment ago, and only tenants_slug_key stops the second.
      if (isUniqueViolation(tenantError)) {
        return await fail("SLUG_TAKEN", "That web address is already taken", 409, {
          field: "slug",
          slug,
          suggestions: await suggestSlugs(supabase, slug),
        });
      }
      return await fail("INTERNAL", "We couldn't create your workspace", 500);
    }
    tenantId = tenant.id as string;

    /*
     * Record the row's existence IMMEDIATELY — before the credits RPC, before
     * the owner account, before anything.
     *
     * Everything from here to step 9 is network-heavy (two Stripe calls with a
     * retry, ~10 CMS writes, an optional magic link) and an edge function can
     * be killed at any point in it. Until this write lands, a killed isolate
     * leaves a tenant NOTHING points at: the retry starts from scratch, the
     * slug pre-check finds the row the user themselves just created, and they
     * get "that web address is already taken" for their own address — for ever,
     * with the card already charged.
     *
     * It goes into `pendingTenantId`, not `tenantId`: at this instant the
     * tenant has no owner account and no subscription row, so it is NOT safe to
     * hand over. Step 0 decides what to do with it on the next attempt.
     *
     * A failure here is fatal on purpose. Continuing would recreate exactly the
     * unrecoverable state this write exists to prevent, and rolling back now is
     * clean: nothing references the tenant yet.
     */
    try {
      meta = await writeSignupMeta(supabase, authUserId, {
        pendingTenantId: tenantId,
        slug,
        portalUrl,
        bookingUrl,
      });
    } catch (e) {
      console.error(`${LOG} could not record tenant ${tenantId} in app_metadata:`, e);
      await rollback();
      return await fail("INTERNAL", `We couldn't create your workspace${rollbackNote()}`, 500);
    }

    // 100 live welcome credits. Non-fatal: a tenant without credits works, a
    // rollback over a gift does not.
    try {
      const { error: creditError } = await supabase.rpc("add_credits", {
        p_tenant_id: tenantId,
        p_amount: 100,
        p_type: "gift",
        p_description: "Welcome bonus: 100 live credits",
        p_is_test_mode: false,
      });
      if (creditError) console.error(`${LOG} add_credits failed (non-fatal):`, creditError);
    } catch (e) {
      console.error(`${LOG} add_credits threw (non-fatal):`, e);
    }

    await markMilestone(supabase, authUserId, "workspace_created");

    // =====================================================================
    // 5. Owner account.
    //
    // `must_change_password: false` — unlike the sales path, this password was
    // chosen by the operator ninety seconds ago. Forcing a change would be a
    // pointless speed bump on their very first login.
    // =====================================================================
    const { data: appUser, error: appUserError } = await supabase
      .from("app_users")
      .insert({
        auth_user_id: authUserId,
        email: meta.email,
        name: meta.fullName,
        role: "head_admin",
        is_active: true,
        must_change_password: false,
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (appUserError || !appUser) {
      console.error(`${LOG} app_users insert failed:`, appUserError);
      await rollback();
      return await fail("INTERNAL", `We couldn't set up your owner account${rollbackNote()}`, 500);
    }
    appUserId = appUser.id as string;
    await markMilestone(supabase, authUserId, "account_linked");

    // =====================================================================
    // 6. Subscription plan row.
    //
    // The Price is resolved by lookup_key, so every self-serve tenant on this
    // plan shares ONE Stripe Price — we never spawn a Product/Price per signup
    // the way create-sales-onboarding does. It is created on 'uae', matching
    // tenants.subscription_account.
    // =====================================================================
    try {
      const { priceId, productId } = await getOrCreateSignupPrice(stripe, plan, mode);

      const { data: planRow, error: planError } = await supabase
        .from("subscription_plans")
        .insert({
          tenant_id: tenantId,
          name: plan.name,
          description: plan.tagline,
          features: plan.features,
          amount: plan.amountCents,
          currency: plan.currency,
          interval: plan.interval,
          stripe_price_id: priceId,
          stripe_product_id: productId,
          stripe_account: SIGNUP_STRIPE_ACCOUNT,
          trial_days: 0,
          billing_model: "trial",
          is_active: true,
          sort_order: 0,
        })
        .select("id")
        .single();

      if (planError || !planRow) throw planError ?? new Error("no plan row returned");
      planRowId = planRow.id as string;
    } catch (e) {
      console.error(`${LOG} subscription plan creation failed:`, e);
      await rollback();
      return await fail("INTERNAL", `We couldn't set up your billing${rollbackNote()}`, 500);
    }
    await markMilestone(supabase, authUserId, "billing_ready");

    // =====================================================================
    // 7. Link the paid Stripe subscription to the new tenant.
    //
    // ORDER IS LOAD-BEARING. See the header of signup-payment-intent for why
    // the Stripe objects carry no tenant_id until 7c.
    //
    // This function writes tenant_subscriptions DIRECTLY with the service role,
    // which is a deliberate, documented exception to "subscription-webhook is
    // the only writer of subscription state". The webhook CANNOT write it: the
    // tenant did not exist when the money moved, so every event for this
    // subscription was correctly no-opped.
    // =====================================================================

    // ---- 7a. tenant_subscriptions. HARD FAIL. ----------------------------
    // This row is what the portal's `isSubscribed` reads. Without it a paying
    // owner walks straight into the subscription paywall on first login — so a
    // failure here rolls steps 4–6 back and lets them retry cleanly, rather
    // than handing them a tenant they cannot use.
    const card = await resolveCard(stripe, subscription);
    const { data: subRow, error: subError } = await supabase
      .from("tenant_subscriptions")
      .upsert(
        {
          tenant_id: tenantId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: subscription.customer as string,
          status: subscription.status,
          plan_name: plan.name,
          plan_id: planRowId,
          amount: subscription.items?.data?.[0]?.price?.unit_amount ?? plan.amountCents,
          currency: subscription.currency ?? plan.currency,
          interval: subscription.items?.data?.[0]?.price?.recurring?.interval ?? plan.interval,
          ...periodPatch(resolveSubscriptionPeriod(subscription)),
          // Omitted rather than nulled when unresolvable — this is an upsert,
          // and writing nulls would wipe a card we had already recorded.
          ...(card
            ? {
              card_brand: card.brand ?? null,
              card_last4: card.last4 ?? null,
              card_exp_month: card.exp_month ?? null,
              card_exp_year: card.exp_year ?? null,
            }
            : {}),
          trial_end: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : null,
          stripe_account: SIGNUP_STRIPE_ACCOUNT,
          last_synced_at: new Date().toISOString(),
          last_sync_source: "backfill",
        },
        { onConflict: "stripe_subscription_id" },
      )
      .select("id")
      .single();

    if (subError || !subRow) {
      console.error(`${LOG} tenant_subscriptions upsert failed:`, subError);
      await rollback();
      return await fail(
        "INTERNAL",
        `We couldn't activate your subscription${rollbackNote()}`,
        500,
      );
    }
    const subscriptionRowId = subRow.id as string;

    // ===== POINT OF NO RETURN FOR THE TENANT ROW ==========================
    // tenant_subscriptions now references this tenant. From here on the tenant
    // is NEVER deleted: every remaining step is recoverable by hand or by
    // reconcile-subscriptions, and deleting a tenant that a live subscription
    // points at would be far worse than any of them failing.
    // ======================================================================

    /*
     * Promote `pendingTenantId` to `tenantId` HERE, not at step 9.
     *
     * This is the exact moment the tenant becomes safe to hand over: owner
     * account, plan row and subscription row all exist, and every step that
     * follows is documented non-fatal. Everything after this point is also the
     * slowest, most network-heavy stretch of the function, so it is where a
     * killed isolate is most likely to land.
     *
     * If this write itself throws, the outer catch 500s and the retry's step-0
     * recovery finds `pendingTenantId` WITH a linked subscription row and
     * promotes it there instead — so the failure mode is self-healing rather
     * than terminal.
     */
    meta = await writeSignupMeta(supabase, authUserId, {
      tenantId,
      pendingTenantId: null,
      slug,
      portalUrl,
      bookingUrl,
    });

    // ---- 7b. Customer id on the tenant. Non-fatal. -----------------------
    // This is resolver step 1 for invoice.paid / invoice.payment_failed, and it
    // is what lets reconcile-subscriptions find this tenant later.
    {
      const { error } = await supabase
        .from("tenants")
        .update({
          stripe_subscription_customer_id: subscription.customer as string,
          subscription_plan: plan.name,
        })
        .eq("id", tenantId);
      if (error) {
        console.error(
          `${LOG} could not set stripe_subscription_customer_id on tenant ${tenantId} — invoice webhooks will fall back to the subscription resolver:`,
          error,
        );
      }
    }

    // ---- 7c. Attach tenant_id to the Stripe objects. Non-fatal. ----------
    // Without this, customer.subscription.updated will not sync status changes
    // for this tenant. Retried once, then left to reconcile-subscriptions
    // (which finds the tenant via 7a + 7b).
    const attachTenantId = async () => {
      await stripe.subscriptions.update(subscription.id, {
        metadata: {
          ...(subscription.metadata ?? {}),
          d247_signup: "provisioned",
          tenant_id: tenantId!,
          plan_id: planRowId!,
          plan_name: plan.name,
        },
      });
      await stripe.customers.update(subscription.customer as string, {
        metadata: { d247_signup_auth_user: authUserId, tenant_id: tenantId! },
      });
    };
    try {
      await attachTenantId();
    } catch (e) {
      console.warn(`${LOG} attaching tenant_id to Stripe failed, retrying once:`, e);
      try {
        await attachTenantId();
      } catch (e2) {
        console.error(
          `${LOG} could not attach tenant_id to Stripe objects for tenant ${tenantId} — subscription webhooks will no-op until reconcile-subscriptions runs:`,
          e2,
        );
      }
    }

    // ---- 7d. Backfill the first invoice. Non-fatal. ----------------------
    // The `invoice.paid` for this subscription was deliberately dropped by the
    // webhook (no tenant_id existed yet), so without this the operator's very
    // first invoice would be missing from Portal → Settings → Subscription
    // until reconcile-subscriptions re-lists it.
    try {
      const invoice: any = subscription.latest_invoice;
      if (invoice?.id) {
        const { error } = await supabase.from("tenant_subscription_invoices").upsert(
          {
            tenant_id: tenantId,
            subscription_id: subscriptionRowId,
            stripe_invoice_id: invoice.id,
            stripe_invoice_pdf: invoice.invoice_pdf || null,
            stripe_hosted_invoice_url: invoice.hosted_invoice_url || null,
            // Stripe's own status, mapped into the CHECK constraint's set.
            status: invoice.status === "paid" ? "paid" : invoice.status === "open" ? "open" : "draft",
            amount_due: invoice.amount_due || 0,
            amount_paid: invoice.amount_paid || 0,
            currency: invoice.currency || plan.currency,
            period_start: invoice.period_start
              ? new Date(invoice.period_start * 1000).toISOString()
              : null,
            period_end: invoice.period_end
              ? new Date(invoice.period_end * 1000).toISOString()
              : null,
            paid_at: invoice.status === "paid" ? new Date().toISOString() : null,
            invoice_number: invoice.number || null,
            billing_reason: invoice.billing_reason || null,
          },
          { onConflict: "stripe_invoice_id" },
        );
        if (error) throw error;
      }
    } catch (e) {
      console.error(
        `${LOG} first-invoice backfill failed for tenant ${tenantId} (non-fatal) — run reconcile-subscriptions to recover it:`,
        e,
      );
    }

    await markMilestone(supabase, authUserId, "subscription_linked");

    // =====================================================================
    // 8. Booking-site content.
    //
    // Non-fatal, but LOUD. The seed_cms_pages_for_tenant trigger creates ten
    // EMPTY draft shells, and the booking site only reads PUBLISHED pages — so
    // an unseeded tenant's site falls through to the app's hard-coded defaults,
    // which are Drive247's own phone number, email and copy under the
    // operator's name. Recoverable from Portal → Website; rolling back a fully
    // paid tenant over it is not.
    // =====================================================================
    let contentSeeded = false;
    try {
      const { pages, sections, missing } = await seedTenantCmsContent(
        supabase,
        tenantId,
        buildCmsContent({
          name: companyName,
          location,
          phoneHref: phoneE164 || "",
          phoneLabel: phoneDisplay || "",
          email: meta.email,
          hours: businessHours || "",
          logoUrl: logoUrl || "",
          year: new Date().getFullYear(),
          today: new Date().toISOString().split("T")[0],
        }),
      );
      // Only claim success when the pages carrying customer-facing copy landed,
      // home page included — writing five site-settings sections while every
      // real page was skipped is not a seeded site.
      contentSeeded = sections > 0 && !missing.includes("home") && missing.length === 0;
      console.log(`${LOG} CMS: published ${sections} sections across ${pages} pages for ${slug}`);
      if (missing.length) {
        console.error(
          `${LOG} CMS: no page shell for [${missing.join(", ")}] on ${slug} — those pages still render platform defaults`,
        );
      }
    } catch (e) {
      console.error(`${LOG} CMS content seeding failed (non-fatal) for ${slug}:`, e);
    }
    await markMilestone(supabase, authUserId, "site_published");

    // =====================================================================
    // 9. Optional magic link, final state, unlock.
    // =====================================================================
    let portalSignInUrl: string | null = null;
    if (Deno.env.get("SIGNUP_PORTAL_MAGICLINK") === "true") {
      try {
        const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: meta.email,
          options: { redirectTo: `${portalUrl}/login` },
        });
        if (linkError) throw linkError;
        portalSignInUrl = link?.properties?.action_link ?? null;
      } catch (e) {
        // Needs https://*.portal.drive-247.com/** in the Supabase Auth redirect
        // allow-list, which lives outside this repo. Without it the link is
        // rejected as otp_expired — so falling back to /login?email= is the
        // safe default and produces NO user-visible difference.
        console.warn(`${LOG} magic link generation failed — falling back to /login?email=:`, e);
        portalSignInUrl = null;
      }
    }

    await writeSignupMeta(supabase, authUserId, {
      status: "provisioned",
      tenantId,
      slug,
      portalUrl,
      bookingUrl,
      portalSignInUrl,
      contentSeeded,
      provisionLockAt: null,
      lastError: null,
    });

    await recordAttempt(supabase, {
      scope: "provision",
      email: meta.email,
      auth_user_id: authUserId,
      plan_id: plan.id,
      outcome: "ok",
      stripe_customer_id: (subscription.customer as string) ?? null,
      stripe_subscription_id: subscription.id,
      tenant_id: tenantId,
      metadata: { slug, mode, contentSeeded, duplicateName, fleetSize, vehicleType },
    });

    console.log(
      `${LOG} provisioned tenant ${tenantId} (${slug}) for ${meta.email} on ${plan.id}/${mode}`,
    );

    /**
     * Welcome email carrying the addresses we just minted.
     *
     * This became REQUIRED, not a nicety, the moment the business form stopped
     * asking the operator to choose their own subdomain: they now learn their
     * web address for the first time on the success screen, and a closed tab or
     * a dead laptop battery would otherwise leave a paying customer with no way
     * to find the portal they just bought.
     *
     * Fire-and-forget and wrapped: the tenant is fully provisioned by this
     * point, and a Resend outage must not turn a completed signup into an error
     * the client will retry. A failure is logged for support to pick up.
     */
    try {
      const emailHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0f172a">
  <h1 style="font-size:22px;font-weight:600;margin:0 0 8px">Your Drive247 portal is ready</h1>
  <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px">
    ${escapeHtml(companyName)} is set up on the ${escapeHtml(plan.name)} plan. Here is everything you need.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:10px 0;color:#64748b;width:130px">Your portal</td>
        <td style="padding:10px 0"><a href="${portalUrl}" style="color:#4f46e5;font-weight:600">${portalUrl}</a></td></tr>
    <tr><td style="padding:10px 0;color:#64748b">Booking site</td>
        <td style="padding:10px 0"><a href="${bookingUrl}" style="color:#4f46e5;font-weight:600">${bookingUrl}</a></td></tr>
    <tr><td style="padding:10px 0;color:#64748b">Sign in as</td>
        <td style="padding:10px 0"><strong>${escapeHtml(meta.email)}</strong></td></tr>
  </table>
  <p style="font-size:13px;line-height:1.6;color:#64748b;margin:24px 0 0">
    Sign in with the password you chose during signup. Your web address is fixed
    and cannot be changed later, so keep this email.
  </p>
</div>`;
      const sent = await sendResendEmail({
        to: meta.email,
        subject: `Your Drive247 portal is ready — ${companyName}`,
        html: emailHtml,
      });
      if (!sent?.success) {
        console.error(`${LOG} welcome email failed for ${meta.email}:`, sent?.error);
      }
    } catch (e) {
      console.error(`${LOG} welcome email threw for ${meta.email} (non-fatal):`, e);
    }

    return jsonResponse({
      success: true,
      tenantId,
      slug,
      companyName,
      portalUrl,
      bookingUrl,
      portalSignInUrl,
      contentSeeded,
      milestones: PROVISION_MILESTONES,
    });
  } catch (error) {
    // Last resort. The lock is released on a best-effort basis so a crash does
    // not block the retry for two minutes.
    console.error(`${LOG} unexpected error:`, error);
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) {
          await writeSignupMeta(supabase, user.id, {
            status: "failed",
            provisionLockAt: null,
            lastError: {
              code: "INTERNAL",
              message: (error as Error)?.message || "Internal server error",
              at: new Date().toISOString(),
            },
          });
        }
      }
    } catch (e) {
      console.error(`${LOG} could not release the provisioning lock:`, e);
    }
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
