/**
 * turo-bridge-ingest — landing point for the Drive247 Turo Bridge Chrome
 * extension (PoC).
 *
 * ─── AUTH MODEL ─────────────────────────────────────────────────────────────
 * verify_jwt = false, and the pairing token in the JSON body is the ENTIRE
 * credential. The operator running the extension is signed into turo.com, not
 * into Drive247, so there is no Supabase session in that browser context to
 * present.
 *
 * The client NEVER names a tenant. tenant_id is resolved server-side from the
 * token alone, so a cross-tenant write is not expressible in the wire format —
 * even a caller holding a valid token plus a guessed tenant uuid cannot aim a
 * row at another operator. Any future change that lets the body carry a tenant
 * id or slug destroys this property; don't.
 *
 * The token is compared by SHA-256 DIGEST, never in plaintext. The database
 * stores only the hex digest (see turo-bridge-poc/sql/01-schema.sql), so a dump
 * of turo_bridge_tokens does not yield a usable credential.
 *
 * Do NOT move the token into an Authorization: Bearer header. The gateway may
 * try to parse that header as a JWT even with verify_jwt off, producing a 401
 * the handler never sees — which surfaces in DevTools as an unexplained CORS
 * failure. It cannot go in a custom header either: _shared/cors.ts:5 whitelists
 * only `authorization, x-client-info, apikey, content-type, x-tenant-slug`, so
 * an `x-turo-bridge-token` would fail preflight from a chrome-extension://
 * origin before this function ever runs. BODY ONLY.
 *
 * ─── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * Upsert on the UNIQUE (tenant_id, reservation_id) constraint. The MV3 service
 * worker can be killed after the row commits but before the response lands, so
 * "click Sync again" must be safe — and is.
 *
 * ─── FAIL CLOSED ────────────────────────────────────────────────────────────
 * Every ambiguity resolves toward refusal: missing env is a 500 (never a
 * degraded write), an unknown token is a 401, an unrecognised `source` is a 400
 * rather than a silent default to "live". The one thing this endpoint must
 * never do is let demo data enter the database labelled as a real reservation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

/** Mirrors the CHECK on turo_bridge_reservations.source. */
const SOURCES = new Set(["turo", "fixture"]);
/** Mirrors the CHECK on turo_bridge_reservations.status. */
const STATUSES = new Set(["synced", "imported", "failed"]);

/**
 * A minted token is 'd247_turo_' + 64 hex = 74 chars. The bounds are loose
 * enough to survive a format change and tight enough to reject junk before it
 * reaches the database.
 */
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 200;

/** The undocumented Turo feed could be large; the row is not a document store. */
const MAX_RAW_BYTES = 64 * 1024;

/** Identical to _shared/subscription-link.ts:50-53 — one hashing idiom in the repo. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function asText(v: unknown, max: number): string | null {
  if (typeof v === "number" || typeof v === "boolean") return String(v).slice(0, max);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function asAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100) / 100;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

/**
 * The extension normalises instants to ISO before sending, but it reads an
 * undocumented feed: a bad string here would be a Postgres 500 rather than a
 * NULL column. Re-parse and drop anything unusable — one empty column beats a
 * lost reservation.
 */
