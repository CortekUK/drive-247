/**
 * Accounting sync v2 — access tokens.
 *
 * Xero access tokens last ~30 minutes and the refresh token ROTATES on every
 * refresh: the new one must be saved every time or the next refresh fails with
 * invalid_grant and the connection is lost. Zoho access tokens last ~1 hour and
 * the refresh token is long-lived (Zoho does not return a new one).
 *
 * Tokens only ever pass through `accounting_v2_store_tokens` /
 * `accounting_v2_get_tokens` (Vault, service_role only). They never reach the
 * browser and never land in a column.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { clientCreds, XERO, zohoAccountsServer } from "./config.ts";
import { type Connection, ProviderError } from "./types.ts";

const SKEW_MS = 2 * 60_000;

export interface TokenSet {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}

export async function storeTokens(db: SupabaseClient, connectionId: string, t: TokenSet): Promise<void> {
  const expiresIn = Number.isFinite(t.expires_in) && t.expires_in > 0 ? t.expires_in : 1800;
  const { error } = await db.rpc("accounting_v2_store_tokens", {
    p_connection_id: connectionId,
    p_access_token: t.access_token,
    p_refresh_token: t.refresh_token,
    p_expires_at: new Date(Date.now() + (expiresIn - 30) * 1000).toISOString(),
  });
  if (error) throw new Error(`Could not save the tokens: ${error.message}`);
}

/** Exchange or refresh at the provider's token endpoint. */
export async function requestToken(
  conn: Pick<Connection, "provider" | "accounts_server" | "region">,
  params: Record<string, string>,
): Promise<TokenSet> {
  const creds = clientCreds(conn.provider);
  if (!creds) throw new ProviderError("validation", `${conn.provider === "xero" ? "Xero" : "Zoho"} is not configured on the server (client id / secret missing).`);

  let res: Response;
  if (conn.provider === "xero") {
    res = await fetch(XERO.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${creds.id}:${creds.secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
  } else {
    const server = (conn.accounts_server ?? zohoAccountsServer(conn.region ?? "com")).replace(/\/+$/, "");
    res = await fetch(`${server}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: creds.id, client_secret: creds.secret }).toString(),
    });
  }
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  // Zoho answers failures with HTTP 200 and an `error` in the body.
  const err = (json?.error as string | undefined) ?? (!res.ok ? `http_${res.status}` : undefined);
  if (err || !json?.access_token) {
    const reason = err ?? "no_access_token";
    // invalid_grant (Xero) / invalid_code (Zoho): the grant is gone — only a reconnect fixes it.
    const kind = /invalid_grant|invalid_code|unauthorized_client|access_denied/i.test(reason) || res.status === 400 || res.status === 401
      ? "auth" : res.status === 429 ? "rate" : "transient";
    throw new ProviderError(kind, `Token request rejected: ${reason}`, res.status);
  }
  return {
    access_token: json.access_token as string,
    refresh_token: (json.refresh_token as string | undefined) ?? null,
    expires_in: Number(json.expires_in ?? 1800),
    ...(json.api_domain ? { api_domain: json.api_domain } : {}),
  } as TokenSet;
}

/**
 * A usable access token for this connection, refreshing (and saving the
 * rotated refresh token) when it is within two minutes of expiry. An auth
 * failure flips the connection to `needs_reauth`; its items stay waiting.
 */
export async function getAccessToken(db: SupabaseClient, conn: Connection, force = false): Promise<string> {
  const { data, error } = await db.rpc("accounting_v2_get_tokens", { p_connection_id: conn.id });
  if (error) throw new Error(`Could not read the tokens: ${error.message}`);
  const row = (data as Array<{ access_token: string | null; refresh_token: string | null; expires_at: string | null }>)?.[0];
  if (!row?.refresh_token && !row?.access_token) {
    await markNeedsReauth(db, conn, "No stored credentials — reconnect.");
    throw new ProviderError("auth", "No stored credentials — reconnect.");
  }
  const fresh = row.expires_at && new Date(row.expires_at).getTime() - Date.now() > SKEW_MS;
  if (!force && fresh && row.access_token) return row.access_token;
  if (!row.refresh_token) {
    await markNeedsReauth(db, conn, "The sign-in expired and cannot be renewed — reconnect.");
    throw new ProviderError("auth", "The sign-in expired and cannot be renewed — reconnect.");
  }

  try {
    const t = await requestToken(conn, { grant_type: "refresh_token", refresh_token: row.refresh_token });
    // Zoho returns no new refresh token: keep the stored one (store_tokens ignores NULL).
    await storeTokens(db, conn.id, t);
    return t.access_token;
  } catch (e) {
    if (e instanceof ProviderError && e.kind === "auth") {
      await markNeedsReauth(db, conn, `${conn.provider === "xero" ? "Xero" : "Zoho"} no longer accepts the stored sign-in — reconnect to keep syncing. Nothing is lost: transactions wait until then.`);
    }
    throw e;
  }
}

export async function markNeedsReauth(db: SupabaseClient, conn: Pick<Connection, "id">, message: string): Promise<void> {
  await db.from("accounting_v2_connections")
    .update({ status: "needs_reauth", last_error: message, updated_at: new Date().toISOString() })
    .eq("id", conn.id)
    .in("status", ["connected", "error"]);
}
