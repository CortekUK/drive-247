// promo-code-lookup — PUBLIC (verify_jwt = false). Drive247 platform promo codes.
//
// Answers "is this code good, and what does it give?" for the referral landing
// (/r/{code}), the signup promo field and the payment-link page. Returns
// display text only: never ids, never amounts owed, nothing about the code's
// owner beyond the business name they agreed to show.
//
// POST { code?, planKey?, linkToken? }
//   code        what the visitor typed or carried in a link
//   planKey     the signup plan they are looking at (campaign plan limits)
//   linkToken   a sales payment link's token: the code is then checked against
//               that link's operator (self-referral, new operators only), and
//               with no `code` the answer is the code pre-applied to the link
//
// -> { valid: true, kind, displayCode, discountText, durationText, referrerName, preApplied? }
//  | { valid: false, reason }
//
// Rate-limited per caller (hashed IP), because it is an oracle for which codes
// exist.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/subscription-link.ts";
import {
  checkCodeUsable,
  findCode,
  PROMO_CODE_COLUMNS,
  publicCodeView,
  toCodeRow,
  type PromoCodeRow,
} from "../_shared/platform-promo.ts";
import { normalizePromoCode } from "../_shared/platform-promo-rules.ts";

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_WINDOW = 30;

function clientIp(req: Request): string | null {
  const first = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  if (first) return first.slice(0, 100);
  return req.headers.get("cf-connecting-ip")?.trim().slice(0, 100) || null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ valid: false, reason: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    // ── throttle ─────────────────────────────────────────────────────────
    const ipHash = await sha256Hex(`promo-code-lookup:${clientIp(req) ?? "unknown"}`);
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await supabase
      .from("promo_code_lookup_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    await supabase.from("promo_code_lookup_attempts").insert({ ip_hash: ipHash });
    if ((count ?? 0) >= LIMIT_PER_WINDOW) return jsonResponse({ valid: false, reason: "rate_limited" }, 429);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const planKey = typeof body.planKey === "string" ? body.planKey.slice(0, 100) : null;
    const hasCode = typeof body.code === "string" && body.code.trim().length > 0;

    // ── a sales payment link: check against that link's operator ────────
    if (typeof body.linkToken === "string" && body.linkToken.length >= 20 && body.linkToken.length <= 200) {
      const { data: link } = await supabase
        .from("subscription_links")
        .select("tenant_id, status, promo_code_id")
        .eq("token_hash", await sha256Hex(body.linkToken))
        .maybeSingle();
      if (!link || link.status !== "pending") return jsonResponse({ valid: false, reason: "not_found" });

      let code: PromoCodeRow | null = null;
      let preApplied = false;
      if (link.promo_code_id) {
        const { data: row } = await supabase
          .from("platform_promo_codes")
          .select(PROMO_CODE_COLUMNS)
          .eq("id", link.promo_code_id)
          .maybeSingle();
        if (row) {
          code = toCodeRow(row);
          preApplied = true;
        }
      }
      if (hasCode) {
        // One code per checkout (D11): a typed code cannot sit on top of the
        // one sales already applied.
        if (preApplied && normalizePromoCode(body.code) !== code!.code) {
          return jsonResponse({ valid: false, reason: "one_code_per_checkout" });
        }
        if (!preApplied) {
          const found = await findCode(supabase, body.code);
          if (!found.ok) return jsonResponse({ valid: false, reason: found.reason });
          code = found.code;
        }
      }
      if (!code) return jsonResponse({ valid: false, reason: "not_found" });

      const usable = await checkCodeUsable(supabase, code, { channel: "payment_link", redeemingTenantId: link.tenant_id });
      if (!usable.ok) return jsonResponse({ valid: false, reason: usable.reason, preApplied });
      return jsonResponse({ valid: true, preApplied, ...(await publicCodeView(supabase, code)) });
    }

    // ── a bare code: the referral landing and the signup field ───────────
    if (!hasCode) return jsonResponse({ valid: false, reason: "not_found" });
    const found = await findCode(supabase, body.code);
    if (!found.ok) return jsonResponse({ valid: false, reason: found.reason });
    const usable = await checkCodeUsable(supabase, found.code, { channel: "lookup", planKey });
    if (!usable.ok) return jsonResponse({ valid: false, reason: usable.reason });
    return jsonResponse({ valid: true, ...(await publicCodeView(supabase, found.code)) });
  } catch (err) {
    console.error("[promo-code-lookup] failed:", (err as { message?: string })?.message ?? err);
    return jsonResponse({ valid: false, reason: "unavailable" }, 500);
  }
});
