/**
 * turo-bridge-ingest — landing point for the Drive247 Turo Bridge Chrome
 * extension.
 *
 * ─── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ────────────────────────────
 * This was a one-reservation-per-call endpoint. It is now a BATCH endpoint that
 * also opens, heartbeats and finalises a SYNC RUN. The single-reservation wire
 * format still works byte-for-byte — `{ token, reservation: {...} }` returns the
 * same `{ ok, success, action, tenantName, reservation }` the shipped popup and
 * apps/portal/src/hooks/use-turo-bridge.ts already read. Nothing was renamed.
 *
 * ─── AUTH MODEL (unchanged) ─────────────────────────────────────────────────
 * verify_jwt = false, and the pairing token in the JSON body is the ENTIRE
 * credential. The operator running the extension is signed into turo.com, not
 * into Drive247, so there is no Supabase session in that browser context.
 *
 * The client NEVER names a tenant. tenant_id is resolved server-side from the
 * token alone, so a cross-tenant write is not expressible in the wire format —
 * even a caller holding a valid token plus a guessed tenant uuid cannot aim a
 * row at another operator. Any future change that lets the body carry a tenant
 * id or slug destroys this property; don't.
 *
 * Do NOT move the token into an Authorization: Bearer header. The gateway may
 * try to parse that header as a JWT even with verify_jwt off, producing a 401
 * the handler never sees — which surfaces in DevTools as an unexplained CORS
 * failure. It cannot go in a custom header either: _shared/cors.ts:5 whitelists
 * only `authorization, x-client-info, apikey, content-type, x-tenant-slug`, so
 * an `x-turo-bridge-token` would fail preflight from a chrome-extension://
 * origin before this function ever runs. BODY ONLY.
 *
 * ⚠ TOKEN COLUMN — THE LIVE DEFECT THIS FILE NOW SURVIVES.
 *   turo-bridge-poc/sql/01-schema.sql adds `token_hash` and drops the plaintext
 *   `token`. It has NEVER BEEN APPLIED: production turo_bridge_tokens today has
 *   {id, tenant_id, token, label, created_at, last_used_at, revoked_at} and NO
 *   token_hash (verified against the live catalog of hviqoaokxvlancmftwuo,
 *   2026-09-02). The previous revision of this file queried token_hash
 *   unconditionally, so deploying it turned EVERY sync into a 500 via the
 *   tokenError branch. resolvePairing() below now tries the digest column first
 *   and falls back to the plaintext column ONLY on Postgres 42703 (undefined
 *   column) — so this function is correct before AND after 01-schema.sql is
 *   applied, and the fallback disappears on its own the moment it is. The
 *   digest path is always preferred: a dump of a hashed table yields no usable
 *   credential.
 *
 * ─── THE RUN, AND WHY THE CLIENT CANNOT DECLARE ITSELF HEALTHY ──────────────
 * A batch arrives attached to a turo_sync_jobs row. The client reports only RAW
 * OBSERVATIONS — how many pages it fetched, whether it saw the end of the feed,
 * which Turo vehicle ids it actually laid eyes on, what went wrong. It cannot
 * report `completeness`, `is_authoritative`, `observed_complete` or
 * `progress_denominator`: those are GENERATED ALWAYS columns and Postgres
 * refuses any write to them, service_role included. Authority is DERIVED, never
 * asserted. See turo-bridge-poc/sql/03-foundation-schema.sql §1 and §10.
 *
 * ─── THE DEGRADED-RUN FLAG ──────────────────────────────────────────────────
 * ONE permission bit is not enough, and collapsing the two is the single
 * mistake that makes absence able to delete. A truncated read is perfectly safe
 * to WRITE from (upserting trips we did see is idempotent and strictly more
 * information) and catastrophic to RELEASE from. So:
 *
 *   writeSafe   — may we upsert what we did read?
 *   releaseSafe — may ABSENCE be read as a trip having ended?   (never decided
 *                 here; reconcile decides it, and the DB re-proves it)
 *
 * When the run's outcome is not writeSafe — a bot challenge, a signed-out
 * session, an unrecognised envelope, an HTTP-200-with-empty-body from the WAF —
 * THE WHOLE BATCH WRITES NOTHING. Not a partial write, not a best-effort
 * subset: zero reservation rows. The one row that is still written is the job
 * itself, carrying the failure, because invisible degradation is its own
 * failure mode: an operator who is told nothing learns nothing.
 *
 * ─── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * Upsert on the UNIQUE (tenant_id, reservation_id) constraint
 * (turo_bridge_reservations_tenant_reservation_key). The MV3 service worker can
 * be killed after the rows commit but before the response lands, so replaying a
 * page must be safe — and is.
 *
 * ─── FAIL CLOSED ────────────────────────────────────────────────────────────
 * Every ambiguity resolves toward refusal: missing env is a 500 (never a
 * degraded write), an unknown token is a 401, an unrecognised `source` is a 400
 * rather than a silent default to "live". The one thing this endpoint must
 * never do is let demo data enter the database labelled as a real reservation.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

/** Mirrors the CHECK on turo_bridge_reservations.source. */
const SOURCES = new Set(["turo", "fixture"]);
/** Mirrors the CHECK on turo_bridge_reservations.status. */
const STATUSES = new Set(["synced", "imported", "failed"]);
/** Mirrors the CHECK on turo_sync_jobs.job_kind. */
const JOB_KINDS = new Set(["trips", "vehicles", "guests", "earnings_csv", "manual_single"]);
/** Mirrors the CHECK on turo_sync_jobs.degraded_reason. CLOSED LIST — see below. */
const DEGRADED_REASONS = new Set([
  "waf_challenge", "waf_empty_200", "captcha", "session_expired", "not_signed_in",
  "http_error", "shape_unrecognised", "page_cap_reached", "worker_killed",
  "tab_closed", "timeout", "user_cancelled", "heartbeat_lost", "unknown",
]);
/** Mirrors the CHECK on turo_sync_jobs.reader_outcome (03 §10). */
const READER_OUTCOMES = new Set([
  "OK", "NO_TRIPS_CONFIRMED", "EMPTY_UNCONFIRMED", "NOT_LOGGED_IN", "BOT_BLOCKED",
  "RATE_LIMITED", "UNREACHABLE", "SHAPE_CHANGED", "TRUNCATED", "PAGINATION_STALLED",
  "UNPARSEABLE", "NO_TRIPS", "UNKNOWN",
]);

