/**
 * Accounting sync v2 — who is calling, for which tenant.
 *
 * Scoped users are pinned to their own tenant (resolve-tenant.ts); only a super
 * admin may name one, by slug. Connecting, mapping and disconnecting need
 * admin / head_admin (or super admin acting for the tenant).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveTenantId } from "../resolve-tenant.ts";

export interface Caller {
  db: SupabaseClient;
  appUserId: string;
  tenantId: string;
  canManage: boolean;
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
}

export async function resolveCaller(req: Request, body: Record<string, unknown>): Promise<Caller | { error: string; status: number }> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return { error: "Unauthorised", status: 401 };
  const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return { error: "Unauthorised", status: 401 };

  const db = serviceClient();
  const { data: appUser } = await db.from("app_users")
    .select("id, tenant_id, role, is_super_admin").eq("auth_user_id", u.user.id).maybeSingle();
  if (!appUser) return { error: "App user not found", status: 403 };

  const r = await resolveTenantId(db, req, appUser, (body.tenantSlug as string | null) ?? null, null);
  if (!r.tenantId) return { error: r.errorMessage ?? "No tenant context", status: r.errorStatus };

  return {
    db,
    appUserId: appUser.id,
    tenantId: r.tenantId,
    canManage: !!appUser.is_super_admin || ["admin", "head_admin"].includes(appUser.role ?? ""),
  };
}
