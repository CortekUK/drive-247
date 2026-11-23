// =============================================================================
// The developer hub's test emails (apps/developer, Onboarding tab).
//
// `public.dev_signup_test_emails` lists addresses whose signup runs on TEST
// Stripe (read by _shared/signup-rehearsal.ts when a signup starts). These
// actions keep that list and undo what a test run left behind. The caller is
// already checked as a super admin by index.ts.
//
//   test_emails        the list, each with where its signup got to and what a
//                      reset would remove (or why it would refuse)
//   test_email_add     { email }
//   test_email_set     { email, enabled }
//   test_email_remove  { email }       only the list row; the account stays
//   test_email_reset   { email }       remove what the address left behind
//
// WHAT A RESET MAY TOUCH, AND NOTHING ELSE
//   - companies a signup by that address created, with no other signed-in
//     staff, deleted through admin-delete-tenant (which cancels their Stripe
//     billing first). Never `northwind`.
//   - a test subscription a signup started but never finished building
//   - signup_attempts rows for that address, so the throttle starts fresh
//   - the address's login (auth user), which also clears its signup progress
//
// A RESET REFUSES, AND CHANGES NOTHING, WHEN
//   - the address is not on the list
//   - the login is also a booking-site renter login
//   - the address is a super admin, or signed-in staff at a company it keeps
//     (deleting the login would lock them out of it)
//   - anything it would remove is paying on LIVE Stripe: real money is never
//     touched from here
// =============================================================================

import { errorResponse, jsonResponse } from "../_shared/cors.ts";
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

const LOG = "[dev-signup-rehearsal:test-emails]";
const TABLE = "dev_signup_test_emails";

/**
 * Set on the login's user_metadata while a signup has a stand-in password the
 * person has not replaced yet (apps/web/src/components/onboarding/signup-stand-in.ts).
 */
const PASSWORD_PENDING_META_KEY = "d247_signup_password_pending";

const ACTIONS = new Set(["test_emails", "test_email_add", "test_email_set", "test_email_remove", "test_email_reset"]);

export function isTestEmailAction(action: string): boolean {
  return ACTIONS.has(action);
}

export interface TestEmailContext {
  admin: any;
  url: string;
  serviceKey: string;
  anonKey: string;
  authHeader: string;
  callerAppUserId: string;
  callerAuthId: string;
}

type Tone = "clean" | "progress" | "done" | "error";

interface CompanyFootprint {
  id: string;
  slug: string;
  companyName: string | null;
  stripeMode: "test" | "live";
  subscription: { status: string; planName: string | null } | null;
  /** True when a reset deletes it. */
  remove: boolean;
  /** Why it stays, when it stays. */
  keepReason: string | null;
}

interface Footprint {
  email: string;
  authUser: any | null;
  meta: any | null;
  companies: CompanyFootprint[];
  /** Anything here makes the reset refuse. */
  blockers: string[];
  /** What the reset would remove, in plain words, in the order it does it. */
  removes: string[];
  /** A test subscription a signup paid for but never attached to a company. */
  unfinishedPayment: string | null;
}

