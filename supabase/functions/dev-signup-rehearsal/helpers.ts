// =============================================================================
// Shared by the two resets in this function: the Developer page's rehearsal
// reset (index.ts) and the developer hub's test-email reset (test-emails.ts).
// =============================================================================

import { getSignupStripeClient } from "../_shared/signup-stripe.ts";

export const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type Step = { step: string; ok: boolean; detail: string };

/** Exact-address auth user lookup (GoTrue `?filter=` is a partial match). */
export async function findAuthUserByEmail(url: string, serviceKey: string, email: string): Promise<any | null> {
  const res = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=20`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`GoTrue admin lookup failed (${res.status})`);
  const body = await res.json().catch(() => null);
  const users: any[] = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => String(u?.email ?? "").toLowerCase() === email) ?? null;
}

/** Cancel a subscription on the signup account, trying the given modes in order. */
export async function cancelSignupSubscription(
  subscriptionId: string,
  modes: Array<"test" | "live">,
  mustBelongTo?: string,
): Promise<string> {
  for (const mode of modes) {
    let stripe;
    try {
      stripe = getSignupStripeClient(mode);
    } catch {
      continue;
    }
    let sub: any;
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e: any) {
      if (e?.code === "resource_missing" || e?.statusCode === 404) continue;
      throw e;
    }
    if (mustBelongTo && sub.metadata?.d247_signup_auth_user !== mustBelongTo) {
      return `left alone (${mode}): not started by the rehearsal login`;
    }
    if (sub.status === "canceled" || sub.status === "incomplete_expired") return `already ${sub.status} (${mode})`;
    await stripe.subscriptions.cancel(subscriptionId);
    return `canceled (${mode})`;
  }
  return "not found on the signup account";
}

/**
 * Clear the signup throttle for an address so its next signup starts fresh:
 * its own attempt rows, its login's rows, and the last day's rows from the IP
 * addresses it signed up from. Returns how many rows went.
 */
export async function clearSignupThrottle(admin: any, email: string, authUserId: string | null): Promise<number> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { data: mine } = await admin
    .from("signup_attempts")
    .select("ip_address")
    .ilike("email", email)
    .gte("created_at", since);
  const ips = [...new Set((mine || []).map((r: any) => r.ip_address).filter(Boolean))];
  let removed = 0;
  const del = async (q: any) => {
    const { data } = await q.select("id");
    removed += data?.length ?? 0;
  };
  await del(admin.from("signup_attempts").delete().ilike("email", email));
  if (authUserId) await del(admin.from("signup_attempts").delete().eq("auth_user_id", authUserId));
  if (ips.length) {
    await del(admin.from("signup_attempts").delete().in("ip_address", ips).gte("created_at", since));
  }
  return removed;
}

/** Did a signup by `email` create this tenant? Proved by the signup metadata or a successful provision. */
export async function createdBySignup(admin: any, tenantId: string, email: string, meta: any): Promise<boolean> {
  if (tenantId === meta?.tenantId || tenantId === meta?.pendingTenantId) return true;
  const { count } = await admin
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("scope", "provision")
    .eq("outcome", "ok")
    .eq("tenant_id", tenantId)
    .ilike("email", email);
  return (count ?? 0) > 0;
}

/** Signed-in staff of a tenant other than `email`. */
export async function otherSignedInStaff(admin: any, tenantId: string, email: string): Promise<number> {
  const { data } = await admin
    .from("app_users")
    .select("id, email")
    .eq("tenant_id", tenantId)
    .not("auth_user_id", "is", null);
  return (data || []).filter((u: any) => String(u.email ?? "").toLowerCase() !== email).length;
}

/** Delete a tenant through admin-delete-tenant (it cancels the tenant's Stripe billing first). */
export async function deleteTenantViaAdmin(
  url: string,
  anonKey: string,
  authHeader: string,
  tenantId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const res = await fetch(`${url}/functions/v1/admin-delete-tenant`, {
    method: "POST",
    headers: { Authorization: authHeader, apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.error) return { ok: false, error: String(out?.error ?? res.status) };
  return { ok: true, error: null };
}
