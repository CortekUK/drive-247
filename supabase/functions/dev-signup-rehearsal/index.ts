// =============================================================================
// dev-signup-rehearsal — the super-admin Developer page's backend.
//
// One row, `public.dev_signup_rehearsal`, and five actions on it. Super admins
// only (checked here; JWT is also required by the platform).
//
//   get       settings + a status snapshot of the rehearsal account
//   save      { email?, linkToNorthwind?, stripeMode? }
//   reset     "Delete me and start again" — see `reset()` below
//   command   { action: 'first_run' | 'quick_tour' } — a one-shot instruction the
//             northwind portal tab picks up (components/dev/dev-bridge.tsx)
//   previews  { previews } — the preview switches the portal mirrors locally
//
// The developer hub (apps/developer, Onboarding tab) has its own actions on
// `public.dev_signup_test_emails`, all starting `test_email`: see test-emails.ts.
//
// WHAT RESET MAY TOUCH, AND NOTHING ELSE
//   - the auth user of the configured rehearsal email (deleted; app_users rows
//     survive because app_users.auth_user_id is ON DELETE SET NULL)
//   - tenants that a rehearsal signup created (proved by a successful
//     `provision` attempt for that email, or by the signup metadata) and that
//     have no other signed-in staff — deleted through admin-delete-tenant,
//     which cancels their Stripe billing first. Never `northwind`.
//   - northwind's own billing rows, first-run row and setup stamp — northwind
//     is the canary and holds synthetic data only (V2_PLAN §1)
//   - Stripe subscriptions on the signup (UAE) account belonging to the above
//   - signup_attempts rows for that email / login, so the throttle starts fresh
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { errorResponse, handleCors, jsonResponse } from "../_shared/cors.ts";
import { SIGNUP_STRIPE_ACCOUNT } from "../_shared/signup-stripe.ts";
import { REHEARSAL_TENANT_SLUG } from "../_shared/signup-rehearsal.ts";
import { SIGNUP_META_KEY } from "../_shared/signup-state.ts";
import {
  cancelSignupSubscription,
  clearSignupThrottle,
  createdBySignup,
  deleteTenantViaAdmin,
  EMAIL_RE,
  findAuthUserByEmail,
  LIVE_STATUSES,
  otherSignedInStaff,
  type Step,
} from "./helpers.ts";
import { handleTestEmailAction, isTestEmailAction } from "./test-emails.ts";

