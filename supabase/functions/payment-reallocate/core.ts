// payment-reallocate — reconciliation without blockers (docs/PAYMENTS_ROADMAP.md
// Wave 2, spec §5.3). Everything the function does lives here, free of Deno
// globals, so the offline suite (tests/payment-plans/reallocation/) drives the
// real handler against real Postgres through a PGlite-backed client.
//
// POST { action, ... } with the operator's JWT (verify_jwt = true):
//
//   reallocate         { paymentId, targets: [{ chargeEntryId, amountCents }], reason, note? }
//                      → { ok, auditId, before, after }
//                      targets is the payment's COMPLETE new allocation (a
//                      charge it leaves out is un-applied; [] = all to credit).
//   recompute_charge   { chargeEntryId, reason, note? }
//                      → { ok, auditId, before, after }
//   reconcile_options  { rentalId, extensionId? }            (read only)
//                      → { ok, options }   (bill_reconcile_options, verbatim)
//   history            { rentalId } | { paymentId }, limit?  (read only)
//                      → { ok, changes: [...] } newest first
//
// Money is INTEGER CENTS everywhere in and out (amountCents, *_cents).
//
// WHO: the caller's own token, never the body — the same shape as
// adjust-customer-balance's v2 resolveCaller (Wave 1), tightened to the roles
// this operation names:
//   writes  head_admin, admin, a manager with an EDITOR grant on the payments
//           tab, or a super admin. ops and viewer are refused: moving money
//           between charges rewrites what a customer owes.
//   reads   any active staff of the company, except a manager with no grant on
//           the payments tab at all.
// The company is taken from the ROW the request names (the payment, charge or
// rental), never from the body. A member of staff with rows in several
// companies is matched to the row's company (app_users.auth_user_id is not
// unique — maybeSingle() would lock them out).
// The SQL functions check the operator against the company again.
//
// CANARY: northwind only (PAYMENT_RECONCILE_TENANT_SLUGS overrides), like
// payment plans and Finances v2.
//
// ERRORS: the SQL functions raise '<code>: <sentence>'. The code picks the
// status; the sentence goes to the operator unchanged:
//   400 invalid_input · 403 forbidden · 404 not_found
//   422 a rule the operator can fix by changing the amounts
//   409 the state of the payment / charge forbids it
//   500 write_failed (nothing was changed) or anything unexpected
//   503 the migration is not applied yet
// Every supabase-js call's { error } is checked; none of them throws.

import { handleCors, jsonResponse } from "../_shared/cors.ts";

// ─── The client surface this function uses (so a test can hand in a fake) ────

export interface QueryResult<T = any> {
  data: T;
  error: { message?: string; code?: string; details?: string | null; hint?: string | null } | null;
}

export interface DbClientLike {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
  auth: { getUser: (jwt: string) => PromiseLike<{ data: { user: { id: string } | null } | null; error: any }> };
}

export interface ReallocateDeps {
  /** A SERVICE-ROLE client: app_users / manager_permissions must not be RLS-filtered. */
  createAdminClient: () => DbClientLike;
  /** Comma-separated tenant slugs this endpoint serves. Default "northwind". */
  tenantSlugs?: string | null;
}

// ─── Requests ────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type ReallocateRequest =
  | {
      action: "reallocate";
      paymentId: string;
      targets: { chargeEntryId: string; amountCents: number }[];
      reason: string;
      note: string | null;
    }
  | { action: "recompute_charge"; chargeEntryId: string; reason: string; note: string | null }
  | { action: "reconcile_options"; rentalId: string; extensionId: string | null }
  | { action: "history"; rentalId: string | null; paymentId: string | null; limit: number };

export class RequestError extends Error {
  constructor(readonly status: number, message: string, readonly code = "invalid_input") {
    super(message);
  }
}

function reasonOf(body: Record<string, unknown>): { reason: string; note: string | null } {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new RequestError(400, "Say why (a reason is required).");
  if (reason.length > 200) throw new RequestError(400, "The reason is longer than 200 characters — put the detail in the note.");
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") throw new RequestError(400, "note must be text.");
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  if (note && note.length > 2000) throw new RequestError(400, "The note is longer than 2000 characters.");
  return { reason, note };
}