/**
 * writeSafe per outcome — the server's own copy of the policy table in
 * turo-bridge-poc/extension/turo-read-contract.js. Duplicated on purpose: the
 * client is the thing that might be compromised, confused, or three versions
 * out of date, and "may this batch be written at all" is not a question we
 * delegate to it. The client's own `write_safe` flag can only ever make this
 * STRICTER (see resolveWriteSafety) — never more permissive.
 *
 * Note TRUNCATED and PAGINATION_STALLED are writeSafe. A partial read is still
 * true as far as it goes; refusing to write it would throw away real bookings
 * to no benefit. What a partial read may never do is authorise a release, and
 * that decision does not live here.
 */
const WRITE_SAFE: Record<string, boolean> = {
  OK: true,
  NO_TRIPS_CONFIRMED: true,   // nothing to write, but the run is honest
  TRUNCATED: true,            // fewer records, all of them real
  PAGINATION_STALLED: true,   // ditto
  RATE_LIMITED: true,         // what arrived before the 429 is still real
  NO_TRIPS: true,             // legacy single-record path
  EMPTY_UNCONFIRMED: false,   // ⚠ THE WAF CASE. 200 + valid JSON + nothing.
  NOT_LOGGED_IN: false,
  BOT_BLOCKED: false,
  UNREACHABLE: false,
  SHAPE_CHANGED: false,       // items present, none normalised => OUR bug
  UNPARSEABLE: false,
  UNKNOWN: false,
};

/**
 * A minted token is 'd247_turo_' + 64 hex = 74 chars. The bounds are loose
 * enough to survive a format change and tight enough to reject junk before it
 * reaches the database.
 */
const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 200;

/** The undocumented Turo feed could be large; the row is not a document store. */
const MAX_RAW_BYTES = 64 * 1024;
/** One page of a Turo feed is ~200 records; this is generous headroom per call. */
const MAX_BATCH_RECORDS = 500;
/** Guards against a runaway client posting a whole run's page log in one go. */
const MAX_PAGES_PER_CALL = 100;

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

function asInt(v: unknown, min = 0, max = 1_000_000_000): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i < min ? min : i > max ? max : i;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * The extension normalises instants to ISO before sending, but it reads an
 * undocumented feed: a bad string here would be a Postgres 500 rather than a
 * NULL column. Re-parse and drop anything unusable — one empty column beats a
 * lost reservation.
 *
 * ⚠ This does NOT accept a display string. `new Date('Sep 14')` yields a valid
 *   Date in the CURRENT year, so a rendered date would silently import as a
 *   confidently-wrong booking window. The reader refuses those upstream
 *   (turo-read-contract.js toIso); the length floor here is the backstop.
 */
function asTimestamp(v: unknown): string | null {
  const s = asText(v, 64);
  if (!s) return null;

  // ⚠ THE BACKSTOP HAS TO BE THE YEAR, NOT THE LENGTH.
  //
  // A length floor only catches "Sep 14". It does not catch "Sep 14, 10:00 AM"
  // (16 chars) or "Mon 14 Sep 10:00" — both of which V8 parses happily into a
  // valid Date in the CURRENT year. That is the worst failure available to this
  // function: not a rejected record, but a confidently-wrong booking window,
  // which becomes a block on the wrong dates and then a double-sold car. It
  // would also be invisible in November and wrong in January.
  //
  // Every real instant Turo can send — ISO 8601, RFC 2822, a rendered US or UK
  // date — carries an explicit four-digit year. Anything that does not is a
  // rendered fragment, and a rendered fragment is refused. The reader refuses
  // these upstream too (turo-read-contract.js toIso); this is the server's own
  // copy of the rule, because "the client already checked" is not a check.
  if (!/(?:^|\D)(19|20|21)\d{2}(?:\D|$)/.test(s)) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  // And the year we PARSED must be one the string actually named. A string like
  // "14 2026 Sep" can satisfy the pattern above and still parse to something
  // else entirely; agreeing with itself is cheap to require.
  if (!s.includes(String(d.getUTCFullYear())) && !s.includes(String(d.getFullYear()))) return null;

  return d.toISOString();
}

function asJsonObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function asStringArray(v: unknown, maxItems = 2000, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asText(item, maxLen);
    if (s !== null) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
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

/** A sha256 hex digest and nothing else — mirrors the CHECK in 03 §7. */
function asFingerprint(v: unknown): string | null {
  const s = asText(v, 64);
  return s && /^[0-9a-f]{64}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// TOKEN RESOLUTION — correct against BOTH the live plaintext shape and the
// hashed shape 01-schema.sql introduces. See the header note.
// ---------------------------------------------------------------------------
type Pairing = {
  id: string;
  tenant_id: string;
  revoked_at: string | null;
  column_used: "token_hash" | "token";
};

async function resolvePairing(
  supabase: SupabaseClient,
  token: string,
): Promise<{ pairing: Pairing | null; hardError: string | null }> {
  const tokenHash = await sha256Hex(token);

  // Preferred: equality on a UNIQUE index over the digest of a 256-bit secret.
  // Nothing leaks by timing here that is not already public.
  const digest = await supabase
    .from("turo_bridge_tokens")
    .select("id, tenant_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!digest.error) {
    return {
      pairing: digest.data
        ? { ...(digest.data as Omit<Pairing, "column_used">), column_used: "token_hash" }
        : null,
      hardError: null,
    };
  }

  // 42703 = undefined_column. That is the ONE error we interpret as "this
  // database has not had 01-schema.sql applied yet" — any other error is a real
  // failure and must fail closed rather than silently retry in plaintext.
  if (digest.error.code !== "42703") {
    return { pairing: null, hardError: digest.error.message };
  }

  console.warn(
    "[TURO-BRIDGE] turo_bridge_tokens.token_hash is absent — falling back to the " +
      "plaintext column. APPLY turo-bridge-poc/sql/01-schema.sql: tokens are " +
      "currently stored in the clear.",
  );

  const plain = await supabase
    .from("turo_bridge_tokens")
    .select("id, tenant_id, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (plain.error) return { pairing: null, hardError: plain.error.message };
  return {
    pairing: plain.data
      ? { ...(plain.data as Omit<Pairing, "column_used">), column_used: "token" }
      : null,
    hardError: null,
  };
}

// ---------------------------------------------------------------------------
// RESERVATION NORMALISATION
//
// Tolerant on the way in, LOUD about what it could not understand. Every key we
// looked for and did not find is recorded by name in `unmapped`, and every key
// the payload carried that no extractor claimed survives there too. That is
// "never guess silently" made queryable: after the first real run against a
// real Turo account, `SELECT jsonb_object_keys(unmapped)` IS Turo's schema.
// ---------------------------------------------------------------------------

/** Alias lists. THESE ARE UNCONFIRMED — we have no Turo host account. */
const KEYS = {
  reservation_id: ["reservation_id", "reservationId", "id", "tripId", "trip_id", "reservationCode"],
  guest_name: ["guest_name", "guestName", "renterName", "renter_name", "guest", "driverName"],
  vehicle_label: ["vehicle_label", "vehicleLabel", "vehicleName", "vehicle_name", "listingName", "vehicle"],
  vehicle_plate: ["vehicle_plate", "vehiclePlate", "plate", "licensePlate", "license_plate", "registration", "reg"],
  turo_vehicle_id: ["turo_vehicle_id", "turoVehicleId", "vehicleId", "vehicle_id", "listingId", "listing_id"],
  turo_guest_id: ["turo_guest_id", "turoGuestId", "guestId", "guest_id", "renterId", "driverId"],
  starts_at: ["starts_at", "startsAt", "start", "startTime", "pickupTime", "tripStart", "startDateTime"],
  ends_at: ["ends_at", "endsAt", "end", "endTime", "returnTime", "tripEnd", "endDateTime"],
  turo_status: ["turo_status", "turoStatus", "tripStatus", "trip_status", "state", "reservationStatus"],
  total_amount: ["total_amount", "totalAmount", "total", "earnings", "tripTotal", "amount"],
  currency: ["currency", "currencyCode", "currency_code"],
  timezone: ["timezone", "timeZone", "tz", "locationTimezone"],
  supersedes: [
    "supersedes_reservation_id", "supersedesReservationId", "previousReservationId",
    "previous_reservation_id", "replacesReservationId", "originalReservationId", "rebookedFrom",
  ],
} as const;

type FieldPick = { value: unknown; key: string | null };

function pick(record: Record<string, unknown>, aliases: readonly string[]): FieldPick {
  for (const k of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, k)) {
      const v = record[k];
      if (v !== null && v !== undefined && v !== "") return { value: v, key: k };
    }
  }
  return { value: null, key: null };
}

/**
 * `status` on the wire is ambiguous and always has been. Two different things
 * have been called `status` by the two extension scaffolds:
 *   - OUR import lane ('synced' | 'imported' | 'failed'), which is the shipped
 *     contract turo-bridge-ingest and use-turo-bridge.ts:47 speak; and
 *   - TURO'S OWN trip state ('BOOKED', 'COMPLETED', ...).
 * Disambiguated by VALUE, not by key, and anything unrecognised is treated as
 * Turo's word — the safe direction, because misreading a Turo status as an
 * import status would silently mark a row 'failed'.
 */
function splitStatus(record: Record<string, unknown>): { importStatus: string; turoStatus: string | null; keyUsed: string | null } {
  const explicitTuro = pick(record, KEYS.turo_status);
  const bare = asText(record.status, 60);

  let turoStatus = asText(explicitTuro.value, 60);
  let keyUsed = explicitTuro.key;
  let importStatus = "synced";

  if (bare !== null) {
    if (STATUSES.has(bare)) {
      importStatus = bare;
    } else if (turoStatus === null) {
      turoStatus = bare;
      keyUsed = "status";
    }
  }
  return { importStatus, turoStatus, keyUsed };
}

type NormalisedRow = {
  ok: true;
  reservationId: string;
  row: Record<string, unknown>;
  unknowns: string[];
  /** The id of the trip THIS one replaces, if the feed said so. Backward pointer. */
  supersedes: string | null;
} | {
  ok: false;
  reservationId: string | null;
  reason: string;
  observedKeys: string[];
};

function normaliseReservation(
  raw: unknown,
  tenantId: string,
  resolvedSource: string,
  jobId: string | null,
  parserVersion: string | null,
  nowIso: string,
): NormalisedRow {
  const record = asJsonObject(raw);
  const observedKeys = Object.keys(record);

  const idPick = pick(record, KEYS.reservation_id);
  const reservationId = asText(idPick.value, 120);
  if (!reservationId) {
    return {
      ok: false,
      reservationId: null,
      reason: "no recognised reservation id",
      observedKeys,
    };
  }

  const claimed = new Set<string>([idPick.key!].filter(Boolean) as string[]);
  const evidence: Record<string, string> = { reservation_id: idPick.key ?? "unconfirmed" };
  const unknowns: Record<string, unknown> = {};
  const missing: string[] = [];

  const take = (field: keyof typeof KEYS, max: number): string | null => {
    const p = pick(record, KEYS[field]);
    if (p.key) {
      claimed.add(p.key);
      evidence[field] = p.key;
      return asText(p.value, max);
    }
    evidence[field] = "unconfirmed";
    missing.push(field);
    return null;
  };

  const guestName = take("guest_name", 160);
  const vehicleLabel = take("vehicle_label", 200);
  const vehiclePlate = take("vehicle_plate", 40);
  const turoVehicleId = take("turo_vehicle_id", 120);
  const turoGuestId = take("turo_guest_id", 120);
  const currency = take("currency", 3);
  const timezone = take("timezone", 64);
  const supersedes = take("supersedes", 120);

  const startPick = pick(record, KEYS.starts_at);
  const endPick = pick(record, KEYS.ends_at);
  if (startPick.key) { claimed.add(startPick.key); evidence.starts_at = startPick.key; }
  else { evidence.starts_at = "unconfirmed"; missing.push("starts_at"); }
  if (endPick.key) { claimed.add(endPick.key); evidence.ends_at = endPick.key; }
  else { evidence.ends_at = "unconfirmed"; missing.push("ends_at"); }

  const startsAt = asTimestamp(startPick.value);
  const endsAt = asTimestamp(endPick.value);

  // A date we could not parse is REPORTED, never approximated. Importing a
  // confidently-wrong booking window is how a car gets blocked on the wrong
  // days — or, worse, left on sale on the right ones.
  if (startPick.key && startPick.value !== null && startsAt === null) {
    unknowns[startPick.key] = { field: "starts_at", reason: "value_unparseable", sample: String(startPick.value).slice(0, 80) };
  }
  if (endPick.key && endPick.value !== null && endsAt === null) {
    unknowns[endPick.key] = { field: "ends_at", reason: "value_unparseable", sample: String(endPick.value).slice(0, 80) };
  }

  const amountPick = pick(record, KEYS.total_amount);
  if (amountPick.key) { claimed.add(amountPick.key); evidence.total_amount = amountPick.key; }
  const totalAmount = asAmount(amountPick.value);

  const { importStatus, turoStatus, keyUsed } = splitStatus(record);
  if (keyUsed) claimed.add(keyUsed);
  claimed.add("status");
  evidence.turo_status = keyUsed ?? "unconfirmed";

  // Every key no extractor claimed. This is the half of `unmapped` that lets a
  // Turo rename be diagnosed instead of merely suffered.
  const overflowSource = asJsonObject(record.raw ?? record);
  for (const k of Object.keys(overflowSource)) {
    if (claimed.has(k)) continue;
    if (k === "raw" || k === "source") continue;
    unknowns[k] = { field: null, reason: "no_key_matched", sample: sampleOf(overflowSource[k]) };
  }
  for (const f of missing) {
    unknowns[`__missing.${f}`] = { field: f, reason: "no_key_matched", candidatesTried: KEYS[f as keyof typeof KEYS] };
  }

  // The whole object always travels along: guessing a column wrong then costs
  // one NULL, not the reservation.
  const rawPayload = asJsonObject(record.raw);
  const rawOut: Record<string, unknown> = Object.keys(rawPayload).length > 0 ? { ...rawPayload } : { ...record };
  // apps/portal/src/hooks/use-turo-bridge.ts:63 reads raw.__turo_status and
  // NOTHING has ever written it. Written here as well as into the column, so
  // the shipped hook starts telling the truth without being touched.
  if (turoStatus !== null) rawOut.__turo_status = turoStatus;
  if (timezone !== null) rawOut.__turo_timezone = timezone;

  if (JSON.stringify(rawOut).length > MAX_RAW_BYTES) {
    return { ok: false, reservationId, reason: "payload too large", observedKeys };
  }

  const row: Record<string, unknown> = {
    tenant_id: tenantId,           // from the token. Never from the request body.
    reservation_id: reservationId,
    source: resolvedSource,
    guest_name: guestName,
    vehicle_label: vehicleLabel,
    vehicle_plate: vehiclePlate,   // the ONLY safe vehicle join key (vehicles.reg)
    turo_vehicle_id: turoVehicleId,
    turo_guest_id: turoGuestId,
    turo_status: turoStatus,       // TURO'S word, never ours
    starts_at: startsAt,
    ends_at: endsAt,
    status: importStatus,          // OUR import lane; legacy wire contract
    total_amount: totalAmount,
    currency: currency ? currency.toUpperCase() : null,
    raw: rawOut,
    unmapped: unknowns,
    field_confidence: evidence,
    parser_version: parserVersion,
    synced_at: nowIso,
    updated_at: nowIso,
    last_seen_at: nowIso,
  };
  if (jobId) row.last_seen_job_id = jobId;

  // ⚠ DIRECTION. The alias list above ("previousReservationId",
  //   "originalReservationId", "rebookedFrom") reads the id of the trip this
  //   one REPLACES — a backward pointer, new -> old. The column
  //   `superseded_by_reservation_id` is the FORWARD one, old -> new: §12's
  //   CHECK turo_bridge_reservations_superseded_needs_successor only makes
  //   sense that way round, and reconcile writes it that way when it detects a
  //   reissue itself.
  //
  //   Writing the claim onto THIS row would therefore say "this brand-new trip
  //   has already been replaced by its own predecessor" — backwards, and it
  //   would let a row satisfy the SUPERSEDED constraint while pointing at a
  //   trip that is over. The claim is carried out of here instead and stamped
  //   onto the PREDECESSOR after the batch lands (see §7b below).
  return { ok: true, reservationId, row, unknowns: Object.keys(unknowns), supersedes };
}

function sampleOf(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return (s ?? "null").slice(0, 120);
  } catch {
    return "(unserialisable)";
  }
}

