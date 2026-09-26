import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * adjust-customer-balance
 * ------------------------------------------------------------------
 * Lets an operator "edit" a customer's balance WITHOUT ever overwriting the
 * derived balance number (which is computed live from ledger_entries +
 * payg_accruals). Instead it posts a single auditable Adjustment ledger row:
 *
 *   - direction 'increase' → a positive Charge (customer owes more)
 *   - direction 'decrease' → a negative Charge (a credit note / write-off)
 *
 * Because balance is `sum(Charge.remaining_amount) + open PAYG`, this entry
 * flows straight into every balance view and stays perfectly in sync. The
 * FIFO allocator ignores negative-remaining rows (`remaining_amount > 0`), so
 * a decrease never gets "paid" by a stray credit. A positive adjustment, like
 * any charge, can be settled by existing credit via the normal triggers.
 *
 * Service-role only: ledger_entries writes are not exposed to the client.
 *
 * ── Two request shapes, told apart by `kind` / `reverses_id` ─────────────
 *
 * v1 — the Edit Balance dialog (components/customers/edit-balance-dialog.tsx):
 *   { customerId, tenantId, amount, direction, reason, rentalId?, extensionId? }
 *   Unchanged, byte for byte: the branch below is the original handler body,
 *   pinned by tests/integrations/balance/adjust-customer-balance-contract.test.ts
 *   against a frozen copy of it.
 *
 * v2 — the canary "Adjust balance" panel (components/balance/**), additive:
 *   any body carrying `kind` or `reverses_id`. Three operations behind one
 *   "What happened?" question (docs/PAYMENTS_ROADMAP.md, assumption A1), each
 *   written by ONE SQL function that writes the money row and the audit row in
 *   one transaction and asserts both row counts
 *   (supabase/migrations/20260926120000_balance_adjustments.sql):
 *
 *   { kind: 'charge_correction', amount, direction, reason_code, note,
 *     charge_id?, rentalId?, extensionId? }            → balance_adjust
 *   { kind: 'goodwill', amount, direction?: 'decrease', reason_code, note,
 *     rentalId? }                                      → balance_adjust
 *   { kind: 'off_platform_payment', payment_id, reason_code, note }
 *                                                      → balance_record_off_platform_payment
 *   { kind, reverses_id, reason_code, note }           → balance_adjustment_reverse
 *
 *   The v2 path takes WHO from the caller's own token (app_users), never from
 *   the body, and refuses read-only accounts and managers without an editor
 *   grant on payments. The off-platform payment row itself is written by the
 *   portal's existing Record Payment path (payments insert + apply-payment,
 *   with `is_off_platform: true`) — this function only records its audit row.
 */

/** The slice of a supabase-js client this function uses — so the tests can hand in a recording fake. */
export interface AdminClientLike {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
  auth: { getUser: (jwt: string) => PromiseLike<{ data: { user: { id: string } | null } | null; error: any }> };
}

export interface AdjustBalanceDeps {
  /** Builds the service-role client — inside the handler's try, where the original built it. */
  createAdminClient: () => AdminClientLike;
}

export const V2_KINDS = ["charge_correction", "off_platform_payment", "goodwill"] as const;
export type V2Kind = (typeof V2_KINDS)[number];

/** A v2 request is any body carrying `kind` or `reverses_id`. Nothing the v1 dialog sends does. */
export function isV2Request(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.kind !== undefined || b.reverses_id !== undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export async function handleAdjustCustomerBalance(req: Request, deps: AdjustBalanceDeps): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = deps.createAdminClient();

    const body = await req.json();

    if (isV2Request(body)) return await handleV2(req, supabase, body as Record<string, unknown>);

    // ── v1: the original handler body, unchanged ──────────────────────────
    const {
      customerId,
      tenantId,
      amount,
      direction,
      reason,
      rentalId,
      extensionId,
    } = body as {
      customerId?: string;
      tenantId?: string;
      amount?: number;
      direction?: "increase" | "decrease";
      reason?: string;
      // Optional scoping. Omitted => account-level, exactly as before.
      rentalId?: string;
      extensionId?: string;
    };

    if (!customerId) return errorResponse("customerId is required");
    if (!tenantId) return errorResponse("tenantId is required");
    if (direction !== "increase" && direction !== "decrease") {
      return errorResponse("direction must be 'increase' or 'decrease'");
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return errorResponse("amount must be a positive number");
    }
    if (!reason || !reason.trim()) {
      return errorResponse("reason is required");
    }

    // Verify the customer belongs to this tenant (defence in depth — the caller
    // is authenticated portal staff, but we never trust client-supplied tenant
    // scoping for a service-role write).
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) return errorResponse(customerError.message, 500);
    if (!customer || customer.tenant_id !== tenantId) {
      return errorResponse("Customer not found for this tenant", 404);
    }

    // Round to cents and sign by direction.
    const magnitude = Math.round(amt * 100) / 100;
    const signed = direction === "increase" ? magnitude : -magnitude;
    const today = new Date().toISOString().split("T")[0];

    // type='Charge', category='Adjustment'. rental_id NULL = account-level, so
    // the (rental_id, due_date, type, category, ...) unique index never
    // collides (NULLs are distinct), letting staff post multiple adjustments.
    const { data: entry, error: insertError } = await supabase
      .from("ledger_entries")
      .insert({
        customer_id: customerId,
        tenant_id: tenantId,
        rental_id: null,
        vehicle_id: null,
        type: "Charge",
        category: "Adjustment",
        amount: signed,
        remaining_amount: signed,
        entry_date: today,
        due_date: today,
        reference: reason.trim().slice(0, 500),
        // Scoping, when supplied. This matters more than it looks: the rental
        // page's Balance Due is two disjoint halves. The non-extension half
        // discards any category whose remaining is <= 0, so a negative
        // Adjustment is thrown away there. The extension half is the
        // rental_extension_totals view, whose LATERAL keys on extension_id with
        // NO sign or category filter — so ONLY an extension-scoped credit
        // actually moves the number an operator is looking at. An account-level
        // adjustment (both null) shifts that tile by exactly $0.00.
        ...(rentalId ? { rental_id: rentalId } : {}),
        ...(extensionId ? { extension_id: extensionId } : {}),
      })
      .select()
      .single();

    if (insertError) return errorResponse(insertError.message, 500);

    return jsonResponse({
      ok: true,
      entryId: entry.id,
      direction,
      amount: magnitude,
      signedAmount: signed,
    });
  } catch (error) {
    console.error("adjust-customer-balance error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   v2 — the canary Adjust balance panel
   ══════════════════════════════════════════════════════════════════════════ */

type Caller = { appUserId: string } | { error: string; status: number };

/**
 * WHO — from the caller's own token. Staff of this tenant (or a super admin),
 * active, not read-only; a manager needs an editor grant on payments. The SQL
 * function checks the same person again before it writes.
 */
export async function resolveCaller(req: Request, supabase: AdminClientLike, tenantId: string): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Sign in to change a balance.", status: 401 };

  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  const authUserId = auth?.user?.id;
  if (authError || !authUserId) return { error: "Sign in to change a balance.", status: 401 };

  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("id, tenant_id, role, is_active, is_super_admin")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (appUserError) return { error: appUserError.message, status: 500 };
  if (!appUser || appUser.is_active === false) {
    return { error: "Only a member of staff can change a balance.", status: 403 };
  }
  if (appUser.is_super_admin !== true && appUser.tenant_id !== tenantId) {
    return { error: "This staff account belongs to a different business.", status: 403 };
  }
  if (appUser.role === "viewer") {
    return { error: "Read-only accounts cannot change a balance.", status: 403 };
  }
  if (appUser.role === "manager") {
    const { data: grants, error: grantError } = await supabase
      .from("manager_permissions")
      .select("tab_key, access_level")
      .eq("app_user_id", appUser.id)
      .eq("tab_key", "payments");
    if (grantError) return { error: grantError.message, status: 500 };
    const editor = (grants ?? []).some((g: { access_level?: string }) => g.access_level === "editor");
    if (!editor) return { error: "Your account can see payments but not change them.", status: 403 };
  }
  return { appUserId: appUser.id };
}

/** A SQL function's refusal → the HTTP status it means. Operator-facing messages pass through verbatim. */
export function rpcFailure(error: { code?: string; message?: string } | null | undefined): Response {
  const code = error?.code;
  const message = error?.message || "The change could not be saved.";
  if (code === "P0001" || code === "22023") return errorResponse(message, 400);
  if (code === "42501") return errorResponse(message, 403);
  if (code === "P0002") return errorResponse(message, 404);
  if (code === "23505") return errorResponse(message, 409);
  // The migration is not applied yet: the function does not exist.
  if (code === "PGRST202" || code === "42883") {
    return errorResponse("Balance adjustments are not switched on yet: the database update has not been applied.", 503);
  }
  return errorResponse(message, 500);
}

async function handleV2(req: Request, supabase: AdminClientLike, body: Record<string, unknown>): Promise<Response> {
  const customerId = body.customerId;
  const tenantId = body.tenantId;
  if (!customerId || typeof customerId !== "string") return errorResponse("customerId is required");
  if (!tenantId || typeof tenantId !== "string") return errorResponse("tenantId is required");

  const caller = await resolveCaller(req, supabase, tenantId);
  if ("error" in caller) return errorResponse(caller.error, caller.status);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, tenant_id")
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) return errorResponse(customerError.message, 500);
  if (!customer || customer.tenant_id !== tenantId) {
    return errorResponse("Customer not found for this tenant", 404);
  }

  const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
  const note = typeof body.note === "string" ? body.note : "";
  if (!reasonCode) return errorResponse("reason_code is required");
  if (!note.trim()) return errorResponse("note is required");

  const base = { p_tenant_id: tenantId, p_customer_id: customerId, p_created_by: caller.appUserId };

  // ── Undo: a reversing entry ────────────────────────────────────────────
  if (body.reverses_id !== undefined) {
    if (!isUuid(body.reverses_id)) return errorResponse("reverses_id must be an entry id");
    const { data, error } = await supabase.rpc("balance_adjustment_reverse", {
      ...base,
      p_adjustment_id: body.reverses_id,
      p_reason_code: reasonCode,
      p_note: note,
    });
    if (error) return rpcFailure(error);
    return v2Result(data);
  }

  const kind = body.kind as V2Kind;
  if (!(V2_KINDS as readonly string[]).includes(kind as string)) {
    return errorResponse(`kind must be one of ${V2_KINDS.join(", ")}`);
  }

  // ── (b) money received outside the platform: the audit row for it ───────
  if (kind === "off_platform_payment") {
    if (!isUuid(body.payment_id)) return errorResponse("payment_id is required");
    const { data, error } = await supabase.rpc("balance_record_off_platform_payment", {
      ...base,
      p_payment_id: body.payment_id,
      p_reason_code: reasonCode,
      p_note: note,
    });
    if (error) return rpcFailure(error);
    return v2Result(data);
  }

  // ── (a) a charge was wrong, (c) goodwill: signed Adjustment + audit ─────
  const direction = body.direction ?? (kind === "goodwill" ? "decrease" : undefined);
  if (direction !== "increase" && direction !== "decrease") {
    return errorResponse("direction must be 'increase' or 'decrease'");
  }
  if (kind === "goodwill" && direction !== "decrease") {
    return errorResponse("Goodwill can only lower what the customer owes.");
  }
  const amt = Number(body.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return errorResponse("amount must be a positive number");
  }
  const magnitude = Math.round(amt * 100) / 100;
  if (magnitude <= 0) return errorResponse("amount must be a positive number");
  const signed = direction === "increase" ? magnitude : -magnitude;

  for (const key of ["rentalId", "extensionId", "charge_id"] as const) {
    if (body[key] !== undefined && body[key] !== null && !isUuid(body[key])) return errorResponse(`${key} must be an id`);
  }

  const { data, error } = await supabase.rpc("balance_adjust", {
    ...base,
    p_kind: kind,
    p_amount: signed,
    p_reason_code: reasonCode,
    p_note: note,
    p_rental_id: (body.rentalId as string | undefined) ?? null,
    p_extension_id: (body.extensionId as string | undefined) ?? null,
    p_target_charge_id: (body.charge_id as string | undefined) ?? null,
  });
  if (error) return rpcFailure(error);
  return v2Result(data);
}

function v2Result(data: any): Response {
  if (!data || typeof data !== "object" || !data.adjustment_id) {
    return errorResponse("The change was not confirmed by the database.", 500);
  }
  return jsonResponse({
    ok: true,
    kind: data.kind,
    adjustmentId: data.adjustment_id,
    entryId: data.ledger_entry_id ?? null,
    paymentId: data.payment_id ?? null,
    reversesId: data.reverses_id ?? null,
    signedAmount: Number(data.amount),
    reference: data.reference ?? null,
  });
}
