import { cookies } from "next/headers";
import { getStrategyCallAdminClient } from "./supabase-admin";
import {
  hashStrategyCallSessionToken,
  resolveStrategyCallPepper,
  STRATEGY_CALL_SESSION_COOKIE,
} from "./session-token";

export type StrategyCallSession = {
  id: string;
  contactRequestId: string;
  status: "qualified" | "calendar_opened" | "booked" | "cancelled";
  expiresAt: string;
};

export async function resolveStrategyCallSessionToken(
  token: string | undefined,
  options: { touch?: boolean } = {}
): Promise<StrategyCallSession | null> {
  if (!token || token.length > 256) return null;

  const pepper = resolveStrategyCallPepper();
  if (!pepper) return null;

  let tokenHash: string;
  try {
    tokenHash = hashStrategyCallSessionToken(token, pepper);
  } catch {
    return null;
  }

  const supabase = getStrategyCallAdminClient();
  const { data, error } = await supabase
    .from("strategy_call_sessions")
    .select("id, contact_request_id, status, expires_at, last_seen_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  const expiresAt = new Date(data.expires_at).getTime();
  const allowedStatuses = new Set([
    "qualified",
    "calendar_opened",
    "booked",
    "cancelled",
  ]);
  if (
    !allowedStatuses.has(data.status) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    await supabase
      .from("strategy_call_sessions")
      .update({ status: "expired", last_seen_at: new Date().toISOString() })
      .eq("id", data.id)
      .neq("status", "expired");
    return null;
  }

  const lastSeenAt = data.last_seen_at
    ? new Date(data.last_seen_at).getTime()
    : Number.NaN;
  if (
    options.touch !== false &&
    (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= 5 * 60 * 1000)
  ) {
    await supabase
      .from("strategy_call_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", data.id)
      .or(
        `last_seen_at.is.null,last_seen_at.lt.${new Date(
          Date.now() - 5 * 60 * 1000
        ).toISOString()}`
      );
  }

  return {
    id: data.id,
    contactRequestId: data.contact_request_id,
    status: data.status,
    expiresAt: data.expires_at,
  };
}

export async function getStrategyCallSession(): Promise<StrategyCallSession | null> {
  const cookieStore = await cookies();
  return resolveStrategyCallSessionToken(
    cookieStore.get(STRATEGY_CALL_SESSION_COOKIE)?.value
  );
}
