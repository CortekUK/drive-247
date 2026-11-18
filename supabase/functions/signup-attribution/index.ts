// =============================================================================
// signup-attribution — saves "How did you hear about us?" for a signed-in signup.
//
// The password path sends the answer with `signup-begin`. Google and Apple
// signups never see that form, so they answer on a short screen straight after
// signing in, and that screen posts here. So does anyone who reaches the card
// step with no answer on record.
//
// The browser cannot write `app_metadata` itself, which is why this is a function.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getSignupStripeClient, getSignupStripeMode } from "../_shared/signup-stripe.ts";
import {
  checkThrottle,
  clientIp,
  readSignupMeta,
  recordAttempt,
  signupError,
  writeSignupMeta,
} from "../_shared/signup-state.ts";
import {
  readSignupAttribution,
  saveSignupAttribution,
  stampStripeCustomer,
} from "../_shared/signup-attribution.ts";

const LOG = "[signup-attribution]";
const HOUR_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error(`${LOG} CONFIG_MISSING`);
    return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500);
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

    const meta = readSignupMeta(user);
    if (!meta) return signupError("SIGNUP_NOT_FOUND", "No signup in progress", 404);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }

    const attribution = readSignupAttribution(body);
    if (!attribution.heardAbout) {
      return signupError("VALIDATION_FAILED", "Please choose an answer", 400, { field: "heardAbout" });
    }

    const rule = { scope: "signup_attribution", key: user.id, limit: 10, windowMs: HOUR_MS };
    const allowed = await checkThrottle(supabase, [rule]);
    await recordAttempt(supabase, {
      scope: "attribution",
      ip_address: clientIp(req),
      email: meta.email,
      auth_user_id: user.id,
      plan_id: meta.planId,
      outcome: allowed ? "allowed" : "blocked",
      throttleScope: rule.scope,
      throttleKey: rule.key,
    });
    if (!allowed) return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);

    await writeSignupMeta(supabase, user.id, {
      heardAbout: attribution.heardAbout,
      heardAboutOther: attribution.heardAboutOther,
      ...(attribution.phone ? { phone: attribution.phone } : {}),
    });

    await saveSignupAttribution(supabase, {
      authUserId: user.id,
      email: meta.email,
      attribution,
      tenantId: meta.tenantId ?? null,
    });

    // Only when the customer already exists. Otherwise the card step stamps it.
    if (meta.stripeCustomerId) {
      try {
        const stripe = getSignupStripeClient(meta.mode ?? getSignupStripeMode());
        await stampStripeCustomer(stripe, meta.stripeCustomerId, attribution);
      } catch (e) {
        console.error(`${LOG} no Stripe client for ${user.id} (non-fatal):`, e);
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", "Internal server error", 500);
  }
});
