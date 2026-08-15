import { createHmac, randomBytes } from "node:crypto";

export const STRATEGY_CALL_SESSION_COOKIE = "strategy_call_session";
export const STRATEGY_CALL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createStrategyCallSessionToken(): string {
  return randomBytes(32).toString("base64url");
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