// ---------------------------------------------------------------------------
// WRITE SAFETY
// ---------------------------------------------------------------------------
function resolveWriteSafety(
  outcome: string | null,
  clientSaysSafe: unknown,
): { writeSafe: boolean; why: string | null } {
  // No outcome declared at all: this is the legacy single-record path, which
  // predates the taxonomy. Treat it as writeSafe — it always has been — and
  // note the absence on the run.
  if (outcome === null) return { writeSafe: true, why: null };

  const serverVerdict = WRITE_SAFE[outcome];
  if (serverVerdict === undefined) {
    return { writeSafe: false, why: `outcome '${outcome}' is not in the server's policy table` };
  }
  if (!serverVerdict) {
    return {
      writeSafe: false,
      why: outcome === "EMPTY_UNCONFIRMED"
        ? "the read returned a valid but empty body that nothing corroborated — indistinguishable from a WAF answering 200 with nothing"
        : `read outcome ${outcome} is not safe to write from`,
    };
  }
  // The client may only ever tighten. A client that says "do not write" is
  // obeyed; a client that says "do write" over a server NO is ignored.
  if (clientSaysSafe === false) {
    return { writeSafe: false, why: "the client marked this run unsafe to write from" };
  }
  return { writeSafe: true, why: null };
}

// ---------------------------------------------------------------------------
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
  const { pairing, hardError } = await resolvePairing(supabase, token);

  if (hardError) {
    console.error("[TURO-BRIDGE] Token lookup failed:", hardError);
    // Fail closed: an unreadable token table is never an authorised request.
    return errorResponse("Could not verify the pairing token.", 500);
  }
  if (!pairing) return errorResponse("Pairing token not recognised.", 401);
  if (pairing.revoked_at) {
    // Distinguishable on purpose: the holder of a revoked token is a known
    // operator who needs to be told to get a new one, not an unknown prober.
    return errorResponse("This pairing token has been revoked.", 401);
  }

  // THE ONLY SOURCE OF TENANT IDENTITY IN THIS FUNCTION.
  const tenantId = pairing.tenant_id;
  const nowIso = new Date().toISOString();

  // ---- 2. Provenance -----------------------------------------------------
  const singleReservation =
    body.reservation && typeof body.reservation === "object" && !Array.isArray(body.reservation)
      ? body.reservation as Record<string, unknown>
      : body.trip && typeof body.trip === "object" && !Array.isArray(body.trip)
      ? body.trip as Record<string, unknown>
      : null;

  const listed =
    Array.isArray(body.reservations) ? body.reservations
    : Array.isArray(body.trips) ? body.trips
    : null;

  if (!listed && !singleReservation) {
    return errorResponse("Missing `reservations` array (or a single `reservation` object).", 400);
  }
  const incoming: unknown[] = listed ?? [singleReservation as unknown];
  const legacySingle = !listed;

  if (incoming.length > MAX_BATCH_RECORDS) {
    return errorResponse(
      `Too many reservations in one call (${incoming.length} > ${MAX_BATCH_RECORDS}). Send them a page at a time.`,
      413,
    );
  }

  const declaredSource =
    asText(singleReservation?.source, 20) ??
    asText(body.source, 20) ??
    asText(asJsonObject(body.job).source, 20);
  const source = normaliseSource(declaredSource);
  if (source === "invalid") {
    return errorResponse("`source` must be 'turo' (live) or 'fixture' (bundled demo data).", 400);
  }
  // Absent means live: the fixture path always labels itself explicitly.
  const resolvedSource = source ?? "turo";
  if (!SOURCES.has(resolvedSource)) return errorResponse("Unrecognised `source`.", 400);

  // ---- 3. The run --------------------------------------------------------
  const job = asJsonObject(body.job);
  const jobKindRaw = asText(job.kind ?? job.job_kind, 30);
  const jobKind = jobKindRaw && JOB_KINDS.has(jobKindRaw)
    ? jobKindRaw
    : legacySingle ? "manual_single" : "trips";

  const readerOutcomeRaw = asText(job.reader_outcome ?? job.outcome, 30);
  const readerOutcome = readerOutcomeRaw && READER_OUTCOMES.has(readerOutcomeRaw) ? readerOutcomeRaw : null;
  if (readerOutcomeRaw && !readerOutcome) {
    // An unrecognised outcome is not defaulted to OK. It is recorded as UNKNOWN
    // below, which is NOT writeSafe — the safe direction for a value we have
    // never seen.
    console.warn(`[TURO-BRIDGE] unrecognised reader_outcome '${readerOutcomeRaw}'`);
  }
  const effectiveOutcome = readerOutcomeRaw ? (readerOutcome ?? "UNKNOWN") : null;

  const degradedReasonRaw = asText(job.degraded_reason, 40);
  const degradedReason = degradedReasonRaw
    // The vocabulary is a CLOSED CHECK list written against failures we
    // PREDICTED, not observed. An unrecognised one becomes 'unknown' rather
    // than being dropped: a failure we cannot name is still a failure, and
    // 'unknown' is not authoritative either.
    ? (DEGRADED_REASONS.has(degradedReasonRaw) ? degradedReasonRaw : "unknown")
    : null;

  const { writeSafe, why: unsafeReason } = resolveWriteSafety(effectiveOutcome, job.write_safe);

  const fingerprint = asFingerprint(job.turo_account_fingerprint);
  const accountRef = asText(job.turo_account_ref, 200);

  // Observations only. completeness / is_authoritative / observed_complete /
  // progress_denominator are GENERATED ALWAYS and are not writable from here —
  // by anyone, service_role included.
  const jobObservations: Record<string, unknown> = {
    tenant_id: tenantId,
    token_id: pairing.id,
    job_kind: jobKind,
    source: resolvedSource,
    saw_end_of_feed: asBool(job.saw_end_of_feed),
    degraded_reason: degradedReason,
    http_error_count: asInt(job.http_error_count) ?? 0,
    parse_failure_count: asInt(job.parse_failure_count) ?? 0,
    pages_fetched: asInt(job.pages_fetched) ?? 0,
    records_seen: asInt(job.records_seen) ?? incoming.length,
    raw_item_count: asInt(job.raw_item_count),
    reader_outcome: effectiveOutcome,
    // feed_reported_total is captured and NEVER used as a denominator: it
    // arrives from the same possibly-degraded surface as the records.
    feed_reported_total: asInt(job.feed_reported_total),
    requested_window_start: asTimestamp(job.requested_window_start),
    requested_window_end: asTimestamp(job.requested_window_end),
    window_start: asTimestamp(job.window_start),
    window_end: asTimestamp(job.window_end),
    observed_turo_vehicle_ids: asStringArray(job.observed_turo_vehicle_ids),
    turo_account_fingerprint: fingerprint,
    turo_account_ref: accountRef,
    heartbeat_at: nowIso,
    updated_at: nowIso,
  };

  const finalize = asBool(job.finalize ?? job.finalise ?? (legacySingle ? true : false));

  // ---- 3a. Open or continue the run --------------------------------------
  let jobId = asText(job.job_id ?? job.id, 64);
  const isContinuation = jobId !== null;
  let jobRow: Record<string, unknown> | null = null;

  if (jobId) {
    const { data: existingJob, error: jobReadError } = await supabase
      .from("turo_sync_jobs")
      .select("id, tenant_id, state, records_seen, records_ingested, parsed_count, pages_fetched, observed_turo_vehicle_ids")
      .eq("id", jobId)
      .maybeSingle();

    if (jobReadError) {
      console.error("[TURO-BRIDGE] job lookup failed:", jobReadError.message);
      return errorResponse("Could not read the sync run.", 500);
    }
    // A job id from the body that is not ours is not an error we explain — it
    // is simply not found. Cross-tenant probing gets nothing back.
    if (!existingJob || existingJob.tenant_id !== tenantId) {
      return errorResponse("Unknown sync run.", 404);
    }
    if (existingJob.state !== "running") {
      return errorResponse(
        `Sync run ${jobId} is already ${existingJob.state}. A finished run's evidence is immutable — start a new one.`,
        409,
      );
    }
    jobRow = existingJob as Record<string, unknown>;
  } else {
    // Cumulative counters start at this page's numbers.
    const { data: created, error: createError } = await supabase
      .from("turo_sync_jobs")
      .insert({ ...jobObservations, state: "running", started_at: nowIso, records_ingested: 0, parsed_count: 0 })
      .select("id, tenant_id, state, records_seen, records_ingested, parsed_count, pages_fetched, observed_turo_vehicle_ids")
      .single();

    if (createError) {
      // The partial unique index turo_sync_jobs_one_running_per_kind means a
      // second concurrent run of the same kind for one tenant is refused. That
      // is deliberate: two readers racing over one Turo session produce two
      // half-windows and neither is authoritative.
      if (createError.code === "23505") {
        return errorResponse(
          "A sync of this kind is already running for this account. Wait for it to finish, or let the reaper retire it.",
          409,
        );
      }
      // 23514 from the §7 guard = the account fingerprint pin. One Chrome
      // profile can hold one Turo cookie jar and be paired to two Drive247
      // tenants over its life; syncing A's trips into B is the worst outcome
      // available in this system, so it is refused rather than warned about.
      if (createError.code === "23514") {
        console.error("[TURO-BRIDGE] run refused by a guard:", createError.message);
        return errorResponse(createError.message, 409);
      }
      console.error("[TURO-BRIDGE] could not open sync run:", createError.message);
      return errorResponse("Could not open the sync run.", 500);
    }
    jobRow = created as Record<string, unknown>;
    jobId = created!.id as string;
  }

  // ---- 3b. Page receipts -------------------------------------------------
  // url_path is a PATH ONLY. A session-bearing query string must never be
  // persisted, and observed_keys holds TOP-LEVEL KEY NAMES ONLY — enough to
  // diagnose a rename, never enough to leak a guest.
  const pages = Array.isArray(job.pages) ? job.pages.slice(0, MAX_PAGES_PER_CALL) : [];
  if (pages.length > 0) {
    const pageRows = pages.map((p) => {
      const page = asJsonObject(p);
      const rawPath = asText(page.url_path ?? page.path, 300) ?? "";
      const prRaw = asText(page.degraded_reason, 40);
      return {
        tenant_id: tenantId,
        job_id: jobId,
        seq: asInt(page.seq ?? page.index) ?? 0,
        requested_at: asTimestamp(page.requested_at) ?? nowIso,
        url_path: rawPath.split("?")[0].slice(0, 300) || null,
        http_status: asInt(page.http_status, 0, 999),
        byte_count: asInt(page.byte_count),
        record_count: asInt(page.record_count),
        cursor_in: asText(page.cursor_in, 400),
        cursor_out: asText(page.cursor_out, 400),
        degraded_reason: prRaw ? (DEGRADED_REASONS.has(prRaw) ? prRaw : "unknown") : null,
        observed_keys: asStringArray(page.observed_keys, 200, 120),
      };
    });
    const { error: pageError } = await supabase
      .from("turo_sync_job_pages")
      .upsert(pageRows, { onConflict: "job_id,seq" });
    if (pageError) {
      // A lost page receipt costs diagnosis, not correctness. Never fail an
      // ingest that could otherwise land real bookings.
      console.error("[TURO-BRIDGE] page receipts failed:", pageError.message);
    }
  }

  // ---- 4. THE DEGRADED-RUN GATE ------------------------------------------
  // Not writeSafe => ZERO reservation rows. The run row is still written and
  // finalised, because a degradation nobody can see is a degradation nobody
  // fixes.
  if (!writeSafe) {
    const { error: finErr } = await supabase
      .from("turo_sync_jobs")
      .update({
        ...jobObservations,
        state: "failed",
        finished_at: nowIso,
        // failure_needs_reason CHECK: a failed run must name a reason.
        degraded_reason: degradedReason ?? mapOutcomeToReason(effectiveOutcome),
        // ⚠ NEVER let records_seen fall below what earlier pages already
        //   ingested: turo_sync_jobs_ingested_le_seen would reject the update
        //   and a degraded read would surface as a 500 instead of the honest
        //   "nothing was written" this branch exists to return.
        records_seen: Math.max(
          asInt(jobRow?.records_seen) ?? 0,
          asInt(jobRow?.records_ingested) ?? 0,
          asInt(job.records_seen) ?? 0,
        ),
        records_ingested: (asInt(jobRow?.records_ingested) ?? 0),
        parsed_count: (asInt(jobRow?.parsed_count) ?? 0),
        notes: unsafeReason,
      })
      .eq("id", jobId)
      .eq("tenant_id", tenantId);
    if (finErr) console.error("[TURO-BRIDGE] could not finalise a degraded run:", finErr.message);

    console.warn(`[TURO-BRIDGE] degraded run ${jobId} wrote nothing: ${unsafeReason}`);
    return jsonResponse({
      ok: true,
      success: true,
      job_id: jobId,
      write_safe: false,
      wrote_nothing_because: unsafeReason,
      counts: { received: incoming.length, created: 0, updated: 0, rejected: 0 },
      results: [],
      // Said plainly, because this is the message that stops an operator
      // concluding their Turo calendar is empty.
      advice:
        "This read could not be trusted, so nothing was written and nothing was released. " +
        "Existing availability blocks are untouched. Open turo.com in a normal tab, " +
        "confirm you are signed in as the host, then sync again.",
    }, 200);
  }

  // ---- 5. Normalise ------------------------------------------------------
  const parserVersion = asText(body.parser_version ?? job.parser_version, 40);
  const rows: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  /** new -> old claims, applied to the PREDECESSOR after the batch lands. */
  const supersessions: { predecessor: string; successor: string }[] = [];

  for (const item of incoming) {
    const n = normaliseReservation(item, tenantId, resolvedSource, jobId, parserVersion, nowIso);
    if (!n.ok) {
      results.push({
        reservation_id: n.reservationId,
        action: "rejected",
        reason: n.reason,
        // The keys the payload DID carry. If Turo renamed the id field, this is
        // where you read its new name.
        observed_keys: n.observedKeys.slice(0, 60),
      });
      continue;
    }
    // A page replayed after an MV3 kill can carry the same trip twice. Last one
    // wins locally so the upsert does not see a duplicate key in one statement.
    if (seenIds.has(n.reservationId)) {
      const idx = rows.findIndex((r) => r.reservation_id === n.reservationId);
      if (idx >= 0) rows[idx] = n.row;
    } else {
      seenIds.add(n.reservationId);
      rows.push(n.row);
    }
    if (n.supersedes && n.supersedes !== n.reservationId) {
      supersessions.push({ predecessor: n.supersedes, successor: n.reservationId });
    }
    results.push({ reservation_id: n.reservationId, action: "pending", unknown_fields: n.unknowns.slice(0, 40) });
  }

  // ---- 6. Which of these did we already hold? ----------------------------
  // Read BEFORE the write: PostgREST cannot report which branch an upsert took,
  // and per-record outcome is part of this endpoint's contract.
  const existingIds = new Set<string>();
  if (seenIds.size > 0) {
    const ids = [...seenIds];
    for (let i = 0; i < ids.length; i += 200) {
      const { data: found } = await supabase
        .from("turo_bridge_reservations")
        .select("reservation_id")
        .eq("tenant_id", tenantId)
        .in("reservation_id", ids.slice(i, i + 200));
      for (const r of found ?? []) existingIds.add(r.reservation_id as string);
    }
  }

  // first_seen_job_id is stamped only on rows we have never held. On an upsert
  // PostgREST sends every column, so setting it unconditionally would rewrite
  // history on every re-sync.
  for (const r of rows) {
    if (!existingIds.has(r.reservation_id as string)) r.first_seen_job_id = jobId;
  }

  // ---- 7. Upsert on the tenant-scoped unique key -------------------------
  let saved: Record<string, unknown>[] = [];
  let writeFailure: string | null = null;

  if (rows.length > 0) {
    const { data, error: writeError } = await supabase
      .from("turo_bridge_reservations")
      .upsert(rows, { onConflict: "tenant_id,reservation_id" })
      .select(
        "id, reservation_id, source, guest_name, vehicle_label, vehicle_plate, starts_at, ends_at, status, turo_status, sync_state, presence_state, total_amount, currency, synced_at",
      );

    if (writeError) {
      console.error("[TURO-BRIDGE] batch upsert failed:", writeError.message);
      // ⚠ ALL-OR-NOTHING, ON PURPOSE. PostgREST runs one upsert as one
      // statement, so a constraint violation on any row rolls back the whole
      // batch. Retrying row-by-row here would turn one loud failure into a
      // half-written page, and a half-written page is exactly the state that
      // makes a later reconcile think trips have vanished. Report and stop.
      writeFailure = writeError.message;
    } else {
      saved = (data ?? []) as Record<string, unknown>[];
    }
  }

  if (writeFailure) {
    await supabase
      .from("turo_sync_jobs")
      .update({
        ...jobObservations,
        state: "failed",
        finished_at: nowIso,
        degraded_reason: degradedReason ?? "unknown",
        records_seen: Math.max(
          asInt(jobRow?.records_seen) ?? 0,
          asInt(jobRow?.records_ingested) ?? 0,
          asInt(job.records_seen) ?? 0,
        ),
        notes: `batch write failed: ${writeFailure}`,
      })
      .eq("id", jobId)
      .eq("tenant_id", tenantId);

    return jsonResponse({
      ok: false,
      success: false,
      job_id: jobId,
      error: "Could not save the reservations.",
      detail: writeFailure,
      counts: { received: incoming.length, created: 0, updated: 0, rejected: results.filter((r) => r.action === "rejected").length },
      results,
    }, 500);
  }

  // ---- 7b. Succession, stamped on the PREDECESSOR ------------------------
  // A reissued trip is a NEW row plus a forward pointer on the OLD one — never
  // an in-place rename of reservation_id, which the §7 guard refuses outright.
  //
  // Only ever stamped when the predecessor does not already carry one: a later
  // read must not silently re-target an existing succession, and a block that
  // is already following one chain must not be quietly handed to another.
  // presence_state is deliberately NOT touched here. Ingest records what the
  // feed said; reconcile is the only thing that draws conclusions from it.
  const supersessionResults: Record<string, unknown>[] = [];
  for (const link of supersessions) {
    if (link.predecessor === link.successor) continue;
    const { data: stamped, error: supError } = await supabase
      .from("turo_bridge_reservations")
      .update({ superseded_by_reservation_id: link.successor, superseded_at: nowIso, updated_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("reservation_id", link.predecessor)
      .is("superseded_by_reservation_id", null)
      .select("id");
    if (supError) {
      // Never fatal: the successor has already landed, which is the half that
      // keeps the car blocked. A missing link costs a review item, not a car.
      console.error("[TURO-BRIDGE] succession stamp failed:", supError.message);
      supersessionResults.push({ ...link, linked: false, because: supError.message });
    } else {
      supersessionResults.push({
        ...link,
        linked: (stamped ?? []).length > 0,
        because: (stamped ?? []).length > 0
          ? null
          : "the earlier trip is not staged here, or it is already linked to a different successor",
      });
    }
  }

  const savedById = new Map(saved.map((s) => [s.reservation_id as string, s]));
  let created = 0;
  let updated = 0;
  for (const r of results) {
    if (r.action !== "pending") continue;
    const id = r.reservation_id as string;
    if (existingIds.has(id)) { r.action = "updated"; updated++; } else { r.action = "created"; created++; }
    const s = savedById.get(id);
    if (s) { r.row_id = s.id; r.sync_state = s.sync_state; r.presence_state = s.presence_state; }
  }
  const rejected = results.filter((r) => r.action === "rejected").length;

  // ---- 8. Advance the run ------------------------------------------------
  // On a NEW run the insert already stamped this page's numbers, so only a
  // CONTINUATION adds to them. Getting this wrong double-counts page 1 and
  // makes a 3-trip fleet look like 6.
  const cumulativeSeen = (asInt(jobRow?.records_seen) ?? 0) + (isContinuation ? incoming.length : 0);
  const cumulativeIngested = (asInt(jobRow?.records_ingested) ?? 0) + rows.length;
  const cumulativeParsed = (asInt(jobRow?.parsed_count) ?? 0) + rows.length;
  const priorVehicles = asStringArray(jobRow?.observed_turo_vehicle_ids);
  const observedVehicles = [...new Set([
    ...priorVehicles,
    ...asStringArray(job.observed_turo_vehicle_ids),
    // A trip we positively read IS an observation of its vehicle. Without this
    // the release gate in 03 §7 (rule 3) can never be satisfied on a feed that
    // does not separately enumerate vehicles.
    ...rows.map((r) => r.turo_vehicle_id).filter((v): v is string => typeof v === "string" && v !== ""),
  ])];

  const jobUpdate: Record<string, unknown> = {
    ...jobObservations,
    records_seen: Math.max(cumulativeSeen, cumulativeIngested, asInt(job.records_seen) ?? 0, incoming.length),
    records_ingested: cumulativeIngested,
    parsed_count: cumulativeParsed,
    pages_fetched: Math.max(asInt(jobRow?.pages_fetched) ?? 0, asInt(job.pages_fetched) ?? 0, pages.length),
    observed_turo_vehicle_ids: observedVehicles,
  };

  if (finalize) {
    jobUpdate.state = "succeeded";
    jobUpdate.finished_at = nowIso;
    // A run may not claim to have reached the end of the feed AND report a
    // degraded reason: the generated columns would call that partial anyway,
    // but leaving the contradiction in the row misleads whoever reads it later.
    if (degradedReason) jobUpdate.saw_end_of_feed = false;
  }

  const { data: finishedJob, error: jobUpdateError } = await supabase
    .from("turo_sync_jobs")
    .update(jobUpdate)
    .eq("id", jobId)
    .eq("tenant_id", tenantId)
    .select("id, state, completeness, is_authoritative, observed_complete, degraded, progress_denominator, records_seen, records_ingested, parsed_count, window_start, window_end")
    .maybeSingle();

  if (jobUpdateError) {
    // The reservations already landed and that is the valuable half. A run row
    // that cannot be advanced simply never becomes authoritative, which is the
    // safe failure: nothing can be released on its evidence.
    console.error("[TURO-BRIDGE] could not advance the run:", jobUpdateError.message);
  }

  // Best effort — a failed touch must never fail an import that already landed.
  const { error: touchError } = await supabase
    .from("turo_bridge_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", pairing.id);
  if (touchError) console.error("[TURO-BRIDGE] last_used_at touch failed:", touchError.message);

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

  console.log(
    `[TURO-BRIDGE] run ${jobId}: +${created} new, ${updated} updated, ${rejected} rejected ` +
      `(source=${resolvedSource}, tenant ${tenantId}, token column '${pairing.column_used}')`,
  );

  // ---- 9. Respond --------------------------------------------------------
  const authoritative = finishedJob?.is_authoritative === true;
  const payload: Record<string, unknown> = {
    ok: true,
    success: true,
    job_id: jobId,
    write_safe: true,
    tenantName,
    counts: { received: incoming.length, created, updated, rejected },
    results,
    supersessions: supersessionResults,
    run: finishedJob
      ? {
          state: finishedJob.state,
          completeness: finishedJob.completeness,
          is_authoritative: finishedJob.is_authoritative,
          observed_complete: finishedJob.observed_complete,
          degraded: finishedJob.degraded,
          // NULL unless the run is genuinely complete. A progress bar that
          // divides by this renders nothing on a truncated read instead of a
          // confident 8/8 green.
          progress_denominator: finishedJob.progress_denominator,
          records_seen: finishedJob.records_seen,
          parsed_count: finishedJob.parsed_count,
        }
      : null,
    // The one sentence an operator needs. Never the word "complete" unless the
    // database itself said so.
    coverage_note: !finalize
      ? "Page accepted. The run is still open."
      : authoritative
      ? "This read reached the end of the feed cleanly and can be used as evidence."
      : "Records were saved, but this read could not prove it saw everything — so nothing will be released on its evidence.",
  };

  // Legacy single-reservation shape, preserved byte-for-byte for the shipped
  // popup and use-turo-bridge.ts.
  if (legacySingle) {
    const only = saved[0] ?? null;
    payload.action = created ? "created" : updated ? "updated" : "rejected";
    payload.reservation = only;
  }

  return jsonResponse(payload);
});

/** A failed run must name a reason (turo_sync_jobs_failure_needs_reason). */
function mapOutcomeToReason(outcome: string | null): string {
  switch (outcome) {
    case "EMPTY_UNCONFIRMED": return "waf_empty_200";
    case "BOT_BLOCKED": return "waf_challenge";
    case "NOT_LOGGED_IN": return "not_signed_in";
    case "RATE_LIMITED": return "http_error";
    case "UNREACHABLE": return "http_error";
    case "SHAPE_CHANGED": return "shape_unrecognised";
    case "UNPARSEABLE": return "shape_unrecognised";
    default: return "unknown";
  }
}
