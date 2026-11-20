// =============================================================================
// signup-finish-later — the card step's "Not ready just yet?" offer, and the
// "Email me a link to finish later" link it can send.
//
// Three actions, one function:
//
//   offer_seen  (signed-in signup)  The offer was shown. Recorded on the account
//                                   (app_metadata + signup_attribution) so it is
//                                   shown once per person, and so Bryan can see
//                                   they were offered 20%.
//   send        (signed-in signup)  Emails a link, from support@, that opens the
//                                   card step on another device. 3 per hour per
//                                   account. The link carries a random token of
//                                   ours, good for 7 days; only its SHA-256 is
//                                   kept (public.signup_finish_later_tokens).
//   redeem      (no session)        The link was opened. A valid, unexpired
//                                   token for an account whose portal is NOT
//                                   built yet is exchanged for a one-time
//                                   Supabase sign-in (a magic-link token hash the
//                                   browser spends with verifyOtp at once). Once
//                                   the portal exists the link signs nobody in:
//                                   the answer is ALREADY_PROVISIONED with the
//                                   portal address instead.
//
// verify_jwt = false (supabase/config.toml), because `redeem` is opened on a
// device with no session by definition. `offer_seen` and `send` check the
// session themselves with auth.getUser(), as every signup function does.
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { DRIVE247_SENDER } from "../_shared/drive247-email.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { checkCodeUsable, findCode, publicCodeView } from "../_shared/platform-promo.ts";
import { markExitOfferSeen } from "../_shared/signup-attribution.ts";
import {
  checkThrottle,
  clientIp,
  readSignupMeta,
  recordAttempt,
  signupError,
  writeSignupMeta,
} from "../_shared/signup-state.ts";
import {
  buildFinishLaterEmail,
  buildFinishLaterLink,
  checkFinishLaterToken,
  FINISH_LATER_SENDS_PER_HOUR,
  finishLaterCode,
  finishLaterExpiry,
  finishLaterSignupState,
  hashFinishLaterToken,
  isFinishLaterTokenShape,
  mintFinishLaterToken,
} from "../_shared/signup-finish-later.ts";

const LOG = "[signup-finish-later]";
const HOUR_MS = 60 * 60 * 1000;
/** Link opens per IP per hour. Generous: a shared office is one IP. */
const REDEEMS_PER_IP_PER_HOUR = 30;

type Action = "offer_seen" | "send" | "redeem";

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

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return signupError("INVALID_BODY", "Invalid JSON body", 400);
  }
  const action = body.action as Action;

  try {
    if (action === "redeem") return await redeem(supabase, req, body);
    if (action === "offer_seen" || action === "send") {
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

      if (action === "offer_seen") {
        const at = meta.exitOfferSeenAt ?? new Date().toISOString();
        if (!meta.exitOfferSeenAt) await writeSignupMeta(supabase, user.id, { exitOfferSeenAt: at });
        await markExitOfferSeen(supabase, { authUserId: user.id, email: meta.email, at });
        return jsonResponse({ success: true, exitOfferSeenAt: at });
      }
      return await send(supabase, req, user.id, meta, body);
    }
    return signupError("INVALID_BODY", "Unknown action", 400);
  } catch (error) {
    console.error(`${LOG} unexpected error (${String(action)}):`, error);
    return signupError("INTERNAL", "Internal server error", 500);
  }
});

