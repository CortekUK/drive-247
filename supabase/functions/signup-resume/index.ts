// =============================================================================
// signup-resume — "where was I?"
//
// Called once when the dialog opens on a browser that already holds a session,
// and again the moment a payment is confirmed. It is the ONLY authority on
// which step the user belongs on, because it is the only place that asks
// STRIPE whether the money actually moved.
//
// `app_metadata.d247_signup` is a resumable hint. It is service-role-only, so
// the user cannot forge it — but it can still be STALE (a card confirmed in a
// tab that then crashed, a subscription that expired overnight). Money state is
// therefore re-read from Stripe on every call and written back.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  getSignupStripeClient,
  getSignupStripeMode,
  SignupConfigError,
} from "../_shared/signup-stripe.ts";
import {
  PROVISION_LOCK_MS,
  readSignupMeta,
  signupError,
  writeSignupMeta,
  type SignupMetadata,
} from "../_shared/signup-state.ts";

const LOG = "[signup-resume]";

/** Stripe statuses that mean the platform has been paid for this period. */
const PAID_STATUSES = new Set(["active", "trialing"]);

/** The business draft, in the exact shape signup-provision accepts back. */
function businessDto(meta: SignupMetadata) {
  const b = meta.business;
  if (!b) return null;
  return {
    companyName: b.companyName,
    slug: b.slug,
    location: b.location,
    businessPhone: b.businessPhone,
    fleetSize: b.fleetSize,
    vehicleType: b.vehicleType,
    businessColours: b.businessColours,
    logoUrl: b.logoUrl,
    operatingSchedule: b.operatingSchedule,
    // The user ticked this to get here; it is re-asserted on submit anyway.
    acceptedTerms: true,
  };
}

function provisionedResult(meta: SignupMetadata) {
  if (!meta.tenantId || !meta.slug) return null;
  return {
    success: true as const,
    tenantId: meta.tenantId,
    slug: meta.slug,
    companyName: meta.business?.companyName ?? "",
    portalUrl: meta.portalUrl ?? `https://${meta.slug}.portal.drive-247.com`,
    bookingUrl: meta.bookingUrl ?? `https://${meta.slug}.drive-247.com`,
    portalSignInUrl: meta.portalSignInUrl ?? null,
    contentSeeded: meta.contentSeeded !== false,
    milestones: meta.milestones ?? [],
  };
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
    // verify_jwt = true only proves SOME project JWT was presented — the anon
    // key qualifies. getUser() is the real gate.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return signupError("UNAUTHENTICATED", "Missing authorization header", 401);
    }
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return signupError("UNAUTHENTICATED", "Unauthorized", 401);
    }

    const meta = readSignupMeta(user);
    // Not an error: a signed-in visitor with no signup blob (e.g. someone who
    // finished months ago on another machine) just has nothing to resume.
    if (!meta) return jsonResponse({ success: true, signup: null });

    // Terminal. Never re-hit Stripe for a finished signup.
    if (meta.status === "provisioned") {
      return jsonResponse({
        success: true,
        signup: {
          planId: meta.planId,
          fullName: meta.fullName,
          email: meta.email,
          paid: true,
          stripeCustomerId: meta.stripeCustomerId ?? null,
          stripeSubscriptionId: meta.stripeSubscriptionId ?? null,
          mode: meta.mode,
          resumeStep: "done",
          business: businessDto(meta),
          milestones: meta.milestones ?? [],
          result: provisionedResult(meta),
          lastError: null,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Money truth.
    // -----------------------------------------------------------------------
    const mode = meta.mode ?? getSignupStripeMode();
    let paid = false;
    let stripeStatus: string | null = null;

    if (meta.stripeSubscriptionId) {
      let stripe;
      try {
        stripe = getSignupStripeClient(mode);
      } catch (e) {
        if (e instanceof SignupConfigError) {
          console.error(`${LOG} CONFIG_MISSING: ${e.env} is not set`);
          return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500, {
            env: e.env,
          });
        }
        throw e;
      }

      try {
        const sub = await stripe.subscriptions.retrieve(meta.stripeSubscriptionId);
        stripeStatus = sub.status;
        paid = PAID_STATUSES.has(sub.status);
      } catch (e) {
        // Deliberately NOT falling back to `meta.status === "paid"`. A resume
        // that guesses at payment sends the user into the business form, where
        // signup-provision would 402 them after they filled it in. A retryable
        // banner now is a better failure than a wasted form later.
        console.error(`${LOG} could not retrieve subscription ${meta.stripeSubscriptionId}:`, e);
        return signupError(
          "STRIPE_UNAVAILABLE",
          "We couldn't reach our payment provider",
          502,
        );
      }
    }

    // Persist what Stripe just told us, but only when it actually changed —
    // a resume poll should not rewrite app_metadata on every open.
    let current = meta;
    if (paid && meta.status !== "paid" && meta.status !== "provisioning") {
      current = await writeSignupMeta(supabase, user.id, {
        status: "paid",
        paidAt: meta.paidAt ?? new Date().toISOString(),
      });
    } else if (!paid && meta.status === "paid") {
      // The subscription lapsed or expired before provisioning. Send them back
      // to a fresh payment attempt rather than letting provision 402 later.
      console.warn(
        `${LOG} subscription ${meta.stripeSubscriptionId} is "${stripeStatus}" but metadata said paid — reverting to payment_pending`,
      );
      current = await writeSignupMeta(supabase, user.id, { status: "payment_pending" });
    }

    // -----------------------------------------------------------------------
    // Which step.
    // -----------------------------------------------------------------------
    let resumeStep: "account" | "payment" | "business" | "provisioning" | "done";
    if (!paid) {
      resumeStep = "payment";
    } else if (
      current.status === "provisioning" &&
      current.provisionLockAt &&
      Date.now() - new Date(current.provisionLockAt).getTime() < PROVISION_LOCK_MS
    ) {
      // A provision is genuinely in flight (another tab, or this one before a
      // refresh). Land on the boot screen and let the milestone poller converge
      // instead of offering a second submit.
      resumeStep = "provisioning";
    } else {
      resumeStep = "business";
    }

    console.log(
      `${LOG} user ${user.id} resumes at "${resumeStep}" (status=${current.status}, stripe=${stripeStatus ?? "none"})`,
    );

    return jsonResponse({
      success: true,
      signup: {
        planId: current.planId,
        fullName: current.fullName,
        email: current.email,
        paid,
        stripeCustomerId: current.stripeCustomerId ?? null,
        stripeSubscriptionId: current.stripeSubscriptionId ?? null,
        mode,
        resumeStep,
        business: businessDto(current),
        milestones: current.milestones ?? [],
        result: null,
        lastError: current.lastError ?? null,
      },
    });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
