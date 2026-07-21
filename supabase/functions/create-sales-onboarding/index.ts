// =============================================================================
// create-sales-onboarding
//
// One-shot super-admin / sales-agent provisioning for George's Sales tab.
// Given a filled onboarding form it:
//   1. verifies the caller (super admin OR sales agent),
//   2. validates + normalises every field BEFORE anything is written,
//   3. guards slug + email uniqueness (fixes a real duplicate-credential bug),
//   4. extracts brand colours from free text -> full tenant palette,
//   5. inserts the tenant with its OWN identity (app_name / meta / hours),
//   6. grants 100 live welcome credits,
//   7. creates the head_admin auth user + app_user,
//   8. creates the live 0-day subscription plan (the hard paywall),
//   9. records the submission (best-effort), and
//  10. returns a ready-to-send client message with the login details.
//
// Everything after the tenant insert is fully rolled back on failure so a
// half-provisioned tenant (or a password that won't work) never reaches George.
//
// Validation is deliberately front-loaded: every check that can fail (slug,
// email, amount, currency, logo URL, phone) runs before the tenant insert so a
// typo costs a 400, never a provision-then-rollback.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { extractBrandColorsFromText, buildTenantPalette } from "../_shared/brand-colors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";

const LOG = "[create-sales-onboarding]";

// Stripe rejects unit_amount outside this range. Guarded up front so a typo
// ("30000" instead of "300") can't cost a full provision + rollback.
const MIN_AMOUNT_CENTS = 50;
const MAX_AMOUNT_CENTS = 99_999_999;

// Field caps — the columns are unbounded `text`, but a 5,000-character company
// name would wreck every downstream email subject, sidebar and <title>.
const MAX = {
  companyName: 100,
  firstName: 60,
  email: 254,
  phone: 40,
  short: 120,
  location: 200,
  colours: 300,
  url: 2048,
  notes: 5000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

/**
 * Trim, strip control characters, collapse runs of whitespace and clip.
 * Unicode is preserved (the columns are `text`) — this only kills the things
 * that break rendering: NULs, tabs, stray newlines and unbounded length.
 */
function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== "string") return "";
  const stripped = multiline
    ? value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ").replace(/[^\S\n]+/g, " ")
    : value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ");
  return stripped.trim().slice(0, max);
}

/** `clean`, but empty becomes null so nullable text columns stay NULL. */
function cleanOrNull(value: unknown, max: number, multiline = false): string | null {
  return clean(value, max, multiline) || null;
}

/**
 * Canonical subdomain form: lowercase, `[a-z0-9-]` only, no repeated hyphens
 * and no leading/trailing hyphen. Those are illegal DNS labels, so a slug like
 * `acme rentals!!` -> `acme-rentals--` would produce a hostname that never
 * resolves. Collapsing hyphens does NOT change the derived password (which is
 * built from the alphanumerics only).
 */
function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only http(s) — a `javascript:`/`data:` "logo" must never reach an <img src>. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Digits plus an optional leading `+`. We deliberately do NOT guess a country
 * code — a wrong prefix silently breaks SMS/WhatsApp delivery later.
 */
function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith("+") ? "+" : "";
  return plus + raw.replace(/\D/g, "");
}

/** Postgres unique_violation — used to close the slug check/insert race. */
function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return err?.code === "23505";
}

// ---------------------------------------------------------------------------
// Operating hours.
//
// George's form captures hours as one free-text line ("Mon–Sat 9am–6pm"), but
// the portal and booking site read the STRUCTURED columns
// ({day}_enabled/_open/_close + working_hours_*). Storing only the free text
// left every sales-onboarded tenant on the platform defaults, so their booking
// site advertised hours they never gave us.
//
// Ported from scripts/tenant-onboarding.mjs `parseHours()` (the canonical
// implementation) and extended with 24-hour times and day-range detection.
// Anything we cannot parse falls back to the tenant defaults rather than
// inventing hours.
// ---------------------------------------------------------------------------
const DAY_KEYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const DAY_ALIASES: Record<string, number> = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4,
  sat: 5, saturday: 5, sun: 6, sunday: 6,
};