/** Validate the body's shape. Every id is a uuid; every amount is whole positive cents. */
export function parseRequest(body: unknown): ReallocateRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Body must be a JSON object.");
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case "reallocate": {
      if (!isUuid(b.paymentId)) throw new RequestError(400, "paymentId is required.");
      if (!Array.isArray(b.targets)) throw new RequestError(400, "targets must be a list of { chargeEntryId, amountCents }.");
      const seen = new Set<string>();
      const targets = b.targets.map((t, i) => {
        if (!t || typeof t !== "object") throw new RequestError(400, `targets[${i}] must be { chargeEntryId, amountCents }.`);
        const x = t as Record<string, unknown>;
        for (const k of Object.keys(x)) {
          if (k !== "chargeEntryId" && k !== "amountCents") {
            throw new RequestError(400, `targets[${i}] has an unknown field "${k}" — money is amountCents (integer cents).`);
          }
        }
        if (!isUuid(x.chargeEntryId)) throw new RequestError(400, `targets[${i}].chargeEntryId must be a charge id.`);
        const cents = x.amountCents;
        if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) {
          throw new RequestError(400, `targets[${i}].amountCents must be a positive whole number of cents.`);
        }
        const id = (x.chargeEntryId as string).toLowerCase();
        if (seen.has(id)) throw new RequestError(400, "A charge is listed twice — give each charge one amount.");
        seen.add(id);
        return { chargeEntryId: id, amountCents: cents };
      });
      return { action: "reallocate", paymentId: b.paymentId, targets, ...reasonOf(b) };
    }
    case "recompute_charge": {
      if (!isUuid(b.chargeEntryId)) throw new RequestError(400, "chargeEntryId is required.");
      return { action: "recompute_charge", chargeEntryId: b.chargeEntryId, ...reasonOf(b) };
    }
    case "reconcile_options": {
      if (!isUuid(b.rentalId)) throw new RequestError(400, "rentalId is required.");
      if (b.extensionId !== undefined && b.extensionId !== null && !isUuid(b.extensionId)) {
        throw new RequestError(400, "extensionId must be an extension id.");
      }
      return { action: "reconcile_options", rentalId: b.rentalId, extensionId: (b.extensionId as string | undefined) ?? null };
    }
    case "history": {
      const rentalId = b.rentalId ?? null;
      const paymentId = b.paymentId ?? null;
      if ((rentalId === null) === (paymentId === null)) throw new RequestError(400, "Give exactly one of rentalId or paymentId.");
      if (rentalId !== null && !isUuid(rentalId)) throw new RequestError(400, "rentalId must be a rental id.");
      if (paymentId !== null && !isUuid(paymentId)) throw new RequestError(400, "paymentId must be a payment id.");
      const limit = b.limit === undefined ? 50 : Number(b.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RequestError(400, "limit must be 1–200.");
      return { action: "history", rentalId: rentalId as string | null, paymentId: paymentId as string | null, limit };
    }
    default:
      throw new RequestError(400, `Unknown action '${String(b.action ?? "")}'.`);
  }
}

/** The body's targets in the SQL function's own shape (snake_case, cents). */
export function toSqlTargets(targets: { chargeEntryId: string; amountCents: number }[]) {
  return targets.map((t) => ({ charge_entry_id: t.chargeEntryId, amount_cents: t.amountCents }));
}

// ─── SQL errors → HTTP ───────────────────────────────────────────────────────

/** A rule the operator fixes by changing what they asked for. */
export const RULE_CODES = new Set(["over_allocation", "exceeds_charge_remaining", "charge_not_eligible", "no_change"]);
/** The state of the money forbids it (or it must be reconciled first). */
export const STATE_CODES = new Set([
  "payment_not_captured", "payment_not_settled", "payment_reversed", "payment_refunded", "payment_not_eligible",
  "refund_status_mismatch", "charge_would_exceed_amount", "not_drifted",
]);

export function mapRpcError(error: QueryResult["error"]): { status: number; body: { error: string; code: string } } {
  const sqlstate = error?.code ?? "";
  const message = error?.message ?? "";
  if (sqlstate === "PGRST202" || sqlstate === "42883") {
    return { status: 503, body: { error: "Reconciliation is not switched on yet: the database update has not been applied.", code: "not_deployed" } };
  }
  if (sqlstate === "40P01" || sqlstate === "40001" || sqlstate === "55P03") {
    return { status: 409, body: { error: "Someone else changed this bill at the same moment. Nothing was changed — try again.", code: "concurrent_change" } };
  }
  const m = message.match(/^([a-z_]+): ([\s\S]*)$/);
  if (!m) {
    return { status: 500, body: { error: "Something went wrong. Nothing was changed — please try again.", code: "unexpected" } };
  }
  const [, code, sentence] = m;
  const status =
    code === "invalid_input" ? 400
    : code === "forbidden" ? 403
    : code === "not_found" ? 404
    : RULE_CODES.has(code) ? 422
    : STATE_CODES.has(code) ? 409
    : 500; // write_failed, and any code this file does not know yet
  const text = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return { status, body: { error: text, code } };
}

