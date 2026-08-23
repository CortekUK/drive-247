// expire-link-session — kill the Stripe Checkout session behind a retired link.
//
// Called by the DB trigger trg_subscription_link_expire_session whenever a link
// leaves 'pending' for revoked / expired / superseded, whatever did the
// retiring: the admin UI, the edge function, the sweep, or a hand-run UPDATE.
//
// Retiring our row does not retire Stripe's session. A session already open in
// the prospect's tab stays payable, and because expiry is clamped to at least
// now+30min a session minted near the end of a link's life outlives the link.
// Doing this at the database means no caller can forget: the guarantee belongs
// to the state transition, not to whoever happened to make it.
//
// verify_jwt = false because pg_net carries no user JWT. It is NOT anonymously
// useful: the caller must present x-platform-secret, and the only input is a
// link id that is re-read here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { expireLinkSession } from "../_shared/subscription-link.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const secret = req.headers.get("x-platform-secret");
    if (!secret) return errorResponse("Unauthorized", 401);
    const { data: ok } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
    if (ok !== true) return errorResponse("Unauthorized", 401);

    const { linkId } = await req.json().catch(() => ({}));
    if (!linkId) return jsonResponse({ skipped: "no linkId" });

    const { data: link } = await supabase
      .from("subscription_links")
      .select("id, status, last_session_id, last_session_expires_at, stripe_account_snapshot, stripe_mode_snapshot")
      .eq("id", linkId)
      .maybeSingle();

    if (!link) return jsonResponse({ skipped: "link not found" });
    // Only ever act on a retired link. A paid one must keep its session record.
    if (!["revoked", "expired", "superseded"].includes(link.status)) {
      return jsonResponse({ skipped: `status is ${link.status}` });
    }
    if (!link.last_session_id) return jsonResponse({ skipped: "no session was minted" });

    const stripe = getSubscriptionStripeClientForAccount(
      link.stripe_account_snapshot as "uk" | "uae",
      link.stripe_mode_snapshot as "test" | "live",
    );
    const expired = await expireLinkSession(stripe, link);

    return jsonResponse({ success: true, linkId: link.id, expired });
  } catch (err) {
    console.error("[expire-link-session] failed:", err);
    return jsonResponse({ success: false, error: (err as { message?: string })?.message ?? "failed" });
  }
});
