// ============================================================================
// fleet-quote-api
// ----------------------------------------------------------------------------
// A machine-callable fleet quote, for an operator's Messenger bot or a GPT
// Action: "3 SUVs, 12th to 19th" -> what is available and what it costs.
//
// AUTH. The caller is a bot on someone else's servers; it has no Supabase JWT to
// present, so `verify_jwt = false` in config.toml and this function does its own
// authentication. The credential is an opaque token whose SHA-256 digest is a
// unique index probe on public.tenant_api_keys.
//
// The single most important property: THE CALLER NEVER NAMES A TENANT. tenant_id
// is resolved only from the credential row, so a forged or swapped tenant is not
// expressible in the wire format. That matters more here than it normally would,
// because RLS is currently disabled on most of this schema — tenant isolation
// cannot be delegated to the database and is enforced here, explicitly.
//
// The quote logic itself is NOT written here. It is a generated, byte-identical
// copy of the portal's apps/portal/src/lib/fleet-quote.ts (see
// scripts/sync-fleet-quote.mjs and the drift test in apps/portal). This endpoint
// only authenticates, loads data, and projects the result. Every guard —
// caps, limits, redaction — lives here so the shared file stays identical to the
// portal's and the operator's Fleet Quotes screen is provably unaffected.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { buildFleetQuote } from "../_shared/fleet-quote.ts";
import { vehicleLabel } from "../_shared/vehicle-privacy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-drive247-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Guards. Deliberately conservative for v1 — every one of these can be relaxed
// later without a breaking change, whereas tightening them would be one.
const MAX_BODY_BYTES = 4_096;
const MAX_RANGE_DAYS = 180;      // a bot asking for a 3-year quote is a mistake or a scrape
const MAX_RESULTS = 25;          // largest real fleet is 22; the 242-vehicle tenant is the test account
const RATE_LIMIT_PER_MIN = 30;

/** Mirrors QUOTE_HOLDING_STATUSES in the shared logic, in the casings the DB uses. */
const HOLDING_STATUSES = [
  "Pending", "pending", "Active", "active", "Upcoming", "upcoming",
  "Confirmed", "confirmed", "Started", "started",
];