/** "6pm" | "18:00" | "6:30 p.m." -> "18:00:00". Null when unparseable. */
function parseTime(raw: string): string | null {
  const s = raw.trim();
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] || "00";
    if (h > 12) return null;
    const pm = /p/i.test(ampm[3]);
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}:00`;
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1], 10);
    const m = parseInt(h24[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  }
  return null;
}

/** Which weekday indexes the text names. Empty => "no idea", caller opens all 7. */
function parseOpenDays(text: string): number[] {
  if (/\b(every ?day|all week|7 days|daily|7\s*days?\s*a\s*week)\b/i.test(text)) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  const open = new Set<number>();
  const dayWord = "(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)";

  // Ranges first ("Mon–Sat", "Monday to Friday").
  const rangeRe = new RegExp(`\\b${dayWord}\\s*(?:-|–|—|to|through|thru)\\s*${dayWord}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const from = DAY_ALIASES[m[1].toLowerCase()];
    const to = DAY_ALIASES[m[2].toLowerCase()];
    // Wrap forward so "Sat-Mon" means Sat, Sun, Mon.
    for (let i = from; ; i = (i + 1) % 7) {
      open.add(i);
      if (i === to) break;
    }
  }

  // Then any standalone day names ("Mon, Wed and Fri").
  const singleRe = new RegExp(`\\b${dayWord}\\b`, "gi");
  while ((m = singleRe.exec(text)) !== null) {
    open.add(DAY_ALIASES[m[1].toLowerCase()]);
  }

  return [...open];
}

type HourCols = Record<string, string | boolean>;

/**
 * Free-text hours -> the structured tenants.* columns.
 * Returns `{}` when nothing usable was given so the tenant keeps its defaults.
 */
