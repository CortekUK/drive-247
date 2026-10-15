// custom-domain — a tenant connects their own domain, self-serve.
//
// Called by the tenant's portal user from Integrations → Custom Domain. The
// tenant is always the caller's own (from app_users), never one named in the
// body. Only tenants in SELF_SERVE_SLUGS may use it; everyone else keeps the
// manual handoff panel.
//
//   { action: "records", domain }   the DNS records to add (no writes)
//   { action: "connect", domain }   "I've added them": adds the domain to our
//                                   Vercel projects, saves it on the tenant,
//                                   and checks straight away
//   { action: "check" }             re-checks a saved domain now
//   { action: "disconnect" }        removes it from Vercel and the tenant
//
// custom-domain-run keeps checking pending domains every 5 minutes and emails
// the operator when one goes live, so nobody has to keep this screen open.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  SELF_SERVE_SLUGS,
  VercelError,
  checkAndRecord,
  connectDomain,
  disconnectDomain,
  hostsFor,
  normalizeDomain,
  recommendedRecords,
  validateDomain,
} from "../_shared/custom-domain.ts";

/** Who may connect, change or remove the domain. Any staff may read and re-check. */
const MANAGE_ROLES = new Set(["head_admin", "admin"]);

const TENANT_COLUMNS =
  "id, slug, custom_booking_domain, custom_portal_domain, custom_domain_status, custom_domain_detail, custom_domain_records, custom_domain_requested_at, custom_domain_checked_at, custom_domain_live_at";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await db
      .from("app_users")
      .select("id, tenant_id, role, is_active")
      .eq("auth_user_id", user.id)
      .not("tenant_id", "is", null)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Unauthorized", 401);

    const loadTenant = async () => {
      const { data, error } = await db.from("tenants").select(TENANT_COLUMNS).eq("id", appUser.tenant_id).single();
      if (error) throw error;
      return data;
    };
    let tenant = await loadTenant();
    if (!SELF_SERVE_SLUGS.includes(tenant.slug)) {
      return errorResponse("Self-serve custom domains are not available on this account yet.", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const canManage = MANAGE_ROLES.has(appUser.role);

    /* ── records ── */
    if (action === "records") {
      const domain = normalizeDomain(body?.domain);
      const problem = validateDomain(domain);
      if (problem) return errorResponse(problem, 400);
      return jsonResponse({ domain, records: await recommendedRecords(domain) });
    }

    /* ── connect ── */
    if (action === "connect") {
      if (!canManage) return errorResponse("Only an admin or head admin can connect a domain.", 403);
      const domain = normalizeDomain(body?.domain);
      const problem = validateDomain(domain);
      if (problem) return errorResponse(problem, 400);
      const h = hostsFor(domain);

      // The routing columns are UNIQUE; say so plainly before touching Vercel.
      const { data: taken } = await db
        .from("tenants")
        .select("id")
        .neq("id", tenant.id)
        .or(`custom_booking_domain.eq.${h.apex},custom_portal_domain.eq.${h.portal}`)
        .limit(1);
      if (taken?.length) {
        return errorResponse(
          "That domain is already connected to another Drive247 account. If it's yours, email support@drive-247.com.",
          409,
        );
      }

      const previous = tenant.custom_booking_domain;
      await connectDomain(domain);

      const { error: writeError } = await db.from("tenants").update({
        custom_booking_domain: h.apex,
        custom_portal_domain: h.portal,
        custom_domain_status: "pending",
        custom_domain_detail: "Checking your records…",
        custom_domain_records: null,
        custom_domain_live_at: null,
        custom_domain_requested_at: new Date().toISOString(),
      }).eq("id", tenant.id);
      if (writeError) {
        if (previous !== domain) await disconnectDomain(domain).catch(() => {});
        throw writeError;
      }

      // A different domain replaces the old one: take the old names off our
      // projects so they cannot keep pointing at this tenant.
      if (previous && previous !== domain) {
        await disconnectDomain(previous).catch((e) => console.error("old domain cleanup failed:", e));
      }

      tenant = await loadTenant();
      await checkAndRecord(db, tenant);
      return jsonResponse({ tenant: await loadTenant() });
    }

    /* ── check ── */
    if (action === "check") {
      if (!tenant.custom_booking_domain) return jsonResponse({ tenant });
      // "Check again" after a give-up restarts the clock.
      if (tenant.custom_domain_status === "error") {
        await db.from("tenants").update({
          custom_domain_status: "pending",
          custom_domain_requested_at: new Date().toISOString(),
        }).eq("id", tenant.id);
        tenant = await loadTenant();
      }
      await checkAndRecord(db, tenant);
      return jsonResponse({ tenant: await loadTenant() });
    }

    /* ── disconnect ── */
    if (action === "disconnect") {
      if (!canManage) return errorResponse("Only an admin or head admin can remove a domain.", 403);
      if (tenant.custom_booking_domain) await disconnectDomain(tenant.custom_booking_domain);
      await db.from("tenants").update({
        custom_booking_domain: null,
        custom_portal_domain: null,
        custom_domain_status: null,
        custom_domain_detail: null,
        custom_domain_records: null,
        custom_domain_requested_at: null,
        custom_domain_checked_at: null,
        custom_domain_live_at: null,
      }).eq("id", tenant.id);
      return jsonResponse({ tenant: await loadTenant() });
    }

    return errorResponse("Unknown action", 400);
  } catch (e) {
    if (e instanceof VercelError) return errorResponse(e.message, e.status >= 500 ? 502 : e.status);
    console.error("custom-domain failed:", e);
    return errorResponse("Something went wrong. Please try again.", 500);
  }
});
