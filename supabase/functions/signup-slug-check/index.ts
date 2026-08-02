// =============================================================================
// signup-slug-check — live availability for the web-address field.
//
// The slug is the single most consequential thing the operator types: it
// becomes {slug}.drive-247.com AND {slug}.portal.drive-247.com, and nothing in
// the platform renames a tenant slug afterwards. So it is checked live, with
// suggestions, rather than failing at the end of a paid signup.
//
// This endpoint is advisory only. `signup-provision` re-runs every one of these
// checks and additionally relies on the tenants_slug_key unique index to close
// the check-then-insert race — two people can pass this check on the same slug
// in the same second.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  checkThrottle,
  clientIp,
  readSignupMeta,
  recordAttempt,
  signupError,
} from "../_shared/signup-state.ts";
import {
  clean,
  isReservedSlug,
  MAX,
  normalizeSlug,
  suggestSlugs,
} from "../_shared/tenant-provisioning.ts";

const LOG = "[signup-slug-check]";
const HOUR_MS = 60 * 60 * 1000;

/**
 * Shape checks that mirror create-sales-onboarding exactly: start with a
 * letter, 3–50 characters, `[a-z0-9-]` only. Anything else is not a legal DNS
 * label and the hostname would never resolve.
 */
function slugShapeError(slug: string): boolean {
  return !/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 3 || slug.length > 50;
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

    // Only a user with a signup in flight may enumerate slugs. Without this,
    // any anon-key holder who can mint a session could probe every tenant
    // slug on the platform.
    const meta = readSignupMeta(user);
    if (!meta) return signupError("SIGNUP_NOT_FOUND", "No signup in progress", 404);

    let body: { slug?: string; companyName?: string };
    try {
      body = await req.json();
    } catch {
      return signupError("INVALID_BODY", "Invalid JSON body", 400);
    }

    // The field is debounced at 450 ms, so a real user types well under this.
    const allowed = await checkThrottle(supabase, [
      { scope: "signup_slug_check", key: user.id, limit: 60, windowMs: HOUR_MS },
    ]);
    await recordAttempt(supabase, {
      scope: "slug_check",
      ip_address: clientIp(req),
      email: meta.email,
      auth_user_id: user.id,
      outcome: allowed ? "allowed" : "blocked",
      throttleScope: "signup_slug_check",
      throttleKey: user.id,
    });
    if (!allowed) {
      return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
    }

    const companyName = clean(body?.companyName, MAX.companyName);
    const slug = normalizeSlug(clean(body?.slug, 100));

    // Every failure body carries the SlugCheckResult fields at the top level as
    // well as in `detail`, so the client can render the inline state straight
    // from the response without reconstructing it from the error code.
    const fail = (code: string, reason: "invalid" | "reserved" | "taken", status: number, suggestions: string[]) =>
      jsonResponse(
        {
          error: reason === "taken"
            ? "That web address is already taken"
            : reason === "reserved"
            ? "That web address is reserved"
            : "That web address is not valid",
          code,
          slug,
          available: false,
          reason,
          suggestions,
          detail: { slug, reason, suggestions, field: "slug" },
        },
        status,
      );

    if (slugShapeError(slug)) {
      // The NORMALISED slug is echoed back so the field can self-correct — the
      // user typed "Acme Rentals!!" and gets to see "acme-rentals".
      return fail("SLUG_INVALID", "invalid", 400, []);
    }
    // Matches the sales path: the derived-password rule is gone, but a slug of
    // "a-b-c" is still a hostname nobody can say out loud.
    if (slug.replace(/[^a-z0-9]/g, "").length < 3) {
      return fail("SLUG_INVALID", "invalid", 400, []);
    }

    if (isReservedSlug(slug)) {
      return fail(
        "SLUG_RESERVED",
        "reserved",
        409,
        await suggestSlugs(supabase, companyName || slug),
      );
    }

    const { data: existing, error: lookupError } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      return fail("SLUG_TAKEN", "taken", 409, await suggestSlugs(supabase, slug));
    }

    return jsonResponse({
      success: true,
      slug,
      available: true,
      reason: "ok",
      suggestions: [],
    });
  } catch (error) {
    console.error(`${LOG} unexpected error:`, error);
    return signupError("INTERNAL", (error as Error)?.message || "Internal server error", 500);
  }
});