function normalise(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/** Where the address's signup got to, from what the server knows. */
function progressOf(fp: Footprint): { label: string; tone: Tone } {
  const { authUser, meta, companies } = fp;
  const built = companies.find((c) => c.remove);
  if (!authUser) {
    return built
      ? { label: `No login, but its company ${built.slug} is still there`, tone: "progress" }
      : { label: "Clean. Ready for a new signup", tone: "clean" };
  }
  if (!meta) return { label: "Has a login, but no signup on record", tone: "progress" };
  switch (meta.status) {
    case "account_created": {
      if (meta.otp && !meta.emailVerifiedAt) return { label: "Email code sent, not entered yet", tone: "progress" };
      if (authUser.user_metadata?.[PASSWORD_PENDING_META_KEY] === true) {
        return { label: "Email confirmed, password not chosen yet", tone: "progress" };
      }
      return { label: "Account made, not paid yet", tone: "progress" };
    }
    case "payment_pending":
      return { label: "On the card step, not paid yet", tone: "progress" };
    case "paid":
      return { label: "Paid, company not built yet", tone: "progress" };
    case "provisioning":
      return { label: "Building the company", tone: "progress" };
    case "provisioned":
      return { label: `Company created${built || meta.slug ? `: ${built?.slug ?? meta.slug}` : ""}`, tone: "done" };
    case "failed":
      return { label: `Stopped with an error${meta.lastError?.message ? `: ${meta.lastError.message}` : ""}`, tone: "error" };
    default:
      return { label: `Signup status: ${String(meta.status ?? "unknown")}`, tone: "progress" };
  }
}

/** Everything the address has left behind, and what a reset would do about it. */
async function footprintOf(ctx: TestEmailContext, email: string): Promise<Footprint> {
  const { admin } = ctx;
  const authUser = await findAuthUserByEmail(ctx.url, ctx.serviceKey, email);
  const meta = authUser?.app_metadata?.[SIGNUP_META_KEY] ?? null;
  const blockers: string[] = [];
  const removes: string[] = [];

  if (authUser) {
    const { count } = await admin
      .from("customer_users")
      .select("id", { count: "exact", head: true })
      .eq("auth_user_id", authUser.id);
    if ((count ?? 0) > 0) blockers.push("This login is also a booking-site renter login. Deleting it would remove that too.");
  }

  // ilike narrows in Postgres; the JS check is exact, so `_` cannot wildcard.
  const { data: staffMatches } = await admin
    .from("app_users")
    .select("id, email, tenant_id, auth_user_id, is_super_admin")
    .ilike("email", email);
  const staff = (staffMatches || []).filter((r: any) => normalise(r.email) === email);
  if (staff.some((r: any) => r.is_super_admin === true || (!r.tenant_id && r.auth_user_id))) {
    blockers.push("This address is a super admin. Its login is never deleted from here.");
  }

  const tenantIds = new Set<string>();
  for (const r of staff) if (r.tenant_id) tenantIds.add(r.tenant_id);
  for (const id of [meta?.tenantId, meta?.pendingTenantId]) if (id) tenantIds.add(id);

  const companies: CompanyFootprint[] = [];
  for (const tenantId of tenantIds) {
    const { data: t } = await admin
      .from("tenants")
      .select("id, slug, company_name, subscription_stripe_mode")
      .eq("id", tenantId)
      .maybeSingle();
    if (!t) continue;
    const { data: subs } = await admin
      .from("tenant_subscriptions")
      .select("status, plan_name, created_at")
      .eq("tenant_id", t.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const current = (subs || []).find((s: any) => LIVE_STATUSES.includes(s.status)) ?? null;
    const stripeMode: "test" | "live" = t.subscription_stripe_mode === "live" ? "live" : "test";

    let keepReason: string | null = null;
    if (t.slug === REHEARSAL_TENANT_SLUG) keepReason = "northwind is never deleted";
    else if (!(await createdBySignup(admin, t.id, email, meta))) keepReason = "not created by this address's signup";
    else if ((await otherSignedInStaff(admin, t.id, email)) > 0) keepReason = "other staff use it";

    const company: CompanyFootprint = {
      id: t.id,
      slug: t.slug,
      companyName: t.company_name ?? null,
      stripeMode,
      subscription: current ? { status: current.status, planName: current.plan_name ?? null } : null,
      remove: keepReason === null,
      keepReason,
    };
    companies.push(company);

    if (company.remove) {
      if (current && stripeMode === "live") {
        blockers.push(`${t.slug} has a LIVE subscription (${current.status}). Cancel and delete it from the admin dashboard instead.`);
      }
      removes.push(
        `Company ${t.slug}${current ? `, after canceling its test subscription (${current.status})` : ""}`,
      );
    } else {
      const signedIn = staff.some((r: any) => r.tenant_id === t.id && r.auth_user_id);
      if (signedIn) {
        blockers.push(`This address is signed-in staff at ${t.slug} (${keepReason}). Deleting the login would lock them out.`);
      }
    }
  }

  // A run that paid but never built its company holds a subscription nothing
  // in our database points at.
  let unfinishedPayment: string | null = null;
  if (meta?.stripeSubscriptionId && !meta.tenantId) {
    unfinishedPayment = String(meta.stripeSubscriptionId);
    if (meta.mode === "live") {
      blockers.push(`The unfinished signup started a LIVE subscription (${unfinishedPayment}). Check it in Stripe by hand.`);
    } else {
      removes.push(`The unfinished signup's test subscription (${unfinishedPayment})`);
    }
  }

  removes.push("The signup attempt limits for this address");
  if (authUser) removes.push(`The login ${email}, and with it the half-finished signup`);

  return { email, authUser, meta, companies, blockers, removes, unfinishedPayment };
}

function viewOf(row: any, fp: Footprint) {
  return {
    email: row.email,
    enabled: row.enabled === true,
    createdAt: row.created_at,
    lastResetAt: row.last_reset_at ?? null,
    lastResetResult: row.last_reset_result ?? null,
    progress: progressOf(fp),
    login: fp.authUser
      ? {
        exists: true,
        createdAt: fp.authUser.created_at,
        providers: fp.authUser.app_metadata?.providers ?? [],
        stripeMode: fp.meta?.mode ?? null,
      }
      : { exists: false },
    companies: fp.companies.map((c) => ({
      slug: c.slug,
      companyName: c.companyName,
      stripeMode: c.stripeMode,
      subscription: c.subscription,
      remove: c.remove,
      keepReason: c.keepReason,
    })),
    reset: { blockers: fp.blockers, removes: fp.removes },
  };
}

async function readRow(admin: any, email: string) {
  const { data, error } = await admin.from(TABLE).select("*").eq("email", email).maybeSingle();
  if (error) throw new Error(`Could not read the test emails: ${error.message}`);
  return data;
}

export async function handleTestEmailAction(action: string, body: any, ctx: TestEmailContext): Promise<Response> {
  const { admin } = ctx;
  try {
    // =========================================================================
    if (action === "test_emails") {
      const { data: rows, error } = await admin.from(TABLE).select("*").order("created_at", { ascending: true });
      if (error) throw new Error(`Could not read the test emails: ${error.message}`);
      const emails = await Promise.all(
        (rows || []).map(async (row: any) => {
          try {
            return viewOf(row, await footprintOf(ctx, row.email));
          } catch (e) {
            console.error(`${LOG} status for ${row.email} failed:`, e);
            return {
              ...viewOf(row, {
                email: row.email,
                authUser: null,
                meta: null,
                companies: [],
                blockers: ["Could not read this address's status. Try again."],
                removes: [],
                unfinishedPayment: null,
              }),
              progress: { label: "Could not read the status", tone: "error" as Tone },
            };
          }
        }),
      );
      return jsonResponse({ emails });
    }

    const email = normalise(body?.email);
    if (!EMAIL_RE.test(email)) return errorResponse("That is not a valid email address", 400);

    // =========================================================================
    if (action === "test_email_add") {
      if (await readRow(admin, email)) return errorResponse(`${email} is already on the list`, 409);
      const { error } = await admin.from(TABLE).insert({ email, enabled: true, created_by: ctx.callerAppUserId });
      if (error) throw new Error(`Could not add ${email}: ${error.message}`);
      console.log(`${LOG} ${ctx.callerAuthId} added ${email}`);
      return jsonResponse({ success: true });
    }

    const row = await readRow(admin, email);
    if (!row) return errorResponse(`${email} is not on the test list`, 404);

    // =========================================================================
    if (action === "test_email_set") {
      if (typeof body?.enabled !== "boolean") return errorResponse("enabled must be true or false", 400);
      const { error } = await admin.from(TABLE).update({ enabled: body.enabled }).eq("id", row.id);
      if (error) throw new Error(`Could not save ${email}: ${error.message}`);
      console.log(`${LOG} ${ctx.callerAuthId} set ${email} enabled=${body.enabled}`);
      return jsonResponse({ success: true });
    }

    // =========================================================================
    if (action === "test_email_remove") {
      const { error } = await admin.from(TABLE).delete().eq("id", row.id);
      if (error) throw new Error(`Could not remove ${email}: ${error.message}`);
      console.log(`${LOG} ${ctx.callerAuthId} removed ${email}`);
      return jsonResponse({ success: true });
    }

    // =========================================================================
    if (action === "test_email_reset") {
      const steps: Step[] = [];
      const finish = async (success: boolean, status = 200) => {
        const { error } = await admin
          .from(TABLE)
          .update({ last_reset_at: new Date().toISOString(), last_reset_result: { success, steps } })
          .eq("id", row.id);
        if (error) console.error(`${LOG} could not record the reset result for ${email}:`, error.message);
        return jsonResponse({ success, steps }, status);
      };

      const fp = await footprintOf(ctx, email);
      if (fp.blockers.length) {
        for (const b of fp.blockers) steps.push({ step: "Safety check", ok: false, detail: b });
        steps.push({ step: "Nothing changed", ok: false, detail: "The reset stopped before touching anything." });
        return await finish(false, 409);
      }

      // ---- 1. Companies its signups created ----------------------------------
      for (const c of fp.companies) {
        if (!c.remove) {
          steps.push({ step: `Company ${c.slug}`, ok: true, detail: `left alone: ${c.keepReason}` });
          continue;
        }
        const deleted = await deleteTenantViaAdmin(ctx.url, ctx.anonKey, ctx.authHeader, c.id);
        if (!deleted.ok) {
          steps.push({ step: `Company ${c.slug}`, ok: false, detail: `could not delete: ${deleted.error}` });
          // Stop before the login goes: it is the only pointer left to this company.
          return await finish(false, 500);
        }
        steps.push({ step: `Company ${c.slug}`, ok: true, detail: "deleted (its billing was canceled first)" });
      }

      // ---- 2. A test payment that never became a company ---------------------
      if (fp.unfinishedPayment) {
        try {
          const detail = await cancelSignupSubscription(fp.unfinishedPayment, ["test"], fp.authUser?.id);
          steps.push({ step: "Unfinished signup payment", ok: true, detail: `${fp.unfinishedPayment}: ${detail}` });
        } catch (e) {
          steps.push({ step: "Unfinished signup payment", ok: false, detail: (e as Error).message });
          return await finish(false, 502);
        }
      }

      // ---- 3. Signup throttle --------------------------------------------------
      const removed = await clearSignupThrottle(admin, email, fp.authUser?.id ?? null);
      steps.push({ step: "Signup limits", ok: true, detail: `${removed} attempt record${removed === 1 ? "" : "s"} cleared` });

      // ---- 4. The login itself -------------------------------------------------
      if (fp.authUser) {
        const { error } = await admin.auth.admin.deleteUser(fp.authUser.id);
        if (error) {
          steps.push({ step: "Login", ok: false, detail: error.message });
          return await finish(false, 500);
        }
        steps.push({ step: "Login", ok: true, detail: `${email} deleted, with its half-finished signup` });
      } else {
        steps.push({ step: "Login", ok: true, detail: `${email} had no login` });
      }

      console.log(`${LOG} reset by ${ctx.callerAuthId} for ${email}:`, JSON.stringify(steps));
      return await finish(true);
    }

    return errorResponse("Unknown action", 400);
  } catch (e) {
    console.error(`${LOG} ${action} failed:`, e);
    return errorResponse((e as Error)?.message || "Internal error", 500);
  }
}
