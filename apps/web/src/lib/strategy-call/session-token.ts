import { createHmac, randomBytes } from "node:crypto";

export const STRATEGY_CALL_SESSION_COOKIE = "strategy_call_session";
export const STRATEGY_CALL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createStrategyCallSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The HMAC key that session tokens are hashed under.
 *
 * A dedicated STRATEGY_CALL_SESSION_PEPPER is preferred and is what production
 * should set. But this feature already requires SUPABASE_SERVICE_ROLE_KEY for
 * every one of its database writes, so when no pepper is configured we derive a
 * stable one from that key rather than refuse to take the booking. That keeps
 * the property the pepper exists for — the key is server-only and never stored
 * in the database, so stealing the database still does not let anyone forge a
 * session — while halving the number of variables a deploy has to get right.
 *
 * The label gives domain separation: the derived value cannot collide with any
 * other use of the service-role key.
 *
 * Returns null only when neither secret is available, which is a genuine
 * misconfiguration the caller must surface rather than paper over.
 */
export function resolveStrategyCallPepper(): string | null {
  const configured = process.env.STRATEGY_CALL_SESSION_PEPPER;
  if (configured && configured.length >= 16) return configured;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey && serviceRoleKey.length >= 16) {
    return createHmac("sha256", serviceRoleKey)
      .update("drive247:strategy-call-session-pepper:v1", "utf8")
      .digest("hex");
  }

  return null;
}

export function hashStrategyCallSessionToken(
  token: string,
  pepper: string
): string {
  if (token.length < 32 || pepper.length < 16) {
    throw new Error("Strategy-call session security is not configured");
  }
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}

export function hashStrategyCallSubmissionSource(
  source: string,
  pepper: string
): string {
  if (!source || pepper.length < 16) {
    throw new Error("Strategy-call submission security is not configured");
  }
  return createHmac("sha256", pepper)
    .update(`submission:${source}`, "utf8")
    .digest("hex");
}