/** Calendar-day shift on a bare YYYY-MM-DD, UTC-anchored so no DST drift. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Errors a chatbot may read aloud: plain, actionable, never internal detail. */
function fail(code: string, message: string, status: number) {
  return json({ ok: false, error: code, message }, status);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST.", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- 1. CREDENTIAL -------------------------------------------------------
  // Primary header is custom. Bearer is accepted as a fallback because the
  // gateway's handling of a non-JWT Authorization header has been reported
  // inconsistent across builds; accepting both makes this correct either way.
  const presented =
    req.headers.get("x-drive247-key") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  if (!presented || presented.length < 20 || presented.length > 200) {
    return fail("unauthorized", "A valid API key is required.", 401);
  }

  const { data: keyRow, error: keyErr } = await supabase
    .from("tenant_api_keys")
    .select("id, tenant_id, scope, revoked_at")
    .eq("token_hash", await sha256Hex(presented))
    .maybeSingle();

  // Same response for "no such key", "revoked" and "wrong scope": never tell an
  // attacker which of those they hit.
  if (keyErr || !keyRow || keyRow.revoked_at || keyRow.scope !== "fleet_quote") {
    return fail("unauthorized", "A valid API key is required.", 401);
  }
  const tenantId = keyRow.tenant_id as string; // the ONLY source of tenant identity

  // Rate limiting lives in the DB, not in this process. An in-memory counter was
  // tried first and verified NOT to work — 35 rapid calls all returned 200,
  // because Deno serves from multiple isolates and each starts with an empty
  // Map. The RPC does an atomic check-and-increment on the key row, so the
  // window is shared however many isolates are running.
  const { data: limited, error: rlErr } = await supabase.rpc("tenant_api_key_rate_limited", {
    p_key_id: keyRow.id,
    p_limit: RATE_LIMIT_PER_MIN,
    p_window_seconds: 60,
  });
  // Fail CLOSED: if the limiter cannot be consulted we refuse rather than serve
  // an unbounded number of requests.
  if (rlErr || limited === true) {
    if (rlErr) console.error("[fleet-quote-api] rate limiter unavailable:", rlErr.message);
    return fail("rate_limited", "Too many requests. Try again in a minute.", 429);
  }

  // ---- 2. INPUT ------------------------------------------------------------
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("bad_request", "Request body is too large.", 413);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return fail("bad_request", "Request body must be valid JSON.", 400);
  }

  const startDate = String(body.start_date ?? "").trim();
  const endDate = String(body.end_date ?? "").trim();
  const pickupTime = String(body.pickup_time ?? "10:00").trim();
  const returnTime = String(body.return_time ?? "10:00").trim();
  const wanted = Math.max(1, Math.min(50, Number(body.vehicles_needed) || 1));
  const category = body.category ? String(body.category).trim().toLowerCase() : null;

  if (!startDate || !endDate) {
    return fail("bad_request", "Please provide start_date and end_date as YYYY-MM-DD.", 400);
  }

  // ---- 3. TENANT CONFIG ----------------------------------------------------
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    // Mirrors apps/portal/src/hooks/use-fleet-quote.ts:88 exactly, plus the two
    // fields this endpoint needs for its own response and redaction. Taking a
    // different set would be the first step towards the API and the portal
    // disagreeing about a price.
    .select(
      "id, company_name, currency_code, hide_vehicle_registration, " +
      "buffer_time_minutes, monthly_tier_days, weekend_surcharge_percent, weekend_days, " +
      "stack_surcharges, timezone, security_deposit_enabled, deposit_mode, global_deposit_amount",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantErr || !tenant) return fail("server_error", "Could not load account settings.", 500);

  const timezone = (tenant.timezone as string) || "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  // Cap the window BEFORE doing any work: an unbounded range is either a mistake
  // or a scrape, and both are cheaper to refuse than to serve.
  const spanDays = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000,
  );
  if (!Number.isFinite(spanDays) || spanDays <= 0) {
    return fail("bad_request", "end_date must be after start_date.", 400);
  }
  if (spanDays > MAX_RANGE_DAYS) {
    return fail("bad_request", `Quotes are limited to ${MAX_RANGE_DAYS} days. Please shorten the dates.`, 400);
  }

  // ---- 4. DATA — every query scoped to the credential's tenant --------------
  // These four queries mirror apps/portal/src/hooks/use-fleet-quote.ts:106-145
  // field-for-field. The column lists are NOT cosmetic: buildFleetQuote reads
  // is_disposed and available_daily/weekly/monthly to decide whether a vehicle is
  // quotable at all, security_deposit to price the hold, and pickup_time /
  // return_time / payg_closed_at to decide whether a rental blocks the window.
  // Dropping any of them silently changes the answer versus the operator's screen.
  const bufferMinutes = Math.max(0, Number(tenant.buffer_time_minutes) || 0);
  const bufferDays = Math.ceil(bufferMinutes / 1_440) + 1;
  const holdingCeiling = shiftDate(endDate, bufferDays);
  const completedFloor = shiftDate(startDate, -bufferDays);

  const [vehiclesRes, rentalsRes, completedRes, blocksRes, holidaysRes] = await Promise.all([
    supabase.from("vehicles")
      .select("id, reg, make, model, year, category, status, is_disposed, available_daily, available_weekly, available_monthly, daily_rent, weekly_rent, monthly_rent, security_deposit, photo_url")
      .eq("tenant_id", tenantId),
    supabase.from("rentals")
      .select("id, vehicle_id, start_date, end_date, pickup_time, return_time, status, is_pay_as_you_go, payg_closed_at")
      .eq("tenant_id", tenantId)
      .in("status", HOLDING_STATUSES)
      .lte("start_date", holdingCeiling),
    // A vehicle is still unavailable during turnaround after a completed hire.
    // Skipped entirely when the tenant sets no buffer, exactly as the portal does.
    bufferMinutes > 0
      ? supabase.from("rentals")
          .select("id, vehicle_id, start_date, end_date, pickup_time, return_time, status, is_pay_as_you_go, payg_closed_at")
          .eq("tenant_id", tenantId)
          .in("status", ["Completed", "completed", "Closed", "closed"])
          .not("end_date", "is", null)
          .gte("end_date", completedFloor)
          .lte("end_date", startDate)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("blocked_dates")
      .select("vehicle_id, start_date, end_date, reason")
      .eq("tenant_id", tenantId),
    supabase.from("tenant_holidays")
      .select("id, name, start_date, end_date, surcharge_percent, excluded_vehicle_ids, recurs_annually")
      .eq("tenant_id", tenantId),
  ]);

  if (vehiclesRes.error || rentalsRes.error || completedRes.error || blocksRes.error || holidaysRes.error) {
    console.error("[fleet-quote-api] data load failed", {
      tenantId,
      v: vehiclesRes.error?.message, r: rentalsRes.error?.message,
      c: completedRes.error?.message, b: blocksRes.error?.message, h: holidaysRes.error?.message,
    });
    return fail("server_error", "Could not load fleet data.", 500);
  }

  const vehicles = vehiclesRes.data ?? [];
  const vehicleIds = vehicles.map((v: { id: string }) => v.id);

  // vehicle_pricing_overrides and vehicle_daily_prices have NO tenant_id column —
  // filtering them by tenant would be a 42703 and 500 every request. Scope them
  // by the tenant's own vehicle ids instead, which is equivalent and correct.
  const [overridesRes, dailyPricesRes] = vehicleIds.length
    ? await Promise.all([
        supabase.from("vehicle_pricing_overrides")
          .select("vehicle_id, rule_type, holiday_id, override_type, fixed_price, custom_percent")
          .in("vehicle_id", vehicleIds),
        supabase.from("vehicle_daily_prices")
          .select("vehicle_id, date, price")
          .in("vehicle_id", vehicleIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  // ---- 5. QUOTE — the portal's own logic, unmodified ------------------------
  let result;
  try {
    result = buildFleetQuote(
      vehicles as never,
      [...(rentalsRes.data ?? []), ...(completedRes.data ?? [])] as never,
      (blocksRes.data ?? []) as never,
      {
        startDate, endDate, pickupTime, returnTime, timezone, today,
        // bufferMinutes is REQUIRED and is why the portal also loads recently
        // completed rentals: a vehicle is unavailable during turnaround. Omitting
        // it would quote a car that is still being cleaned.
        bufferMinutes,
        monthlyTierDays: Math.max(7, Number(tenant.monthly_tier_days) || 30),
        securityDepositEnabled: tenant.security_deposit_enabled !== false,
        depositMode: tenant.deposit_mode === "per_vehicle" ? "per_vehicle" : "global",
        globalSecurityDeposit: Math.max(0, Number(tenant.global_deposit_amount) || 0),
        weekendConfig: Number(tenant.weekend_surcharge_percent) > 0
          ? {
              weekend_surcharge_percent: Number(tenant.weekend_surcharge_percent),
              weekend_days: Array.isArray(tenant.weekend_days) ? tenant.weekend_days : [6, 0],
              stack_surcharges: tenant.stack_surcharges === true,
            }
          : null,
        holidays: holidaysRes.data ?? [],
        overrides: overridesRes.data ?? [],
        dailyPrices: dailyPricesRes.data ?? [],
      } as never,
    );
  } catch (e) {
    // validateQuoteRange throws human-readable messages by design — a bot can
    // read these aloud, so pass them through rather than masking them.
    return fail("bad_request", (e as Error).message || "Those dates could not be quoted.", 400);
  }

  // ---- 6. PROJECT ----------------------------------------------------------
  // A bot answering a stranger gets less than an operator does: no vehicle ids
  // (not enumerable), no exclusion reasons (they leak who is renting what and
  // when), and no plate unless the tenant already publishes it.
  // FleetQuoteLine carries vehicleId, registration and priceFingerprint. None of
  // the three is returned: ids would let a caller enumerate the fleet, the plate
  // is PII-adjacent and 5 tenants already hide it, and the fingerprint encodes
  // how a price was composed. The operator's own screen may show all three; a
  // stranger's chatbot may not.
  const hidePlate = tenant.hide_vehicle_registration === true;
  const available = (result.available ?? [])
    .slice(0, MAX_RESULTS)
    .map((line: Record<string, unknown>) => ({
      // vehicleLabel already applies plate redaction; `name` alone can still
      // fall back to the plate when make/model are blank, so build the label
      // from parts rather than trusting line.name.
      vehicle: vehicleLabel(
        { make: null, model: String(line.name ?? ""), reg: String(line.registration ?? "") },
        hidePlate,
        "Vehicle",
      ),
      category: (line.category as string | null) ?? null,
      total: line.total,
      rental_days: line.rentalDays,
      pricing_tier: line.pricingTier,
      security_deposit: line.securityDeposit ?? null,
    }));

  const enough = available.length >= wanted;

  // last_used_at is useful for spotting a stale or abandoned key. Fire and
  // forget: a telemetry write must never fail a quote.
  supabase.from("tenant_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {}, () => {});

  return json({
    ok: true,
    company: tenant.company_name,
    currency: (tenant.currency_code as string) || "USD",
    start_date: startDate,
    end_date: endDate,
    rental_days: result.rentalDays,
    vehicles_requested: wanted,
    vehicles_available: available.length,
    enough_available: enough,
    // Deliberately capped and unranked beyond the logic's own ordering.
    quotes: category
      ? available.filter((a) => (a.category ?? "").toLowerCase() === category)
      : available,
  });
});
