/**
 * refresh-accounting-tokens — Spec §6.3.
 *
 * Cron-triggered every 10 minutes (per the cron migration). For each active
 * accounting_connections row whose access token expires in <15 min, refresh
 * the token by calling the provider's token endpoint with grant_type=refresh_token.
 *
 * Provider differences:
 *   - **Xero rotates the refresh token on every refresh** — must persist the
 *     new one. accounting_store_tokens handles UPSERT correctly.
 *   - **Zoho returns the same refresh token forever** — we pass NULL for
 *     refresh_token in store_tokens, which causes that fn to keep the existing
 *     one in vault.
 *
 * On 3 consecutive 4xx responses we flip the connection to 'expired' and
 * insert a reminders row so the portal shows a banner "Your Xero connection
 * has expired — reconnect" (Sprint 6 hardening lights up the banner UI).
 *
 * Idempotent: safe to fire multiple times — if a token is already fresh
 * we just skip it.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { XERO, ZOHO } from "../_shared/accounting/oauth-constants.ts";

const REFRESH_WINDOW_SECONDS = 15 * 60;   // refresh if token expires within 15 min
const MAX_CONSECUTIVE_FAILURES = 3;       // then mark expired

interface Summary {
  connections_checked: number;
  refreshed: number;
  skipped_fresh: number;
  expired: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const summary: Summary = {
      connections_checked: 0,
      refreshed: 0,
      skipped_fresh: 0,
      expired: 0,
      errors: [],
    };

    const cutoff = new Date(Date.now() + REFRESH_WINDOW_SECONDS * 1000).toISOString();
    const { data: candidatesRaw } = await supabase
      .from("accounting_connections")
      .select("id, tenant_id, provider, external_region, token_expires_at, last_error, refresh_failure_count")
      .eq("status", "active")
      .or(`token_expires_at.is.null,token_expires_at.lt.${cutoff}`);
    const candidates = (candidatesRaw ?? []) as Array<{
      id: string; tenant_id: string; provider: "xero" | "zoho";
      external_region: string | null; token_expires_at: string | null;
      last_error: string | null; refresh_failure_count: number | null;
    }>;
    summary.connections_checked = candidates.length;

    for (const c of candidates) {
      try {
        // Read current vault tokens
        const { data: tokens } = await supabase.rpc("accounting_get_tokens", {
          p_tenant_id: c.tenant_id,
          p_provider: c.provider,
        });
        const tokenRow = Array.isArray(tokens) ? tokens[0] : tokens;
        if (!tokenRow || !tokenRow.refresh_token) {
          await markExpired(supabase, c.tenant_id, c.provider, "no_refresh_token");
          summary.expired++;
          continue;
        }

        const usedRefreshToken = tokenRow.refresh_token as string;
        const fresh = await refreshOne(c.provider, c.external_region, usedRefreshToken);
        if (!fresh.ok) {
          // Xero rotates the refresh token on every successful refresh and
          // invalidates the old one immediately. So a 400 here has two very
          // different causes:
          //   (a) the grant really is dead → the operator must reconnect
          //   (b) another worker (or an overlapping tick of this cron) already
          //       refreshed, rotating the token out from under us
          // Case (b) is a benign race and must NOT expire a healthy connection.
          // Distinguish them by re-reading the vault: if the stored refresh
          // token has changed since we read it, someone else succeeded.
          const { data: recheck } = await supabase.rpc("accounting_get_tokens", {
            p_tenant_id: c.tenant_id,
            p_provider: c.provider,
          });
          const recheckRow = Array.isArray(recheck) ? recheck[0] : recheck;
          if (recheckRow?.refresh_token && recheckRow.refresh_token !== usedRefreshToken) {
            console.log(`refresh-accounting-tokens: ${c.provider}/${c.tenant_id} rotated concurrently — treating as fresh`);
            await supabase
              .from("accounting_connections")
              .update({ last_error: null, refresh_failure_count: 0 })
              .eq("id", c.id);
            summary.skipped_fresh++;
            continue;
          }
          await recordFailure(supabase, c.id, c.tenant_id, c.provider, fresh.error, c.refresh_failure_count ?? 0);
          if (fresh.markExpired) summary.expired++;
          summary.errors.push(`${c.provider}/${c.tenant_id}: ${fresh.error}`);
          continue;
        }

        // Belt and braces: refreshOne already rejects a non-numeric expires_in,
        // but a NaN reaching here throws inside toISOString() and the throw is
        // swallowed by the catch below — the connection would then silently stop
        // refreshing. Fall back to Zoho/Xero's standard one-hour token life.
        const expiresInSeconds = Number.isFinite(fresh.expiresInSeconds) && fresh.expiresInSeconds > 0
          ? fresh.expiresInSeconds
          : 3600;
        const newExpiresAt = new Date(Date.now() + (expiresInSeconds - 30) * 1000).toISOString();
        await supabase.rpc("accounting_store_tokens", {
          p_tenant_id: c.tenant_id,
          p_provider: c.provider,
          p_access_token: fresh.accessToken,
          // Xero rotates → persist new. Zoho doesn't return one → pass NULL.
          p_refresh_token: fresh.newRefreshToken ?? null,
          p_expires_at: newExpiresAt,
          p_external_org_id: "__keep__",                  // ignored on UPDATE (we just refresh tokens)
          p_external_org_name: null,
          p_external_region: null,
          p_connected_by: null,
        });

        // Clear last_error AND the consecutive-failure counter — the budget
        // is for *consecutive* failures, so any success must reset it.
        await supabase
          .from("accounting_connections")
          .update({ last_error: null, refresh_failure_count: 0 })
          .eq("id", c.id);

        summary.refreshed++;
      } catch (err) {
        summary.errors.push(`${c.provider}/${c.tenant_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("refresh-accounting-tokens error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

interface RefreshResult {
  ok: boolean;
  accessToken: string;
  newRefreshToken: string | null;
  expiresInSeconds: number;
  error: string;
  markExpired: boolean;
}

async function refreshOne(
  provider: "xero" | "zoho",
  region: string | null,
  refreshToken: string,
): Promise<RefreshResult> {
  if (provider === "xero") {
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return fail("xero_not_configured", false);
    }
    const basic = btoa(`${clientId}:${clientSecret}`);
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch(XERO.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const status = res.status;
      const text = await res.text().catch(() => "");
      const isAuth = status === 400 || status === 401 || status === 403;
      return { ok: false, accessToken: "", newRefreshToken: null, expiresInSeconds: 0, error: `xero_refresh_${status}: ${text.slice(0, 200)}`, markExpired: isAuth };
    }
    const json = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    return { ok: true, accessToken: json.access_token, newRefreshToken: json.refresh_token ?? null, expiresInSeconds: json.expires_in, error: "", markExpired: false };
  }

  // Zoho
  const zohoRegion = region ?? "com";
  const clientId = Deno.env.get("ZOHO_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return fail("zoho_not_configured", false);
  }
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(ZOHO.tokenUrl(zohoRegion), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const status = res.status;
    const text = await res.text().catch(() => "");
    const isAuth = status === 400 || status === 401 || status === 403;
    return { ok: false, accessToken: "", newRefreshToken: null, expiresInSeconds: 0, error: `zoho_refresh_${status}: ${text.slice(0, 200)}`, markExpired: isAuth };
  }
  // Zoho signals failure with HTTP 200 and an error in the BODY — verified live
  // against accounts.zoho.com, which answers a bad refresh token with
  // `HTTP 200 {"error":"general_error"}`. The `!res.ok` check above therefore
  // never fires for the most common failures.
  //
  // Left unguarded this is not a soft failure, it is a wedge: access_token and
  // expires_in come back undefined, the caller computes
  // `new Date(Date.now() + (undefined - 30) * 1000)` → Invalid Date, and
  // .toISOString() THROWS. The throw is swallowed by the per-connection catch,
  // so the connection is never refreshed, never marked expired, and simply dies
  // when its one-hour token lapses — with nothing actionable in the log.
  const json = await res.json().catch(() => null) as
    { access_token?: string; expires_in?: number; error?: string } | null;

  if (!json || json.error || !json.access_token || typeof json.expires_in !== "number") {
    const reason = json?.error ?? (json ? "missing access_token/expires_in" : "unparseable response");
    // `invalid_client` means the app credentials are wrong — that is terminal and
    // worth expiring. Anything else may be transient, so let the consecutive
    // failure budget decide rather than killing the connection on one bad reply.
    const isAuth = reason === "invalid_client" || reason === "invalid_grant";
    return {
      ok: false, accessToken: "", newRefreshToken: null, expiresInSeconds: 0,
      error: `zoho_refresh_200_body_error: ${reason}`, markExpired: isAuth,
    };
  }

  // Zoho doesn't rotate; we pass null upward so store_tokens keeps the existing one.
  return { ok: true, accessToken: json.access_token, newRefreshToken: null, expiresInSeconds: json.expires_in, error: "", markExpired: false };
}

function fail(error: string, markExpired: boolean): RefreshResult {
  return { ok: false, accessToken: "", newRefreshToken: null, expiresInSeconds: 0, error, markExpired };
}

async function recordFailure(
  supabase: ReturnType<typeof createClient>,
  connectionId: string,
  tenantId: string,
  provider: "xero" | "zoho",
  errorMsg: string,
  currentFailures: number,
) {
  // Count consecutive failures and only expire once the budget is spent.
  //
  // This function previously expired the connection on the FIRST 4xx, which is
  // why MAX_CONSECUTIVE_FAILURES existed as a constant but did nothing. Expiry
  // is not recoverable without the operator re-running the full OAuth consent
  // flow, so it is far too harsh a response to one bad response from Xero.
  const failures = currentFailures + 1;
  await supabase
    .from("accounting_connections")
    .update({
      last_error: `${errorMsg.slice(0, 460)} (failure ${failures}/${MAX_CONSECUTIVE_FAILURES})`,
      refresh_failure_count: failures,
    })
    .eq("id", connectionId);

  // A missing refresh token is terminal on the first hit — there is nothing to
  // retry with, so counting further attempts would just delay telling the
  // operator. Everything else gets the full budget.
  const terminal = errorMsg.includes("no_refresh_token");
  const authClass =
    errorMsg.includes("400") || errorMsg.includes("401") || errorMsg.includes("403");

  if (terminal || (authClass && failures >= MAX_CONSECUTIVE_FAILURES)) {
    await markExpired(supabase, tenantId, provider, errorMsg);
  }
}

async function markExpired(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  provider: "xero" | "zoho",
  reason: string,
) {
  // Flip status to 'expired' (does NOT delete vault secrets — they'd be useless
  // anyway, but the row stays for audit).
  await supabase
    .from("accounting_connections")
    .update({
      status: "expired",
      last_error: reason.slice(0, 500),
    })
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("status", "active");

  // Flip tenant flag so the sidebar / settings UI reflects the truth.
  const flagColumn = provider === "xero" ? "integration_xero" : "integration_zoho_books";
  await supabase.from("tenants").update({ [flagColumn]: false }).eq("id", tenantId);

  // Insert an in-app reminder for the operator to reconnect.
  await supabase.from("reminders").insert({
    rule_code: "accounting_connection_expired",
    object_type: "tenant",
    object_id: tenantId,
    title: `Your ${provider === "xero" ? "Xero" : "Zoho Books"} connection has expired`,
    message: "Reconnect from Settings → Accounting to resume syncing financial events.",
    severity: "warning",
    status: "pending",
    tenant_id: tenantId,
    context: { provider, reason: reason.slice(0, 200) },
  });
}