const LOG = "[dev-signup-rehearsal]";
const PORTAL_ACTIONS = new Set(["first_run", "quick_tour"]);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, serviceKey);

  // ---- Super admin only ------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(authHeader.slice(7));
  if (callerError || !caller) return errorResponse("Invalid session", 401);
  const { data: callerRow } = await admin
    .from("app_users")
    .select("id, is_super_admin, is_active")
    .eq("auth_user_id", caller.id)
    .maybeSingle();
  if (!callerRow?.is_super_admin || callerRow.is_active === false) {
    return errorResponse("Only super admins can use the developer tools", 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const action = String(body?.action ?? "");

  if (isTestEmailAction(action)) {
    return await handleTestEmailAction(action, body, {
      admin,
      url,
      serviceKey,
      anonKey,
      authHeader,
      callerAppUserId: callerRow.id,
      callerAuthId: caller.id,
    });
  }

  const readSettings = async () => {
    const { data, error } = await admin.from("dev_signup_rehearsal").select("*").eq("id", 1).maybeSingle();
    if (error) throw new Error(`Could not read the developer settings: ${error.message}`);
    if (!data) throw new Error("The developer settings row is missing — apply 20261006120000_add_dev_signup_rehearsal.sql");
    return data;
  };
  const writeSettings = async (patch: Record<string, unknown>) => {
    const { data, error } = await admin
      .from("dev_signup_rehearsal")
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: caller.id })
      .eq("id", 1)
      .select("*")
      .single();
    if (error) throw new Error(`Could not save the developer settings: ${error.message}`);
    return data;
  };
  const northwind = async () => {
    const { data } = await admin
      .from("tenants")
      .select("id, slug, company_name, setup_completed_at, subscription_stripe_mode")
      .eq("slug", REHEARSAL_TENANT_SLUG)
      .maybeSingle();
    return data;
  };

  try {
    // =========================================================================
    if (action === "get") {
      const settings = await readSettings();
      const email = String(settings.email).toLowerCase();
      const nw = await northwind();
      const authUser = await findAuthUserByEmail(url, serviceKey, email);
      const meta = authUser?.app_metadata?.[SIGNUP_META_KEY] ?? null;

      const { data: staffRows } = await admin
        .from("app_users")
        .select("id, email, auth_user_id, tenant_id, tenants(slug, company_name)")
        .ilike("email", email);
      const memberships = (staffRows || [])
        .filter((r: any) => String(r.email ?? "").toLowerCase() === email)
        .map((r: any) => ({
          tenantId: r.tenant_id,
          slug: r.tenants?.slug ?? null,
          companyName: r.tenants?.company_name ?? null,
          linked: !!r.auth_user_id,
        }));

      let northwindStatus = null;
      if (nw) {
        const [{ data: subs }, { data: firstRun }] = await Promise.all([
          admin
            .from("tenant_subscriptions")
            .select("status, plan_name, stripe_account, created_at")
            .eq("tenant_id", nw.id)
            .order("created_at", { ascending: false })
            .limit(5),
          admin.from("tenant_first_run").select("id").eq("tenant_id", nw.id).maybeSingle(),
        ]);
        northwindStatus = {
          companyName: nw.company_name,
          subscriptions: subs ?? [],
          firstRunDone: !!firstRun,
          setupCompletedAt: nw.setup_completed_at,
        };
      }

      return jsonResponse({
        settings: {
          email: settings.email,
          linkToNorthwind: settings.link_to_northwind,
          stripeMode: settings.stripe_mode,
          portalPreviews: settings.portal_previews ?? {},
          portalCommand: settings.portal_command ?? null,
          lastResetAt: settings.last_reset_at,
          lastResetResult: settings.last_reset_result,
        },
        account: authUser
          ? {
            exists: true,
            createdAt: authUser.created_at,
            providers: authUser.app_metadata?.providers ?? [],
            signup: meta
              ? {
                status: meta.status ?? null,
                mode: meta.mode ?? null,
                linkToNorthwind: meta.rehearsal?.linkToNorthwind ?? null,
                slug: meta.slug ?? null,
              }
              : null,
          }
          : { exists: false },
        memberships,
        northwind: northwindStatus,
      });
    }

    // =========================================================================
    if (action === "save") {
      const patch: Record<string, unknown> = {};
      if (body.email !== undefined) {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return errorResponse("That is not a valid email address", 400);
        patch.email = email;
      }
      if (body.linkToNorthwind !== undefined) patch.link_to_northwind = body.linkToNorthwind === true;
      if (body.stripeMode !== undefined) {
        if (body.stripeMode !== "test" && body.stripeMode !== "live") {
          return errorResponse("Stripe mode must be test or live", 400);
        }
        patch.stripe_mode = body.stripeMode;
      }
      if (!Object.keys(patch).length) return errorResponse("Nothing to save", 400);
      const saved = await writeSettings(patch);
      return jsonResponse({ success: true, settings: saved });
    }

    // =========================================================================
    if (action === "previews") {
      const previews = body.previews;
      if (!previews || typeof previews !== "object" || Array.isArray(previews)) {
        return errorResponse("previews must be an object", 400);
      }
      if (JSON.stringify(previews).length > 4000) return errorResponse("previews is too large", 400);
      await writeSettings({ portal_previews: previews });
      return jsonResponse({ success: true });
    }

    // =========================================================================
    if (action === "command") {
      const portalAction = String(body.portalAction ?? "");
      if (!PORTAL_ACTIONS.has(portalAction)) return errorResponse("Unknown portal action", 400);
      const steps: Step[] = [];
      if (portalAction === "first_run") {
        const nw = await northwind();
        if (!nw) return errorResponse(`No "${REHEARSAL_TENANT_SLUG}" tenant in this database`, 404);
        const { data, error } = await admin.from("tenant_first_run").delete().eq("tenant_id", nw.id).select("id");
        steps.push({
          step: "First-run record",
          ok: !error,
          detail: error ? error.message : data?.length ? "cleared" : "was already clear",
        });
        if (error) return jsonResponse({ success: false, steps }, 500);
      }
      await writeSettings({
        portal_command: { id: crypto.randomUUID(), action: portalAction, at: new Date().toISOString() },
      });
      steps.push({ step: "Portal", ok: true, detail: "queued for the northwind tab" });
      return jsonResponse({ success: true, steps });
    }

    // =========================================================================
    if (action === "reset") {
      const settings = await readSettings();
      const email = String(settings.email).toLowerCase();
      const nw = await northwind();
      const steps: Step[] = [];
      const finish = async (success: boolean, status = 200) => {
        await writeSettings({
          last_reset_at: new Date().toISOString(),
          last_reset_result: { success, steps },
        }).catch((e) => console.error(`${LOG} could not record the reset result:`, e));
        return jsonResponse({ success, steps }, status);
      };

      const authUser = await findAuthUserByEmail(url, serviceKey, email);
      const meta = authUser?.app_metadata?.[SIGNUP_META_KEY] ?? null;

      // ---- 0. Refuse to touch a renter login ---------------------------------
      if (authUser) {
        const { count } = await admin
          .from("customer_users")
          .select("id", { count: "exact", head: true })
          .eq("auth_user_id", authUser.id);
        if ((count ?? 0) > 0) {
          steps.push({
            step: "Safety check",
            ok: false,
            detail: `${email} is also a booking-site renter login — deleting it would remove that too. Nothing was changed.`,
          });
          return await finish(false, 409);
        }
      }

      // ---- 1. Companies a non-linked rehearsal created -----------------------
      const candidateIds = new Set<string>();
      const { data: staffRows } = await admin
        .from("app_users")
        .select("tenant_id, email")
        .ilike("email", email);
      for (const r of staffRows || []) {
        if (String(r.email ?? "").toLowerCase() === email && r.tenant_id) candidateIds.add(r.tenant_id);
      }
      for (const id of [meta?.tenantId, meta?.pendingTenantId]) if (id) candidateIds.add(id);
      if (nw) candidateIds.delete(nw.id);

      for (const tenantId of candidateIds) {
        const { data: t } = await admin.from("tenants").select("id, slug").eq("id", tenantId).maybeSingle();
        if (!t) continue;
        if (t.slug === REHEARSAL_TENANT_SLUG) continue;

        const bySignup = await createdBySignup(admin, tenantId, email, meta);
        const strangers = await otherSignedInStaff(admin, tenantId, email);

        if (!bySignup || strangers > 0) {
          steps.push({
            step: `Company ${t.slug}`,
            ok: true,
            detail: strangers
              ? "left alone: other staff use it"
              : "left alone: it was not created by a rehearsal signup",
          });
          continue;
        }

        const deleted = await deleteTenantViaAdmin(url, anonKey, authHeader, tenantId);
        if (!deleted.ok) {
          steps.push({ step: `Company ${t.slug}`, ok: false, detail: `could not delete: ${deleted.error}` });
          // Stop before the login goes: it is the only pointer left to this company.
          return await finish(false, 500);
        }
        steps.push({ step: `Company ${t.slug}`, ok: true, detail: "deleted (its billing was canceled first)" });
      }

      // ---- 2. Northwind's billing --------------------------------------------
      if (nw) {
        const { data: subs } = await admin
          .from("tenant_subscriptions")
          .select("id, stripe_subscription_id, stripe_account, status")
          .eq("tenant_id", nw.id);
        const handled = new Set<string>();
        for (const sub of subs || []) {
          if (!sub.stripe_subscription_id || !LIVE_STATUSES.includes(sub.status)) continue;
          handled.add(sub.stripe_subscription_id);
          if (sub.stripe_account !== SIGNUP_STRIPE_ACCOUNT) {
            steps.push({
              step: "Northwind subscription",
              ok: false,
              detail: `${sub.stripe_subscription_id} is on the ${sub.stripe_account} account — not canceled, check it by hand`,
            });
            continue;
          }
          try {
            const detail = await cancelSignupSubscription(sub.stripe_subscription_id, ["test", "live"]);
            steps.push({ step: "Northwind subscription", ok: true, detail: `${sub.stripe_subscription_id}: ${detail}` });
          } catch (e) {
            steps.push({ step: "Northwind subscription", ok: false, detail: `${sub.stripe_subscription_id}: ${(e as Error).message}` });
            return await finish(false, 502);
          }
        }

        // A run that paid but never finished provisioning holds a subscription
        // nothing in our database points at.
        if (meta?.stripeSubscriptionId && !handled.has(meta.stripeSubscriptionId) && !meta.tenantId) {
          try {
            const detail = await cancelSignupSubscription(
              meta.stripeSubscriptionId,
              meta.mode === "live" ? ["live"] : ["test"],
              authUser.id,
            );
            steps.push({ step: "Unfinished signup payment", ok: true, detail: `${meta.stripeSubscriptionId}: ${detail}` });
          } catch (e) {
            steps.push({ step: "Unfinished signup payment", ok: false, detail: (e as Error).message });
            return await finish(false, 502);
          }
        }

        const cleared: string[] = [];
        for (const table of ["tenant_subscription_invoices", "tenant_subscriptions", "subscription_plans"]) {
          const { error } = await admin.from(table).delete().eq("tenant_id", nw.id);
          if (error) {
            steps.push({ step: "Northwind billing records", ok: false, detail: `${table}: ${error.message}` });
            return await finish(false, 500);
          }
          cleared.push(table);
        }
        const { error: tenantError } = await admin
          .from("tenants")
          .update({ subscription_plan: "basic", setup_completed_at: null })
          .eq("id", nw.id);
        steps.push({
          step: "Northwind billing records",
          ok: !tenantError,
          detail: tenantError ? tenantError.message : "cleared — Northwind is unsubscribed",
        });

        const { data: fr, error: frError } = await admin
          .from("tenant_first_run")
          .delete()
          .eq("tenant_id", nw.id)
          .select("id");
        steps.push({
          step: "Northwind first run",
          ok: !frError,
          detail: frError ? frError.message : fr?.length ? "cleared — the wizard shows again" : "was already clear",
        });
      }

      // ---- 3. Signup throttle --------------------------------------------------
      {
        const removed = await clearSignupThrottle(admin, email, authUser?.id ?? null);
        steps.push({ step: "Signup limits", ok: true, detail: `${removed} attempt record${removed === 1 ? "" : "s"} cleared` });
      }

      // ---- 4. The login itself -------------------------------------------------
      if (authUser) {
        const { error } = await admin.auth.admin.deleteUser(authUser.id);
        if (error) {
          steps.push({ step: "Login", ok: false, detail: error.message });
          return await finish(false, 500);
        }
        steps.push({ step: "Login", ok: true, detail: `${email} deleted — staff records kept, now without a login` });
      } else {
        steps.push({ step: "Login", ok: true, detail: `${email} had no login` });
      }

      console.log(`${LOG} reset by ${caller.id} for ${email}:`, JSON.stringify(steps));
      return await finish(true);
    }

    return errorResponse("Unknown action", 400);
  } catch (e) {
    console.error(`${LOG} ${action} failed:`, e);
    return errorResponse((e as Error)?.message || "Internal error", 500);
  }
});