// ─── Who is asking ───────────────────────────────────────────────────────────

const WRITE_ROLES = new Set(["head_admin", "admin"]);
const READ_ROLES = new Set(["head_admin", "admin", "ops", "viewer", "manager"]);
const PAYMENTS_TAB = "payments";

export interface Caller {
  appUserId: string;
  role: string | null;
  isSuperAdmin: boolean;
}

export type AuthResult = { ok: true; caller: Caller } | { ok: false; status: number; message: string };

export async function authorizeStaff(req: Request, db: DbClientLike, tenantId: string, mode: "read" | "write"): Promise<AuthResult> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, message: "Sign in to continue." };
  let authUserId: string | null = null;
  try {
    const { data, error } = await db.auth.getUser(token);
    if (!error) authUserId = data?.user?.id ?? null;
  } catch (e) {
    console.error("[payment-reallocate] getUser threw; denying:", e);
  }
  // The anon and service keys are project JWTs with no user: they land here.
  if (!authUserId) return { ok: false, status: 401, message: "Sign in to continue." };

  const { data: rows, error } = await db
    .from("app_users")
    .select("id, tenant_id, role, is_active, is_super_admin")
    .eq("auth_user_id", authUserId);
  if (error) {
    console.error("[payment-reallocate] app_users lookup failed; denying:", error.message);
    return { ok: false, status: 500, message: "Could not verify access." };
  }
  const list = (rows ?? []) as { id: string; tenant_id: string | null; role: string | null; is_active: boolean | null; is_super_admin: boolean | null }[];
  const appUser = list.find((u) => u.tenant_id === tenantId) ?? list.find((u) => u.is_super_admin === true);
  if (!appUser) return { ok: false, status: 403, message: "Only staff of this company can do this." };
  if (appUser.is_active === false) return { ok: false, status: 403, message: "This account is deactivated." };

  const isSuperAdmin = appUser.is_super_admin === true;
  const role = appUser.role ?? null;
  if (isSuperAdmin) return { ok: true, caller: { appUserId: appUser.id, role, isSuperAdmin } };

  if (mode === "write" && role && WRITE_ROLES.has(role)) return { ok: true, caller: { appUserId: appUser.id, role, isSuperAdmin } };
  if (mode === "read" && role && READ_ROLES.has(role) && role !== "manager") {
    return { ok: true, caller: { appUserId: appUser.id, role, isSuperAdmin } };
  }
  if (role === "manager") {
    const { data: grants, error: grantError } = await db
      .from("manager_permissions")
      .select("access_level")
      .eq("app_user_id", appUser.id)
      .eq("tab_key", PAYMENTS_TAB);
    if (grantError) {
      console.error("[payment-reallocate] manager_permissions lookup failed; denying:", grantError.message);
      return { ok: false, status: 500, message: "Could not verify access." };
    }
    const levels = ((grants ?? []) as { access_level?: string }[]).map((g) => g.access_level);
    const allowed = mode === "write" ? levels.includes("editor") : levels.length > 0;
    if (allowed) return { ok: true, caller: { appUserId: appUser.id, role, isSuperAdmin } };
    return {
      ok: false,
      status: 403,
      message: mode === "write" ? "Your account can see payments but not change them." : "Your account cannot see payments.",
    };
  }
  return {
    ok: false,
    status: 403,
    message: mode === "write" ? "Your role cannot move payments. Ask an admin to do this." : "Your role cannot see payments.",
  };
}

export function servesTenant(slug: string | null | undefined, configured: string | null | undefined): boolean {
  const list = (configured ?? "northwind").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!slug && (list.length ? list : ["northwind"]).includes(slug.toLowerCase());
}

// ─── The handler ─────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

async function tenantOf(db: DbClientLike, table: "payments" | "ledger_entries" | "rentals", id: string, what: string): Promise<string> {
  const { data, error } = await db.from(table).select("id, tenant_id").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, `Could not read the ${what}.`, "lookup_failed");
  if (!data) throw new HttpError(404, `${what.charAt(0).toUpperCase() + what.slice(1)} not found.`, "not_found");
  if (!data.tenant_id) throw new HttpError(409, `This ${what} has no company recorded on it.`, "no_company");
  return data.tenant_id as string;
}