function asTimestamp(v: unknown): string | null {
  const s = asText(v, 64);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Two extension scaffolds exist and they disagree on the key name for the
 * credential (`token`, `pairing_token`, `pairingToken`). Accepting all three is
 * a one-line liberality on the server that removes an entire class of
 * demo-morning failure; the security property is unaffected, because what
 * matters is that the value hashes to a known digest, not what it was called.
 */
function extractToken(body: Record<string, unknown>): string {
  const candidates = [body.token, body.pairing_token, body.pairingToken];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return "";
}

/**
 * Normalise the provenance label onto the two values the CHECK constraint
 * permits. One sibling emits "live", the other emits "turo"; both mean the same
 * thing. An UNRECOGNISED value is rejected rather than defaulted, because the
 * only defaulting mistake that matters here is quietly stamping fixture data as
 * a real Turo reservation.
 */
function normaliseSource(raw: string | null): string | null | "invalid" {
  if (raw === null) return null;
  const s = raw.toLowerCase();
  if (s === "turo" || s === "live" || s === "turo_live") return "turo";
  if (s === "fixture" || s === "demo" || s === "sample" || s === "turo_fixture") return "fixture";
  return "invalid";
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed. POST a JSON body.", 405);
  }

  // Env first: a half-configured function must refuse, never write.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[TURO-BRIDGE] Missing Supabase environment configuration");
    return errorResponse("Server is not configured.", 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_) {
    return errorResponse("Body must be JSON.", 400);
  }

  // ---- 1. The credential -------------------------------------------------
  const token = extractToken(body);
  if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) {
    // Deliberately the SAME message as an unknown token below. Whether a
    // rejected string was the right length is not a fact worth confirming to
    // someone probing the endpoint.
    return errorResponse("Pairing token not recognised.", 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await sha256Hex(token);

  // Equality on a UNIQUE index over the digest of a 256-bit secret. Nothing
  // leaks by timing here that is not already public.
  const { data: pairing, error: tokenError } = await supabase
    .from("turo_bridge_tokens")
    .select("id, tenant_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenError) {
    console.error("[TURO-BRIDGE] Token lookup failed:", tokenError.message);
    // Fail closed: an unreadable token table is never an authorised request.
    return errorResponse("Could not verify the pairing token.", 500);
  }
  if (!pairing) {
    return errorResponse("Pairing token not recognised.", 401);
  }
  if (pairing.revoked_at) {
    // Distinguishable on purpose: the holder of a revoked token is a known
    // operator who needs to be told to get a new one, not an unknown prober.
    return errorResponse("This pairing token has been revoked.", 401);
  }

  // THE ONLY SOURCE OF TENANT IDENTITY IN THIS FUNCTION.
  const tenantId = pairing.tenant_id as string;

  // ---- 2. The payload ----------------------------------------------------
  // Accept `reservation` (the settled contract) or a bare top-level object, so
  // an extension that forgot the envelope still lands.
  const reservation = (
    body.reservation && typeof body.reservation === "object"
      ? body.reservation
      : body.trip && typeof body.trip === "object"
      ? body.trip
      : null
  ) as Record<string, unknown> | null;

  if (!reservation) {
    return errorResponse("Missing `reservation` object.", 400);
  }

  // Both spellings, because the two extension scaffolds disagree here too.
  const reservationId =
    asText(reservation.reservation_id, 120) ??
    asText(reservation.reservationId, 120) ??
    asText(reservation.id, 120);
  if (!reservationId) {
    return errorResponse("`reservation.reservation_id` is required.", 400);
  }

  // Provenance may ride on the reservation or on the envelope; the envelope
  // wins only if the reservation is silent.
  const declaredSource =
    asText(reservation.source, 20) ?? asText(body.source, 20);
  const source = normaliseSource(declaredSource);
  if (source === "invalid") {
    return errorResponse(
      "`source` must be 'turo' (live) or 'fixture' (bundled demo data).",
      400,
    );
  }
  // Absent means live: the fixture path always labels itself explicitly.
  const resolvedSource = source ?? "turo";
  if (!SOURCES.has(resolvedSource)) {
    return errorResponse("Unrecognised `source`.", 400);
  }

  const rawStatus = asText(reservation.status, 20);
  const status = rawStatus && STATUSES.has(rawStatus) ? rawStatus : "synced";

  const rawPayload =
    reservation.raw && typeof reservation.raw === "object" ? reservation.raw : {};
  if (JSON.stringify(rawPayload).length > MAX_RAW_BYTES) {
    return errorResponse("Reservation payload is too large.", 413);
  }

  const currency = asText(reservation.currency, 3);
  const nowIso = new Date().toISOString();

  const row = {
    tenant_id: tenantId, // from the token. Never from the request body.
    reservation_id: reservationId,
    source: resolvedSource,
    guest_name:
      asText(reservation.guest_name, 160) ?? asText(reservation.guestName, 160),
    vehicle_label:
      asText(reservation.vehicle_label, 200) ?? asText(reservation.vehicleLabel, 200),
    starts_at: asTimestamp(reservation.starts_at ?? reservation.startsAt),
    ends_at: asTimestamp(reservation.ends_at ?? reservation.endsAt),
    status,
    total_amount: asAmount(reservation.total_amount ?? reservation.totalAmount),
    currency: currency ? currency.toUpperCase() : null,
    raw: rawPayload,
    synced_at: nowIso,
    updated_at: nowIso,
  };

  // ---- 3. Did this already exist? ---------------------------------------
  // Read BEFORE the write: PostgREST cannot report which branch an upsert took,
  // and a demo that cannot say whether the second click created a duplicate has
  // not actually demonstrated idempotency. A race here mislabels one word in
  // the popup and nothing else.
  const { data: existing } = await supabase
    .from("turo_bridge_reservations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("reservation_id", reservationId)
    .maybeSingle();

  // ---- 4. Upsert on the tenant-scoped unique key ------------------------
  const { data: saved, error: writeError } = await supabase
    .from("turo_bridge_reservations")
    .upsert(row, { onConflict: "tenant_id,reservation_id" })
    .select(
      "id, reservation_id, source, guest_name, vehicle_label, starts_at, ends_at, status, total_amount, currency, synced_at",
    )
    .single();

  if (writeError) {
    console.error("[TURO-BRIDGE] Upsert failed:", writeError.message);
    return errorResponse("Could not save the reservation.", 500);
  }

  // Display name for the popup's "Synced to <tenant>" line. Fetched AFTER the
  // write so a slow/failed tenant read can never cost us a landed reservation.
  // `tenants` has no `name` column — company_name is the display name.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug, company_name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName =
    (tenant?.company_name as string | null) ?? (tenant?.slug as string | null) ?? "Drive247";

  // Best effort — a failed touch must never fail an import that already landed.
  const { error: touchError } = await supabase
    .from("turo_bridge_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", pairing.id);
  if (touchError) {
    console.error("[TURO-BRIDGE] last_used_at touch failed:", touchError.message);
  }

  const action = existing ? "updated" : "created";
  console.log(
    `[TURO-BRIDGE] ${action} ${reservationId} (source=${resolvedSource}) for tenant ${tenantId}`,
  );

  return jsonResponse({
    // `ok` and `success` both present: the two extension scaffolds read
    // different keys, and this is a PoC shipping today.
    ok: true,
    success: true,
    action, // 'created' | 'updated' — this is what proves idempotency on stage
    tenantName,
    reservation: saved,
  });
});
