// =============================================================================
// manage-signup-plans — super-admin CRUD for the three PUBLIC signup plans.
//
// These are the plans on drive-247.com/#pricing that a stranger can subscribe
// to. They are NOT the per-tenant `subscription_plans` rows (that is
// `manage-subscription-plans`, a different function against a different table).
//
// THE ONE RULE: the DATABASE decides what is DISPLAYED; STRIPE decides what is
// CHARGED. Those must never disagree, which is why a price change writes Stripe
// FIRST and the row SECOND — see `handleUpdatePrice`.
//
// Everything here is service_role. `signup_plans` grants anon SELECT on visible
// rows only and no write of any kind, so the browser cannot reach this data
// except through this function.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSignupStripeClient,
  getSignupStripeMode,
  getOrCreateSignupProduct,
} from "../_shared/signup-stripe.ts";

const LOG = "[manage-signup-plans]";

/** Stripe rejects unit_amount outside this range. */
const MIN_AMOUNT_CENTS = 50;
const MAX_AMOUNT_CENTS = 99_999_999;

const PLAN_COLUMNS =
  "id, plan_key, name, tagline, fleet_band, max_vehicles, amount_cents, currency, " +
  '"interval", bullets, is_highlighted, is_visible, sort_order, stripe_price_id, ' +
  "stripe_lookup_key, price_version, created_at, updated_at";

/** Structured failure so the admin UI can branch on `code`, not on prose. */
function fail(code: string, message: string, status: number, detail?: unknown) {
  return jsonResponse({ error: message, code, ...(detail ? { detail } : {}) }, status);
}

/**
 * The caller must be a SUPER admin, not merely signed in.
 *
 * `verify_jwt` proves only that SOME project JWT was presented, and the public
 * anon key satisfies that — so without this check the pricing of the entire
 * platform would be editable by anyone who opened the marketing site.
 * Mirrors manage-subscription-plans' `isSuperAdmin`.
 */
async function requireSuperAdmin(
  supabase: any,
  authHeader: string | null,
): Promise<{ ok: true; userId: string } | { ok: false; res: Response }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, res: fail("UNAUTHENTICATED", "Missing authorization header", 401) };
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { ok: false, res: fail("UNAUTHENTICATED", "Unauthorized", 401) };
  }
  const { data: appUser, error: auErr } = await supabase
    .from("app_users")
    .select("is_super_admin, is_active, tenant_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  // A failed probe must fail CLOSED — a transient DB error must never be
  // mistaken for "yes, this person may reprice the platform".
  if (auErr) {
    console.error(`${LOG} app_users probe failed:`, auErr.message);
    return { ok: false, res: fail("FORBIDDEN", "Not permitted", 403) };
  }
  if (appUser?.is_super_admin !== true || appUser?.is_active === false) {
    return { ok: false, res: fail("FORBIDDEN", "Super admin access required", 403) };
  }
  return { ok: true, userId: user.id };
}