function parseOperatingHours(text: string): HourCols {
  if (!text) return {};

  const dayCols = (open: string, close: string, alwaysOpen: boolean, openDays: number[]): HourCols => {
    const cols: HourCols = {};
    DAY_KEYS.forEach((day, i) => {
      const enabled = openDays.includes(i);
      cols[`${day}_enabled`] = enabled;
      cols[`${day}_open`] = open;
      cols[`${day}_close`] = close;
    });
    return {
      ...cols,
      working_hours_enabled: true,
      working_hours_always_open: alwaysOpen,
      working_hours_open: open,
      working_hours_close: close,
    };
  };

  const allDays = [0, 1, 2, 3, 4, 5, 6];

  if (/24\s*\/\s*7|24x7|24 hours|always open|round the clock/i.test(text)) {
    return { business_hours: "Open 24/7", ...dayCols("00:00:00", "23:59:00", true, allDays) };
  }

  const range = text.match(
    /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})\s*(?:-|–|—|to|till|until)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})/i,
  );
  if (!range) {
    // Hours were given but we can't read them — keep the free text for humans
    // and leave the structured columns on their defaults rather than guessing.
    return { business_hours: text };
  }

  const open = parseTime(range[1]);
  const close = parseTime(range[2]);
  if (!open || !close || open === close) return { business_hours: text };

  const named = parseOpenDays(text);
  return { business_hours: text, ...dayCols(open, close, false, named.length ? named : allDays) };
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
    let body: OnboardingRequest;
    try {
      body = (await req.json()) as OnboardingRequest;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", 400);
    }

    const companyName = clean(body.companyName, MAX.companyName);
    const firstName = clean(body.firstName, MAX.firstName);
    // Lowercased so the duplicate check, the auth user and app_users.email all
    // agree (Supabase Auth stores addresses lowercased anyway).
    const contactEmail = clean(body.contactEmail, MAX.email).toLowerCase();
    const rawSlug = clean(body.slug, 100);
    const location = cleanOrNull(body.location, MAX.location);
    const operatingHours = clean(body.operatingHours, MAX.short);
    const businessColours = cleanOrNull(body.businessColours, MAX.colours);
    // +1 so an over-long URL overflows the cap and is rejected below rather
    // than being silently truncated into a broken <img src>.
    const logoUrl = clean(body.logoUrl, MAX.url + 1);
    const rawPhone = clean(body.businessPhone, MAX.phone);
    const tenantType: "production" | "test" = body.tenantType === "test" ? "test" : "production";
    const isProduction = tenantType === "production";
    const currency = (clean(body.subscriptionCurrency, 8) || "usd").toLowerCase();
    const subscriptionAmount = Number(body.subscriptionAmount);

    if (!companyName) {
      return errorResponse("Company name is required", 400);
    }
    if (!contactEmail) {
      return errorResponse("Contact email is required", 400);
    }
    if (!EMAIL_RE.test(contactEmail)) {
      return errorResponse("Contact email is not a valid email address", 400);
    }
    if (!Number.isFinite(subscriptionAmount) || subscriptionAmount <= 0) {
      return errorResponse("Subscription amount must be greater than 0", 400);
    }
    // ISO-4217 shape. An unknown code would only blow up inside Stripe, i.e.
    // AFTER the tenant + login already exist.
    if (!/^[a-z]{3}$/.test(currency)) {
      return errorResponse("Subscription currency must be a 3-letter ISO code (e.g. usd)", 400);
    }

    const slug = normalizeSlug(rawSlug);
    if (!/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 3 || slug.length > 50) {
      return errorResponse(
        "Slug must start with a letter, be 3–50 characters, and use only lowercase letters, numbers, and hyphens",
        400,
      );
    }
    // The first-login password is capitalizeFirst(<slug alphanumerics>) + "123!",
    // so a slug like "a-b" would yield a 6-char password that Supabase Auth may
    // reject — and we would only find out after the tenant exists.
    const slugAlnum = slug.replace(/[^a-z0-9]/g, "");
    if (slugAlnum.length < 3) {
      return errorResponse("Slug must contain at least 3 letters or numbers", 400);
    }

    // Logos are rendered straight into <img src> on the portal, booking site and
    // signing emails — only absolute http(s) URLs are acceptable.
    if (logoUrl && (!isHttpUrl(logoUrl) || logoUrl.length > MAX.url)) {
      return errorResponse("Logo URL must be a valid http(s) URL", 400);
    }

    // Phone is optional, but a malformed one silently breaks SMS/WhatsApp later.
    const phoneDigits = rawPhone.replace(/\D/g, "");
    if (rawPhone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
      return errorResponse("Business phone must have between 7 and 15 digits", 400);
    }
    const phoneDisplay = rawPhone || null;
    const phoneE164 = rawPhone ? normalizePhone(rawPhone) : null;

    const amountCents = Math.round(subscriptionAmount * 100);
    if (amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
      const sym = currencySymbol(currency);
      return errorResponse(
        `Subscription amount must be between ${sym}${formatDollars(MIN_AMOUNT_CENTS)} and ${sym}${formatDollars(MAX_AMOUNT_CENTS)}`,
        400,
      );
    }

    const portalUrl = `https://${slug}.portal.drive-247.com`;
    const bookingUrl = `https://${slug}.drive-247.com`;

    // Shared field set for the best-effort submission row (created OR failed).
    const submissionBase = {
      created_by: createdBy,
      first_name: firstName || null,
      business_name: companyName,
      slug,
      vehicle_type: cleanOrNull(body.vehicleType, MAX.short),
      fleet_size: cleanOrNull(body.fleetSize, MAX.short),
      location,
      business_phone: phoneDisplay,
      business_email: contactEmail,
      operating_hours: operatingHours || null,
      business_colours: businessColours,
      logo_url: logoUrl || null,
      wants_marketing: typeof body.wantsMarketing === "boolean" ? body.wantsMarketing : null,
      has_meta_ad_account: typeof body.hasMetaAdAccount === "boolean" ? body.hasMetaAdAccount : null,
      meta_daily_budget: cleanOrNull(body.metaDailyBudget, MAX.short),
      other_info: cleanOrNull(body.otherInfo, MAX.notes, true),
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
    const password = capitalizeFirst(slugAlnum) + "123!";

    // ---------------------------------------------------------------------
    // 6. Brand colours -> full tenant palette.
    // ---------------------------------------------------------------------
    const colors = await extractBrandColorsFromText(businessColours, null);
    const palette = buildTenantPalette(colors);

    // ---------------------------------------------------------------------
    // 7. Insert tenant. AFTER-INSERT triggers auto-grant 1000 test credits +
    //    seed CMS pages (incl. site-settings).
    // ---------------------------------------------------------------------
    // tenantType drives everything that costs real money.
    // NOTE: stripe_mode (booking payments) and bonzah_mode stay on their 'test'
    // DB defaults for BOTH tenant types on purpose — live Stripe Connect and
    // live Bonzah both require per-tenant onboarding that has not happened yet,
    // so flipping them here would break checkout on day one. The tenant turns
    // them on from Portal → Settings once onboarding completes.
    const modeCols = isProduction
      ? { boldsign_mode: "live", subscription_stripe_mode: "live", subscription_account: "uk" }
      : { boldsign_mode: "test", subscription_stripe_mode: "test", subscription_account: "uk" };

    // favicon included: without it the client's browser tab keeps the platform icon.
    const logoCols = logoUrl
      ? { logo_url: logoUrl, dark_logo_url: logoUrl, auth_logo_url: logoUrl, favicon_url: logoUrl }
      : {};

    // Identity. WITHOUT these the tenant inherits the platform defaults —
    // tenants.app_name DEFAULTs to the literal 'Drive 917', which the portal
    // sidebar/login/<title> render verbatim (it is not NULL, so the
    // `app_name || company_name` fallbacks never kick in). Same story for the
    // SEO meta on the booking site.
    const identityCols = {
      app_name: companyName,
      admin_email: contactEmail,
      phone: phoneE164,
      meta_title: location
        ? `${companyName} — Car Rentals in ${location}`
        : `${companyName} — Car Rentals`,
      meta_description: location
        ? `Car rental services from ${companyName} in ${location}.`
        : `Car rental services from ${companyName}.`,
    };

    // Free-text hours -> the structured columns the portal/booking site read.
    const hourCols = parseOperatingHours(operatingHours);

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({
        company_name: companyName,
        admin_name: firstName || null,
        slug,
        contact_email: contactEmail,
        contact_phone: phoneDisplay,
        address: location,
        business_hours: operatingHours || null,
        status: "active",
        tenant_type: tenantType,
        ...identityCols,
        ...palette,
        ...logoCols,
        ...modeCols,
        ...hourCols,
      })
      .select()
      .single();

    if (tenantError || !tenant) {
      console.error(`${LOG} tenant insert failed:`, tenantError);
      // Closes the check-then-insert race on the slug: two agents submitting the
      // same slug concurrently both pass the SELECT above, and only the unique
      // index (tenants_slug_key) stops the second one.
      if (isUniqueViolation(tenantError)) {
        await recordFailure(`Tenant insert failed: slug "${slug}" already taken`);
        return errorResponse("Slug already taken", 409);
      }
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

    // Rollback bookkeeping. Every cleanup step records whether it actually
    // succeeded so a partial rollback is reported instead of silently leaving
    // an orphan behind.
    const orphans: string[] = [];

    /** Suffix appended to the recorded failure when a cleanup step didn't land. */
    const rollbackNote = () =>
      orphans.length ? ` | MANUAL CLEANUP REQUIRED: ${orphans.join(", ")}` : "";

    // Tenant cleanup. All tenant-scoped rows created by the AFTER-INSERT
    // triggers (credit wallet, CMS pages, audit logs) are ON DELETE CASCADE, so
    // this is a clean removal. If it somehow fails we suspend the tenant so a
    // half-provisioned record can never be logged into or billed.
    const deleteTenant = async () => {
      try {
        const { error } = await supabase.from("tenants").delete().eq("id", tenantId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete tenant ${tenantId} failed:`, e);
        orphans.push(`tenant ${tenantId} (${slug})`);
        try {
          await supabase.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
        } catch (e2) {
          console.error(`${LOG} rollback: could not suspend tenant ${tenantId}:`, e2);
        }
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
      await recordFailure(
        `Auth user creation failed: ${createAuthError?.message || "unknown error"}${rollbackNote()}`,
      );
      // The step-4 guard only sees app_users; an auth.users row with no
      // app_users profile still blocks the address, so say so plainly rather
      // than returning a generic 500 George can't act on.
      if (/already (been )?registered|already exists/i.test(createAuthError?.message || "")) {
        return errorResponse("A login already exists for this email", 409);
      }
      return errorResponse("Failed to create login user", 500);
    }
    const authUserId = authUser.user.id;

    const deleteAuthUser = async () => {
      try {
        const { error } = await supabase.auth.admin.deleteUser(authUserId);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete auth user ${authUserId} failed:`, e);
        orphans.push(`auth user ${authUserId} (${contactEmail})`);
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
      await recordFailure(
        `App user creation failed: ${appUserError?.message || "unknown error"}${rollbackNote()}`,
      );
      return errorResponse("Failed to create user profile", 500);
    }

    const deleteAppUser = async () => {
      try {
        const { error } = await supabase.from("app_users").delete().eq("id", appUser.id);
        if (!error) return;
        throw error;
      } catch (e) {
        console.error(`${LOG} rollback: delete app_user ${appUser.id} failed:`, e);
        orphans.push(`app_user ${appUser.id}`);
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
        `Subscription plan creation failed: ${(e as Error)?.message || "unknown error"}${rollbackNote()}`,
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