async function auditRow(db: DbClientLike, auditId: string) {
  const { data, error } = await db
    .from("payment_allocation_changes")
    .select("id, kind, payment_id, charge_entry_id, rental_ids, reason, note, before, after, created_by, created_by_label, created_at")
    .eq("id", auditId)
    .maybeSingle();
  if (error || !data) {
    // The change IS committed; only reading it back failed.
    throw new HttpError(500, `The change was saved (record ${auditId}) but could not be read back — refresh to see it.`, "readback_failed");
  }
  return data;
}

export async function handlePaymentReallocate(req: Request, deps: ReallocateDeps): Promise<Response> {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new RequestError(400, "Body must be JSON.");
    }
    const request = parseRequest(raw);
    const db = deps.createAdminClient();

    // The company comes from the row the request names.
    const tenantId =
      request.action === "reallocate" ? await tenantOf(db, "payments", request.paymentId, "payment")
      : request.action === "recompute_charge" ? await tenantOf(db, "ledger_entries", request.chargeEntryId, "charge")
      : request.action === "reconcile_options" ? await tenantOf(db, "rentals", request.rentalId, "rental")
      : request.rentalId ? await tenantOf(db, "rentals", request.rentalId, "rental")
      : await tenantOf(db, "payments", request.paymentId!, "payment");

    const mode = request.action === "reallocate" || request.action === "recompute_charge" ? "write" : "read";
    const auth = await authorizeStaff(req, db, tenantId, mode);
    if (!auth.ok) return jsonResponse({ error: auth.message, code: auth.status === 401 ? "unauthenticated" : "forbidden" }, auth.status);

    const { data: tenant, error: tenantError } = await db.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
    if (tenantError) throw new HttpError(500, "Could not read the company.", "lookup_failed");
    if (!servesTenant(tenant?.slug, deps.tenantSlugs)) {
      throw new HttpError(403, "Reconciliation is not available for this company yet.", "not_enabled");
    }

    switch (request.action) {
      case "reallocate": {
        const { data, error } = await db.rpc("payment_reallocate", {
          p_payment_id: request.paymentId,
          p_targets: toSqlTargets(request.targets),
          p_reason: request.reason,
          p_note: request.note,
          p_actor: auth.caller.appUserId,
        });
        if (error) {
          const m = mapRpcError(error);
          return jsonResponse(m.body, m.status);
        }
        if (!isUuid(data)) throw new HttpError(500, "The database did not confirm the change.", "unconfirmed");
        const row = await auditRow(db, data);
        return jsonResponse({ ok: true, auditId: data, before: row.before, after: row.after });
      }
      case "recompute_charge": {
        const { data, error } = await db.rpc("charge_recompute_remaining", {
          p_charge_id: request.chargeEntryId,
          p_reason: request.reason,
          p_actor: auth.caller.appUserId,
          p_note: request.note,
        });
        if (error) {
          const m = mapRpcError(error);
          return jsonResponse(m.body, m.status);
        }
        if (!isUuid(data)) throw new HttpError(500, "The database did not confirm the change.", "unconfirmed");
        const row = await auditRow(db, data);
        return jsonResponse({ ok: true, auditId: data, before: row.before, after: row.after });
      }
      case "reconcile_options": {
        const { data, error } = await db.rpc("bill_reconcile_options", {
          p_rental_id: request.rentalId,
          p_extension_id: request.extensionId,
        });
        if (error) {
          const m = mapRpcError(error);
          return jsonResponse(m.body, m.status);
        }
        if (!data || typeof data !== "object") throw new HttpError(500, "The database returned no answer.", "unconfirmed");
        return jsonResponse({ ok: true, options: data });
      }
      case "history": {
        let q = db
          .from("payment_allocation_changes")
          .select("id, kind, payment_id, charge_entry_id, rental_ids, reason, note, before, after, created_by, created_by_label, created_at")
          .eq("tenant_id", tenantId);
        q = request.rentalId ? q.contains("rental_ids", [request.rentalId]) : q.eq("payment_id", request.paymentId);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(request.limit);
        if (error) throw new HttpError(500, "Could not read the history.", "lookup_failed");
        return jsonResponse({ ok: true, changes: data ?? [] });
      }
    }
  } catch (e) {
    if (e instanceof RequestError) return jsonResponse({ error: e.message, code: e.code }, e.status);
    if (e instanceof HttpError) return jsonResponse({ error: e.message, code: e.code }, e.status);
    console.error("[payment-reallocate] unexpected error:", e);
    return jsonResponse({ error: "Something went wrong. Nothing was changed — please try again.", code: "unexpected" }, 500);
  }
}