/** Millisecond-precision compare — Postgres and JS render timestamptz differently. */
function sameInstant(a: unknown, b: unknown): boolean {
  const ta = Date.parse(String(a));
  const tb = Date.parse(String(b));
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * Optimistic concurrency. The client sends back the `updated_at` it loaded; if
 * the row has moved on, someone else edited it and we refuse rather than
 * silently overwriting their change (a lost update on a PRICE is money).
 */
async function loadForWrite(supabase: any, id: string, expectedUpdatedAt: unknown) {
  const { data, error } = await supabase
    .from("signup_plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load failed: ${error.message}`);
  if (!data) return { err: fail("NOT_FOUND", "That plan no longer exists.", 404) };
  if (expectedUpdatedAt && !sameInstant(data.updated_at, expectedUpdatedAt)) {
    return {
      err: fail(
        "STALE_WRITE",
        "Another admin changed this plan while you were editing. Reload to see their version.",
        409,
      ),
    };
  }
  return { row: data };
}

async function listPlans(supabase: any) {
  // Service role, so this deliberately returns INVISIBLE plans too — the whole
  // point of the admin page is to manage the ones the public cannot see.
  const { data, error } = await supabase
    .from("signup_plans")
    .select(PLAN_COLUMNS)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`list failed: ${error.message}`);
  return data ?? [];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auth = await requireSuperAdmin(supabase, req.headers.get("Authorization"));
  if (!auth.ok) return auth.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("INVALID_BODY", "Malformed request.", 400);
  }

  try {
    switch (body?.action) {
      // ---------------------------------------------------------------------
      case "list":
        return jsonResponse({ plans: await listPlans(supabase) });

      // ---------------------------------------------------------------------
      // Card content. Deliberately CANNOT touch amount_cents, currency,
      // interval, plan_key or visibility — each of those has its own action
      // with its own guard, so a content save can never move money by accident.
      // ---------------------------------------------------------------------
      case "update": {
        const loaded = await loadForWrite(supabase, body.id, body.updated_at);
        if (loaded.err) return loaded.err;

        const p = body.patch ?? {};
        const patch: Record<string, unknown> = {};

        if (p.name !== undefined) {
          const v = String(p.name).trim();
          if (v.length < 2 || v.length > 40) {
            return fail("VALIDATION_FAILED", "Name must be 2–40 characters.", 400, { field: "name" });
          }
          patch.name = v;
        }
        if (p.tagline !== undefined) {
          const v = String(p.tagline).trim();
          if (v.length > 160) {
            return fail("VALIDATION_FAILED", "Tagline must be 160 characters or fewer.", 400, { field: "tagline" });
          }
          patch.tagline = v;
        }
        if (p.fleet_band !== undefined) {
          const v = String(p.fleet_band).trim();
          if (v.length > 40) {
            return fail("VALIDATION_FAILED", "Fleet band must be 40 characters or fewer.", 400, { field: "fleet_band" });
          }
          patch.fleet_band = v;
        }
        if (p.max_vehicles !== undefined) {
          const n = Number(p.max_vehicles);
          if (!Number.isInteger(n) || n < 1 || n > 10_000) {
            return fail("VALIDATION_FAILED", "Max vehicles must be a whole number between 1 and 10,000.", 400, { field: "max_vehicles" });
          }
          patch.max_vehicles = n;
        }
        if (p.bullets !== undefined) {
          if (!Array.isArray(p.bullets) || p.bullets.length < 1 || p.bullets.length > 8) {
            return fail("VALIDATION_FAILED", "A plan needs between 1 and 8 bullet points.", 400, { field: "bullets" });
          }
          const cleaned = p.bullets.map((b: unknown) => String(b).trim()).filter(Boolean);
          if (cleaned.length !== p.bullets.length) {
            return fail("VALIDATION_FAILED", "Bullet points cannot be empty.", 400, { field: "bullets" });
          }
          if (cleaned.some((b: string) => b.length > 120)) {
            return fail("VALIDATION_FAILED", "Each bullet must be 120 characters or fewer.", 400, { field: "bullets" });
          }
          patch.bullets = cleaned;
        }

        if (!Object.keys(patch).length) {
          return jsonResponse({ plan: loaded.row });
        }
        patch.updated_by = auth.userId;

        const { data, error } = await supabase
          .from("signup_plans")
          .update(patch)
          .eq("id", body.id)
          .select(PLAN_COLUMNS)
          .single();
        if (error) throw new Error(`update failed: ${error.message}`);
        return jsonResponse({ plan: data });
      }

      // ---------------------------------------------------------------------
      // PRICE. The consequential one.
      // ---------------------------------------------------------------------
      case "update-price": {
        const loaded = await loadForWrite(supabase, body.id, body.updated_at);
        if (loaded.err) return loaded.err;
        const row: any = loaded.row;

        const amount = Number(body.amount_cents);
        if (!Number.isInteger(amount) || amount < MIN_AMOUNT_CENTS || amount > MAX_AMOUNT_CENTS) {
          return fail(
            "VALIDATION_FAILED",
            `Price must be between $${(MIN_AMOUNT_CENTS / 100).toFixed(2)} and $${(MAX_AMOUNT_CENTS / 100).toLocaleString()}.`,
            400,
            { field: "amount_cents" },
          );
        }
        if (amount === row.amount_cents) return jsonResponse({ plan: row });

        const mode = getSignupStripeMode();
        const stripe = getSignupStripeClient(mode);

        // A NEVER-REUSED lookup_key. Stripe Prices are immutable and lookup_key
        // is unique per account, so the key must rotate on every change. We do
        // NOT use `transfer_lookup_key`: transferring leaves the old Price
        // active while moving the key, which is exactly what would let a warm
        // edge isolate keep resolving the OLD price after an edit.
        const nextVersion = (Number(row.price_version) || 1) + 1;
        const lookupKey = `d247_signup_${row.plan_key}_${row.currency}_${amount}_v${nextVersion}`;

        const productId = await getOrCreateSignupProduct(stripe);
        const newPrice = await stripe.prices.create(
          {
            product: productId,
            unit_amount: amount,
            currency: row.currency,
            recurring: { interval: row.interval as "month" | "year" },
            lookup_key: lookupKey,
            nickname: `Drive247 ${row.name} (self-serve)`,
            metadata: { d247_signup_plan: row.plan_key, plan_name: row.name },
          },
          { idempotencyKey: `d247-signup-price-${row.plan_key}-${amount}-v${nextVersion}` },
        );

        // STRIPE FIRST, ROW SECOND, and never the other way round.
        //
        // If the row were written first and the Stripe call then failed, the
        // pricing page would advertise the new amount while every signup was
        // still charged the old one. In this order the worst case is an orphan
        // Stripe Price that nothing references — invisible to customers and
        // harmless, versus advertising a price we do not charge.
        const { data, error } = await supabase
          .from("signup_plans")
          .update({
            amount_cents: amount,
            stripe_price_id: newPrice.id,
            stripe_lookup_key: lookupKey,
            price_version: nextVersion,
            updated_by: auth.userId,
          })
          .eq("id", body.id)
          .select(PLAN_COLUMNS)
          .single();
        if (error) {
          console.error(`${LOG} price row write FAILED after creating ${newPrice.id}:`, error.message);
          return fail(
            "PRICE_HALF_APPLIED",
            "Stripe accepted the new price but we could not save it. Nothing has changed for customers — please retry.",
            500,
          );
        }

        // Archive the superseded Price. Best-effort ONLY: it does not affect
        // anyone already subscribed (Stripe bills the price pinned on the
        // subscription item, and archiving does not touch live subscriptions),
        // so a failure here must not fail the change the admin just made.
        if (row.stripe_price_id) {
          try {
            await stripe.prices.update(row.stripe_price_id, { active: false });
          } catch (e) {
            console.warn(`${LOG} could not archive old price ${row.stripe_price_id} (non-fatal):`, e);
          }
        }

        console.log(`${LOG} ${row.plan_key} ${row.amount_cents} -> ${amount} (price ${newPrice.id}, ${lookupKey})`);
        return jsonResponse({ plan: data });
      }

      // ---------------------------------------------------------------------
      case "set-visibility": {
        const loaded = await loadForWrite(supabase, body.id, body.updated_at);
        if (loaded.err) return loaded.err;
        const row: any = loaded.row;
        const next = body.is_visible === true;

        // Hiding the last visible plan would render the public pricing grid
        // empty and stop every signup. Enforced HERE, not just in the UI, so a
        // direct API call cannot take the product offline.
        if (!next && row.is_visible) {
          const { count, error: cErr } = await supabase
            .from("signup_plans")
            .select("id", { count: "exact", head: true })
            .eq("is_visible", true);
          if (cErr) throw new Error(`visibility count failed: ${cErr.message}`);
          if ((count ?? 0) <= 1) {
            return fail(
              "LAST_VISIBLE",
              "At least one plan must stay visible — hiding this one would empty the pricing page.",
              409,
            );
          }
        }

        const { data, error } = await supabase
          .from("signup_plans")
          .update({ is_visible: next, updated_by: auth.userId })
          .eq("id", body.id)
          .select(PLAN_COLUMNS)
          .single();
        if (error) throw new Error(`visibility update failed: ${error.message}`);
        return jsonResponse({ plan: data });
      }

      // ---------------------------------------------------------------------
      // "Most popular" is single-select. A partial unique index
      // (signup_plans_one_highlighted) enforces it in the DATABASE, so the
      // clear MUST happen before the set or the second statement violates it.
      // ---------------------------------------------------------------------
      case "set-highlighted": {
        const loaded = await loadForWrite(supabase, body.id, body.updated_at);
        if (loaded.err) return loaded.err;

        const { error: clearErr } = await supabase
          .from("signup_plans")
          .update({ is_highlighted: false, updated_by: auth.userId })
          .eq("is_highlighted", true)
          .neq("id", body.id);
        if (clearErr) throw new Error(`clear highlight failed: ${clearErr.message}`);

        const { error: setErr } = await supabase
          .from("signup_plans")
          .update({ is_highlighted: true, updated_by: auth.userId })
          .eq("id", body.id);
        if (setErr) throw new Error(`set highlight failed: ${setErr.message}`);

        return jsonResponse({ plans: await listPlans(supabase) });
      }

      // ---------------------------------------------------------------------
      default:
        return fail("INVALID_BODY", "Unknown action.", 400);
    }
  } catch (e) {
    console.error(`${LOG} ${body?.action} failed:`, e);
    return fail("INTERNAL", "Something went wrong. Please try again.", 500);
  }
});
