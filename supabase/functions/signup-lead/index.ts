// =============================================================================
// signup-lead — save a drive-247.com signup's answers from the first page on.
//
// Neema, 2026-11-25: the account (and the Stripe customer) is only created once
// the business page is submitted, so someone who typed their name, email and
// phone and then stopped left no record, and Bryan could not call them. The
// browser now holds a random lead token (32 bytes, hex) and calls this:
//
//   { action: "save", token, step, details? }  → upsert the lead row; `details`
//        (name, email, phone, fleet size, how they heard, city and state, plan)
//        are written when present. `last_step` only ever moves forward.
//   { action: "read", token }                  → the details back, so a visitor
//        whose in-app browser (Instagram, Facebook) reloaded the page picks up
//        where they left off. Only the token's holder can read it.
//
// Stored: SHA-256 of the token, never the token. No session needed (the lead
// is not an account yet), so verify_jwt is off like every signup function, and
// a per-IP throttle plus the usual honeypot keep it from being a free write.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { checkThrottle, clientIp, recordAttempt, signupError } from "../_shared/signup-state.ts";
import { clean, EMAIL_RE, MAX } from "../_shared/tenant-provisioning.ts";
import { normalizeSignupPhone } from "../_shared/signup-attribution.ts";

const LOG = "[signup-lead]";
const HOUR_MS = 60 * 60 * 1000;

/**
 * The signup's screens in the order people meet them: the 3-step signup
 * (feat-001 spec 09). The email code and the password moved into the portal.
 */
const STEP_ORDER: Record<string, number> = {
  details: 1,
  business: 2,
  card: 3,
  done: 4,
};

/**
 * Steps of the old 5-step form. A browser still holding that page may send
 * them for a while; they sat between the business page and the card, so they
 * count as the business step and never move a lead backwards or forwards past
 * it. Matches the migration that renumbered older rows (20261127000000).
 */
const OLD_STEPS: Record<string, string> = { email_code: "business", password: "business" };

const FLEET = new Set(["1-5", "6-20", "21+"]);
const IN_APP = new Set(["instagram", "facebook", "messenger", "tiktok", "other"]);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface LeadBody {
  action?: string;
  token?: string;
  step?: string;
  inAppBrowser?: string;
  companyWebsite?: string;
  details?: {
    fullName?: string;
    email?: string;
    phone?: string;
    fleetSize?: string;
    heardAbout?: string;
    heardAboutOther?: string;
    cityState?: string;
    planId?: string;
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return signupError("METHOD_NOT_ALLOWED", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return signupError("CONFIG_MISSING", "Signup is temporarily unavailable.", 500);
  const supabase = createClient(url, key);
  const ip = clientIp(req);

  let body: LeadBody;
  try {
    body = (await req.json()) as LeadBody;
  } catch {
    return signupError("INVALID_BODY", "Invalid JSON body", 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return signupError("INVALID_BODY", "Invalid lead token", 400);
  const tokenHash = await sha256Hex(token);

  // Honeypot: a silent success, nothing written.
  if (clean(body.companyWebsite, 200)) return jsonResponse({ success: true });

  // ── read: the holder of the token gets their own answers back ─────────────
  if (body.action === "read") {
    const { data, error } = await supabase
      .from("signup_leads")
      .select("email, full_name, phone, fleet_size, heard_about, heard_about_other, city_state, plan_id, last_step")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) {
      console.error(`${LOG} read failed:`, error.message);
      return signupError("LEAD_UNAVAILABLE", "Could not read the saved answers.", 500);
    }
    return jsonResponse({
      success: true,
      lead: data
        ? {
          email: data.email ?? "",
          fullName: data.full_name ?? "",
          phone: data.phone ?? "",
          fleetSize: data.fleet_size ?? null,
          heardAbout: data.heard_about ?? "",
          heardAboutOther: data.heard_about_other ?? "",
          cityState: data.city_state ?? "",
          planId: data.plan_id ?? null,
          lastStep: data.last_step,
        }
        : null,
    });
  }

  // ── save ────────────────────────────────────────────────────────────────
  const asked = typeof body.step === "string" ? (OLD_STEPS[body.step] ?? body.step) : null;
  const step = asked && STEP_ORDER[asked] ? asked : null;
  if (!step) return signupError("INVALID_BODY", "Unknown step", 400);

  // 60 saves an hour per IP: a person makes a handful, a script many more.
  const rules = ip ? [{ scope: "signup_lead_ip", key: ip, limit: 60, windowMs: HOUR_MS }] : [];
  const allowed = await checkThrottle(supabase, rules);
  await recordAttempt(supabase, {
    scope: "lead",
    ip_address: ip,
    outcome: allowed ? "allowed" : "blocked",
    metadata: { step },
    throttleRules: rules.map((r) => ({ scope: r.scope, key: r.key })),
  });
  if (!allowed) return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);

  const d = body.details ?? {};
  const email = clean(d.email, MAX.email).toLowerCase();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (email && EMAIL_RE.test(email)) patch.email = email;
  const fullName = clean(d.fullName, MAX.firstName * 2);
  if (fullName) patch.full_name = fullName;
  const phone = normalizeSignupPhone(d.phone);
  if (phone) patch.phone = phone;
  if (typeof d.fleetSize === "string" && FLEET.has(d.fleetSize)) patch.fleet_size = d.fleetSize;
  const heard = clean(d.heardAbout, 40);
  if (heard) patch.heard_about = heard;
  const heardOther = clean(d.heardAboutOther, 120);
  if (heardOther) patch.heard_about_other = heardOther;
  const cityState = clean(d.cityState, 120);
  if (cityState) patch.city_state = cityState;
  const planId = clean(d.planId, 40);
  if (planId) patch.plan_id = planId;
  const inApp = typeof body.inAppBrowser === "string" && IN_APP.has(body.inAppBrowser) ? body.inAppBrowser : null;
  if (inApp) patch.in_app_browser = inApp;
  if (ip) patch.ip_address = ip;
  const ua = clean(req.headers.get("user-agent"), 300);
  if (ua) patch.user_agent = ua;

  const { data: existing, error: readError } = await supabase
    .from("signup_leads")
    .select("id, last_step_order")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (readError) {
    console.error(`${LOG} lookup failed:`, readError.message);
    return signupError("LEAD_UNAVAILABLE", "Could not save the answers.", 500);
  }

  const order = STEP_ORDER[step];
  if (!existing || order > (existing.last_step_order ?? 0)) {
    patch.last_step = step;
    patch.last_step_order = order;
  }

  const { data: saved, error } = existing
    ? await supabase.from("signup_leads").update(patch).eq("id", existing.id).select("id").single()
    : await supabase.from("signup_leads").insert({ token_hash: tokenHash, ...patch }).select("id").single();
  if (error) {
    console.error(`${LOG} save failed:`, error.message);
    return signupError("LEAD_UNAVAILABLE", "Could not save the answers.", 500);
  }
  return jsonResponse({ success: true, leadId: saved.id });
});