async function send(
  supabase: any,
  req: Request,
  authUserId: string,
  meta: NonNullable<ReturnType<typeof readSignupMeta>>,
  body: Record<string, unknown>,
): Promise<Response> {
  if (finishLaterSignupState(meta) !== "open") {
    return signupError("ALREADY_PROVISIONED", "Your portal is already set up.", 409);
  }

  const rule = { scope: "signup_finish_later", key: authUserId, limit: FINISH_LATER_SENDS_PER_HOUR, windowMs: HOUR_MS };
  const allowed = await checkThrottle(supabase, [rule]);
  await recordAttempt(supabase, {
    scope: "finish_later",
    ip_address: clientIp(req),
    email: meta.email,
    auth_user_id: authUserId,
    plan_id: meta.planId,
    outcome: allowed ? "allowed" : "blocked",
    throttleScope: rule.scope,
    throttleKey: rule.key,
  });
  if (!allowed) return signupError("RATE_LIMITED", "Too many links sent. Please try again later.", 429);

  // The code rides along only while it is live for this plan, so the email
  // never promises a discount the card step would then refuse.
  let code = finishLaterCode(body.code);
  let offer: { discountText: string; durationText: string } | null = null;
  if (code) {
    try {
      const found = await findCode(supabase, code);
      const usable = found.ok
        ? await checkCodeUsable(supabase, found.code, { channel: "self_serve", planKey: meta.planId })
        : found;
      if (found.ok && usable.ok) {
        const view = await publicCodeView(supabase, found.code);
        offer = { discountText: view.discountText, durationText: view.durationText };
      } else {
        console.warn(`${LOG} ${code} is not usable (${(usable as { reason?: string }).reason}); sending the link without it`);
        code = null;
      }
    } catch (e) {
      console.warn(`${LOG} promo check failed; sending the link without the code:`, e);
      code = null;
    }
  }

  const token = mintFinishLaterToken();
  const { error: insertError } = await supabase.from("signup_finish_later_tokens").insert({
    auth_user_id: authUserId,
    token_hash: await hashFinishLaterToken(token),
    email: meta.email,
    promo_code: code,
    expires_at: finishLaterExpiry(),
  });
  if (insertError) {
    console.error(`${LOG} could not store the link for ${authUserId}:`, insertError);
    return signupError("INTERNAL", "Could not create your link", 500);
  }

  const { subject, html } = buildFinishLaterEmail({
    fullName: meta.fullName,
    link: buildFinishLaterLink(token, code),
    offer,
  });
  const sent = await sendResendEmail(
    { to: meta.email, subject, html, ...DRIVE247_SENDER, source: "signup-finish-later" },
    supabase,
  );
  if (!sent?.success) {
    console.error(`${LOG} email not delivered for ${authUserId}:`, sent?.error);
    return signupError("INTERNAL", "Could not send the email", 502);
  }

  await recordAttempt(supabase, {
    scope: "finish_later",
    email: meta.email,
    auth_user_id: authUserId,
    plan_id: meta.planId,
    outcome: "ok",
    metadata: { code },
  });
  return jsonResponse({ success: true, sent: true });
}

async function redeem(supabase: any, req: Request, body: Record<string, unknown>): Promise<Response> {
  const invalid = () =>
    signupError("FINISH_LINK_INVALID", "That link has expired or is no longer valid.", 410);

  const ip = clientIp(req);
  if (ip) {
    const rule = { scope: "signup_finish_later_redeem_ip", key: ip, limit: REDEEMS_PER_IP_PER_HOUR, windowMs: HOUR_MS };
    const allowed = await checkThrottle(supabase, [rule]);
    await recordAttempt(supabase, {
      scope: "finish_later_redeem",
      ip_address: ip,
      outcome: allowed ? "allowed" : "blocked",
      throttleScope: rule.scope,
      throttleKey: rule.key,
    });
    if (!allowed) return signupError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);
  }

  if (!isFinishLaterTokenShape(body.token)) return invalid();
  const tokenHash = await hashFinishLaterToken(body.token);

  const { data: row, error: rowError } = await supabase
    .from("signup_finish_later_tokens")
    .select("id, auth_user_id, expires_at, revoked_at, used_count, promo_code")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (rowError) throw rowError;
  const verdict = checkFinishLaterToken(row);
  if (!verdict.ok) {
    console.log(`${LOG} refused a link: ${verdict.reason}`);
    return invalid();
  }

  // The account comes from the stored row, never from the request: the token
  // signs in the one account it was minted for and no other.
  const { data: found, error: userError } = await supabase.auth.admin.getUserById(row.auth_user_id);
  const user = found?.user;
  if (userError || !user?.email) return invalid();
  const meta = readSignupMeta(user);

  // A portal owner is never signed in by an emailed link. Checked on the
  // metadata AND on app_users, so a half-written blob cannot open the door.
  const { data: staff } = await supabase
    .from("app_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1)
    .maybeSingle();
  const state = staff ? "provisioned" : finishLaterSignupState(meta);
  if (state === "missing") return invalid();
  if (state === "provisioned") {
    return signupError("ALREADY_PROVISIONED", "Your portal is already set up.", 409, {
      ...(meta?.portalUrl ? { portalUrl: meta.portalUrl } : {}),
    });
  }

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) {
    console.error(`${LOG} could not mint a sign-in for ${user.id}:`, linkError);
    return signupError("INTERNAL", "Could not sign you in", 500);
  }

  const { error: useError } = await supabase
    .from("signup_finish_later_tokens")
    .update({ used_count: (row.used_count ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq("id", row.id);
  if (useError) console.warn(`${LOG} could not count a use of link ${row.id} (non-fatal):`, useError);

  await recordAttempt(supabase, {
    scope: "finish_later_redeem",
    ip_address: ip,
    email: user.email,
    auth_user_id: user.id,
    plan_id: meta?.planId ?? null,
    outcome: "ok",
  });

  return jsonResponse({
    success: true,
    email: user.email,
    tokenHash: hashed,
    planId: meta?.planId ?? null,
    code: row.promo_code ?? null,
  });
}
