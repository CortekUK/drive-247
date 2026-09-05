/**
 * useTuroBridge — read side of the Drive247 Turo Bridge, plus the operator
 * actions that a human (never a sync) initiates against it.
 *
 * Rows in `public.turo_bridge_reservations` are written ONLY by the
 * `turo-bridge-ingest` edge function (service_role) on behalf of the Chrome
 * extension. The portal never writes here — every mutation below goes through
 * an edge function, because RLS on the Turo tables grants `authenticated`
 * SELECT and nothing else (see turo-bridge-poc/sql/03-foundation-schema.sql,
 * section 9: `REVOKE ALL ... FROM anon, authenticated;` then
 * `GRANT SELECT ... TO authenticated;`). A client-side write would simply be
 * refused, and dressing one up as an optimistic update would lie to the
 * operator about work that never happened.
 *
 * Schema verified against the live database (project hviqoaokxvlancmftwuo) on
 * 2026-09-02, not against the migration file: the table exists with RLS ON and
 * exactly one SELECT policy,
 *
 *   turo_bridge_reservations_select_own_tenant
 *     FOR SELECT TO authenticated
 *     USING (tenant_id = get_user_tenant_id() OR is_super_admin())
 *
 * which is the same shape as push_subscriptions.
 *
 * ── WHAT IS AND IS NOT IN THE DATABASE RIGHT NOW ─────────────────────────────
 *
 * Live today (information_schema, 2026-09-02) the table carries EXACTLY the 15
 * original PoC columns listed in `TURO_BRIDGE_LEGACY_COLUMNS`. The 34 columns
 * added by `turo-bridge-poc/sql/03-foundation-schema.sql` — `sync_state`,
 * `vehicle_map_id`, `hold_until`, `unmapped`, and the rest — DO NOT EXIST YET,
 * and neither do `turo_sync_jobs`, `turo_vehicle_map`, `turo_bridge_customers`
 * or `turo_sync_job_pages`. That file has not been applied.
 *
 * That single fact drives the read strategy here: this hook selects `*` rather
 * than naming columns. Naming a column PostgREST cannot find returns 42703 and
 * fails the WHOLE query, so a hook written against the future schema would take
 * the working PoC screen down the moment it shipped, and applying the schema
 * would be the only way to get it back. Selecting `*` returns whatever exists;
 * every foundation field is then read through a reader function that reports
 * ABSENT rather than substituting a value. Absence of a column is a fact about
 * our deployment, and it is surfaced as such — it is never rendered as a state.
 *
 * ── THE ONE RULE EVERYTHING ELSE SERVES ──────────────────────────────────────
 *
 * ABSENCE NEVER RELEASES. Nothing in this file infers that a trip ended, was
 * cancelled, or may be unblocked. A reservation missing from a read is a
 * question, not an answer, and only the server (which can see whether the
 * observing job was authoritative) is allowed to answer it. The portal's job is
 * to show the operator what is known, what is unknown, and which of the two
 * they are looking at.
 */
"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

/* ────────────────────────────────────────────────────────────────────────────
 * 1. ROW SHAPES
 * ──────────────────────────────────────────────────────────────────────────*/

/** One reservation pulled off Turo by the browser extension. */
export interface TuroBridgeReservation {
  id: string;
  tenant_id: string;
  /** Turo's own trip id. TEXT, not a number — Turo returns both shapes. */
  reservation_id: string;
  /**
   * Which path produced this row. 'fixture' means the extension could not reach
   * a real Turo session and fell back to its bundled sample. This is persisted
   * rather than inferred precisely so demo data can never be mistaken for a
   * real booking — the UI must keep labelling it.
   */
  source: "turo" | "fixture";
  guest_name: string | null;
  vehicle_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /**
   * OUR sync state, never Turo's trip state. Turo's own status is preserved at
   * `raw.__turo_status` so the two can never fight over one column.
   *
   * NOTE this is the IMPORT lane and it keeps that meaning forever: the
   * foundation schema deliberately leaves it alone because
   * `turo-bridge-ingest/index.ts:50` and this hook are its shipped wire
   * contract. Reconciliation state lives in `sync_state`, which is a different
   * column answering a different question.
   */
  status: "synced" | "imported" | "failed";
  total_amount: number | string | null;
  currency: string | null;
  /** The untouched Turo trip object, plus our `__drive247_*` provenance stamps. */
  raw: Record<string, unknown> | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * The six-state reconciliation machine from
 * turo-bridge-poc/sql/03-foundation-schema.sql. The transition table is
 * enforced by a database trigger, so this union is a mirror and never a source
 * of truth — if the server rejects a transition, the server is right.
 */
export type TuroSyncState =
  | "pending_match"
  | "staged"
  | "promoted"
  | "cancellation_candidate"
  | "conflict"
  | "ignored";

export const TURO_SYNC_STATES: readonly TuroSyncState[] = [
  "pending_match",
  "staged",
  "promoted",
  "cancellation_candidate",
  "conflict",
  "ignored",
] as const;

/** Operator-readable labels. Deliberately plain; no state is a verdict. */
export const TURO_SYNC_STATE_LABEL: Record<TuroSyncState, string> = {
  pending_match: "Needs a vehicle",
  staged: "Ready to promote",
  promoted: "Promoted",
  cancellation_candidate: "Missing from Turo",
  conflict: "Conflict",
  ignored: "Ignored",
};

/**
 * The reconciliation designer's parallel PRESENCE lane
 * (`turo_bridge_reservations.presence_state`). It is not in the foundation DDL
 * and is not applied either; it is read here purely so that if it lands, this
 * hook shows it instead of silently ignoring a column that exists.
 */
export type TuroPresenceState =
  | "OBSERVED"
  | "MISSING"
  | "COMPLETED_HOLD"
  | "CLOSED"
  | "CANCELLED"
  | "SUPERSEDED"
  | "RELEASED_BY_OPERATOR"
  | "QUARANTINED";

/**
 * Everything the foundation schema adds, all optional, because none of it
 * exists in production yet. `undefined` means THE COLUMN IS NOT THERE; `null`
 * means the column exists and is empty. Those are different facts and the
 * readers below keep them apart.
 */
export interface TuroBridgeReservationExtras {
  sync_state?: TuroSyncState | null;
  state_changed_at?: string | null;
  state_reason?: string | null;

  first_seen_job_id?: string | null;
  last_seen_job_id?: string | null;
  last_seen_at?: string | null;
  seen_count?: number | null;

  turo_trip_status?: string | null;
  /** Added by the promotion designer (J3); may arrive before or after `turo_trip_status`. */
  turo_status?: string | null;
  turo_vehicle_id?: string | null;
  turo_guest_id?: string | null;
  /** Added by the promotion designer (J2). The plate is the only safe join key. */
  vehicle_plate?: string | null;

  vehicle_map_id?: string | null;
  matched_vehicle_id?: string | null;
  turo_bridge_customer_id?: string | null;
  match_basis?: "turo_vehicle_id" | "label_exact" | "label_alias" | "human" | null;

  /** Keys the parser did not recognise. "Never guess silently", made queryable. */
  unmapped?: Record<string, unknown> | null;
  /** Which wire key produced each column, or 'unconfirmed'. */
  field_confidence?: Record<string, unknown> | null;
  parser_version?: string | null;

  missing_since?: string | null;
  missing_evidence_job_id?: string | null;
  missing_streak?: number | null;

  superseded_by_reservation_id?: string | null;
  superseded_at?: string | null;
  vehicle_changed_at?: string | null;
  previous_vehicle_map_id?: string | null;

  promoted_rental_id?: string | null;
  promoted_at?: string | null;
  promoted_by?: string | null;
  blocked_date_id?: string | null;

  hold_until?: string | null;
  hold_override_until?: string | null;

  ignored_by?: string | null;
  ignored_at?: string | null;
  ignore_reason?: string | null;

  turo_account_fingerprint?: string | null;

  /** Reconciliation lane, if it ever lands. */
  presence_state?: TuroPresenceState | null;
  missing_run_count?: number | null;
}

export type TuroBridgeRow = TuroBridgeReservation & TuroBridgeReservationExtras;

/**
 * The 15 columns that genuinely exist today. Kept as documentation and as the
 * fallback projection — NOT as the live projection, which is `*` (see header).
 */
export const TURO_BRIDGE_LEGACY_COLUMNS =
  "id, tenant_id, reservation_id, source, guest_name, vehicle_label, starts_at, ends_at, status, total_amount, currency, raw, synced_at, created_at, updated_at";

export const TURO_BRIDGE_TABLE = "turo_bridge_reservations";

/** Turo's post-trip extension window (24h) plus one missed sync day. */
export const TURO_HOLD_HOURS = 48;

export function turoBridgeQueryKey(tenantId: string | undefined) {
  return ["turo-bridge-reservations", tenantId] as const;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. TOLERANT READERS — every one of these can say "I don't know"
 * ──────────────────────────────────────────────────────────────────────────*/

/** Where a value came from. `absent` is a first-class answer, not a failure. */
export type ValueSource = "column" | "raw" | "computed" | "absent";

export interface ReadValue<T> {
  value: T | null;
  source: ValueSource;
  /** The actual key that produced it, so a Turo rename is diagnosable. */
  matchedKey: string | null;
}

function absent<T>(): ReadValue<T> {
  return { value: null, source: "absent", matchedKey: null };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** True when the row carries the column at all (as opposed to carrying null). */
export function hasColumn(row: TuroBridgeRow, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, column);
}

/**
 * Turo's own trip status, which today lives inside `raw`, never in our column.
 *
 * Signature and behaviour are unchanged for the shipped page. It now ALSO reads
 * the dedicated columns if they exist, because two designers independently
 * specified one (`turo_trip_status` in the foundation DDL, `turo_status` in the
 * promotion contract) and whichever lands first should win over the raw blob.
 */
export function turoTripStatus(row: TuroBridgeReservation): string | null {
  const r = row as TuroBridgeRow;
  const fromColumn = str(r.turo_trip_status) ?? str(r.turo_status);
  if (fromColumn) return fromColumn;
  const raw = row.raw;
  if (!raw) return null;
  const v = raw["__turo_status"] ?? raw["status"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Same value, but carrying where it came from. */
export function readTuroTripStatus(row: TuroBridgeRow): ReadValue<string> {
  if (str(row.turo_trip_status))
    return { value: str(row.turo_trip_status), source: "column", matchedKey: "turo_trip_status" };
  if (str(row.turo_status))
    return { value: str(row.turo_status), source: "column", matchedKey: "turo_status" };
  const raw = row.raw ?? {};
  for (const key of ["__turo_status", "status", "tripStatus", "trip_status"]) {
    const v = str(raw[key]);
    if (v) return { value: v, source: "raw", matchedKey: `raw.${key}` };
  }
  return absent<string>();
}

/**
 * The licence plate. `vehicles.reg` is globally unique and 100% populated
 * (461/461 distinct, live) so the plate is the ONLY safe vehicle join key —
 * and today it is dropped on the floor between `content-turo.js:378` and the
 * ingest function, surviving only incidentally inside `raw`. Read every
 * spelling we know of, report which one hit, and return absent rather than
 * parsing one out of a display label here (that parse belongs to the vehicle
 * map hook, where it is labelled as a parse and always requires review).
 */
export function readVehiclePlate(row: TuroBridgeRow): ReadValue<string> {
  if (str(row.vehicle_plate))
    return { value: str(row.vehicle_plate), source: "column", matchedKey: "vehicle_plate" };
  const raw = row.raw ?? {};
  for (const key of ["vehicle_plate", "vehiclePlate", "plate", "licensePlate", "license_plate", "registration"]) {
    const v = str(raw[key]);
    if (v) return { value: v, source: "raw", matchedKey: `raw.${key}` };
  }
  return absent<string>();
}

/** Turo's per-trip vehicle id, if the feed vintage carries one. */
export function readTuroVehicleId(row: TuroBridgeRow): ReadValue<string> {
  if (str(row.turo_vehicle_id))
    return { value: str(row.turo_vehicle_id), source: "column", matchedKey: "turo_vehicle_id" };
  const raw = row.raw ?? {};
  for (const key of ["turo_vehicle_id", "vehicleId", "vehicle_id", "listingId", "listing_id"]) {
    const v = str(raw[key]);
    if (v) return { value: v, source: "raw", matchedKey: `raw.${key}` };
  }
  return absent<string>();
}

export interface SyncStateReading {
  state: TuroSyncState | null;
  /**
   * `column` — the foundation schema is applied and this row has a state.
   * `absent` — the column does not exist. NOT a state, and never rendered as
   *            one: the correct UI is "reconciliation is not deployed yet".
   * `unrecognised` — the column exists and holds a value this build does not
   *            know. Surfaced verbatim; never coerced into a known state.
   */
  source: "column" | "absent" | "unrecognised";
  rawValue: string | null;
}

export function readSyncState(row: TuroBridgeRow): SyncStateReading {
  if (!hasColumn(row, "sync_state")) return { state: null, source: "absent", rawValue: null };
  const v = str(row.sync_state as string | null | undefined);
  if (!v) return { state: null, source: "absent", rawValue: null };
  if ((TURO_SYNC_STATES as readonly string[]).includes(v))
    return { state: v as TuroSyncState, source: "column", rawValue: v };
  return { state: null, source: "unrecognised", rawValue: v };
}

export interface HoldReading {
  holdUntil: string | null;
  source: ValueSource;
  /** True while now() < holdUntil. A held trip may never be released. */
  active: boolean;
  /**
   * True when we computed it from ends_at rather than reading the stored
   * column. A computed hold is a UI courtesy; the DATABASE is the gate, and
   * `turo_release_block()` re-proves the hold server-side regardless.
   */
  computed: boolean;
}

/**
 * `completed` is not terminal: guests extend up to 24h AFTER a trip ends and
 * Turo auto-accepts, and MV3 means nothing runs while Chrome is quit — hence
 * 48h, not 24h. The stored `hold_until` is trigger-maintained as
 * GREATEST(ends_at + 48h, hold_override_until) and can only ever be extended.
 */
export function readHold(row: TuroBridgeRow, now: Date = new Date()): HoldReading {
  const stored = str(row.hold_until as string | null | undefined);
  const override = str(row.hold_override_until as string | null | undefined);
  // Compare as instants, not as strings: Postgres may hand back `+00:00` while
  // anything we compute carries `Z`, and lexical order across those two spellings
  // is not time order.
  const candidates = [stored, override]
    .filter((v): v is string => !!v)
    .map((v) => ({ iso: v, t: new Date(v).getTime() }))
    .filter((c) => Number.isFinite(c.t))
    .sort((a, b) => a.t - b.t);
  const best = candidates.length ? candidates[candidates.length - 1].iso : null;
  if (best) {
    return {
      holdUntil: best,
      source: "column",
      active: now.getTime() < new Date(best).getTime(),
      computed: false,
    };
  }
  if (row.ends_at) {
    const t = new Date(row.ends_at).getTime();
    if (Number.isFinite(t)) {
      const iso = new Date(t + TURO_HOLD_HOURS * 3600_000).toISOString();
      return { holdUntil: iso, source: "computed", active: now.getTime() < t + TURO_HOLD_HOURS * 3600_000, computed: true };
    }
  }
  return { holdUntil: null, source: "absent", active: false, computed: false };
}

/**
 * Keys the parser could not place, so a Turo field rename shows up as data
 * instead of as silence. Reads the dedicated `unmapped` column when it exists
 * and otherwise the `__drive247_unmapped` stamp some extension builds write
 * into `raw`. An empty result means "nothing unknown was RECORDED" — which is
 * not the same as "nothing was unknown", and the UI should not claim it is.
 */
export function readUnmappedKeys(row: TuroBridgeRow): { keys: string[]; source: ValueSource } {
  const col = row.unmapped;
  if (col && typeof col === "object" && !Array.isArray(col)) {
    const keys = Object.keys(col);
    if (keys.length) return { keys, source: "column" };
    if (hasColumn(row, "unmapped")) return { keys: [], source: "column" };
  }
  const raw = row.raw ?? {};
  for (const key of ["__drive247_unmapped", "__unmapped", "unmapped"]) {
    const v = raw[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return { keys: Object.keys(v as Record<string, unknown>), source: "raw" };
    }
  }
  return { keys: [], source: "absent" };
}

/** `true` only when a row is demonstrably demo data. Never inferred. */
export function isFixtureRow(row: TuroBridgeReservation): boolean {
  return row.source === "fixture";
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. ERROR CLASSIFICATION — an unapplied migration is not a crash
 * ──────────────────────────────────────────────────────────────────────────*/

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function asPgError(error: unknown): PostgrestLikeError {
  if (!error || typeof error !== "object") return {};
  return error as PostgrestLikeError;
}

/**
 * The relation is not there at all: either Postgres 42P01, or PostgREST's
 * PGRST205 ("Could not find the table 'public.x' in the schema cache"), which
 * is what you actually get through the REST API for a table that has never
 * been created.
 */
export function isMissingRelation(error: unknown): boolean {
  const e = asPgError(error);
  const code = (e.code ?? "").toUpperCase();
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  const msg = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  return (
    msg.includes("could not find the table") ||
    msg.includes("does not exist") && msg.includes("relation")
  );
}

/** A named column is missing (42703 / PGRST204). */
export function isMissingColumn(error: unknown): boolean {
  const e = asPgError(error);
  const code = (e.code ?? "").toUpperCase();
  if (code === "42703" || code === "PGRST204") return true;
  const msg = `${e.message ?? ""}`.toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/**
 * What an OPERATOR sees when the Turo foundation schema has not been applied.
 *
 * This used to name the two .sql files, on the reasoning that whoever reads
 * this screen can apply them. That is true of us and false of the person this
 * product is for: a rental operator cannot act on "turo-bridge-poc/sql/
 * 03-foundation-schema.sql", and pasting a repo path into their portal reads as
 * a crash rather than as a setup step. So the sentence now says what is
 * unavailable, that their trips are safe, and who unblocks it — the three
 * things they can actually use — and the file names moved to
 * TURO_FOUNDATION_MISSING_DETAIL, which the UI carries as hover text so support
 * and engineering lose nothing.
 */
export const TURO_FOUNDATION_MISSING_MESSAGE =
  "Turo Sync is not fully set up on this account yet. Trips already synced are safe and still " +
  "listed, but they cannot be matched to your cars, imported as bookings, or shown in a sync " +
  "history until Drive247 finishes the setup. Contact Drive247 support to have it completed.";

/** The engineering half of the sentence above. Hover text, never body copy. */
export const TURO_FOUNDATION_MISSING_DETAIL =
  "Setup step outstanding: turo-bridge-poc/sql/01-schema.sql and 03-foundation-schema.sql have " +
  "not been applied to this database.";

/**
 * `supabase.functions.invoke` collapses every non-2xx into a generic
 * "Edge Function returned a non-2xx status code", which is useless in a toast.
 * Pull the real message out of the Response body when there is one, and name
 * the missing function when there is not — because during this phase the most
 * likely cause by far is that the function has not been written or deployed
 * yet, and telling the operator "try again" would be a lie.
 */
export async function describeInvokeError(
  error: unknown,
  functionName: string,
): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in (ctx as Record<string, unknown>)) {
    const res = ctx as Response;
    if (res.status === 404) {
      return `The \`${functionName}\` edge function is not deployed on this project. Nothing was changed.`;
    }
    try {
      const body = await res.clone().json();
      const msg =
        (body && typeof body === "object" && (body as Record<string, unknown>).error) ||
        (body && typeof body === "object" && (body as Record<string, unknown>).message);
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    } catch {
      try {
        const text = (await res.clone().text()).trim();
        if (text) return text.slice(0, 500);
      } catch {
        /* body already consumed or not readable — fall through */
      }
    }
    return `\`${functionName}\` returned HTTP ${res.status}. Nothing was changed.`;
  }
  if (error instanceof Error && error.message) {
    if (error.message.toLowerCase().includes("failed to fetch")) {
      return `Could not reach \`${functionName}\`. Nothing was changed.`;
    }
    return error.message;
  }
  return `\`${functionName}\` failed. Nothing was changed.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. THE BASE LIST QUERY
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Reservations synced from Turo for the current tenant, newest first.
 *
 * LIVENESS — deliberately belt AND braces:
 *
 * `turo_bridge_reservations` is NOT currently a member of the
 * `supabase_realtime` publication (checked against pg_publication_tables on the
 * live project; the query returned zero rows). A realtime subscription on an
 * unpublished table subscribes happily and then never fires, so realtime alone
 * would leave the operator staring at a stale table after clicking Sync — the
 * single worst outcome for this screen, since a freshly-landed row appearing is
 * the entire point of it.
 *
 * So this hook polls on a 10s interval while the tab is focused, and also
 * refetches on window focus — which is what actually makes the demo work today,
 * because the operator's attention physically leaves this tab to go and click
 * the extension, then comes back. `refetchOnWindowFocus` overrides the portal's
 * global `false` (QueryClient default) for exactly that reason.
 *
 * The realtime subscription is wired anyway: it costs one channel, it is
 * correct the moment somebody adds the table to the publication, and it makes
 * the row appear instantly rather than up to 10s later. It is an accelerator,
 * never the mechanism.
 *
 * PROJECTION: `*`, not a column list. See the file header — naming a column
 * that does not exist yet fails the entire query with 42703, and the foundation
 * columns do not exist yet.
 */
export function useTuroBridgeReservations() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: turoBridgeQueryKey(tenantId),
    queryFn: async (): Promise<TuroBridgeRow[]> => {
      // `(supabase as any)`: this table postdates the last
      // `supabase gen types` run, so it has no row in
      // integrations/supabase/types.ts. Same cast as use-vehicle-owners.ts:17.
      const { data, error } = await (supabase as any)
        .from(TURO_BRIDGE_TABLE)
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("synced_at", { ascending: false });

      if (error) throw error;
      return (data || []) as TuroBridgeRow[];
    },
    enabled: !!tenantId,
    // The row we are waiting for is seconds away, not minutes — override the
    // portal's global 60s staleTime so a focus event actually refetches.
    staleTime: 5_000,
    refetchInterval: 10_000,
    // Background tabs must not poll: the operator is on turo.com at that moment
    // and a ticking query there buys nothing.
    refetchIntervalInBackground: false,
    // Overrides the global `refetchOnWindowFocus: false`. Coming back from the
    // extension IS the signal that something new landed.
    refetchOnWindowFocus: true,
  });

  // Instant append when (and only when) the table is in the realtime
  // publication. Safe to subscribe regardless: RLS is ON with a tenant-scoped
  // SELECT policy, so postgres_changes enforces that policy per subscriber
  // rather than leaning on the channel filter, which is a convenience filter
  // and not an access boundary.
  useRealtimeInvalidate({
    table: TURO_BRIDGE_TABLE,
    tenantId,
    queryKey: turoBridgeQueryKey(tenantId),
  });

  return query;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. STAGED LIST WITH FILTERS + ABSOLUTE COUNTS
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TuroReservationFilter {
  /** A state, several states, or every row. Omit for every row. */
  syncState?: TuroSyncState | TuroSyncState[] | "all";
  /** Fixtures are LABELLED, never hidden by default — hiding demo data is how it gets mistaken for real. */
  includeFixtures?: boolean;
  /** 'unmapped' = no confirmed vehicle mapping yet. */
  vehicleMapped?: "mapped" | "unmapped" | "all";
  /** Free text over reservation id, guest, vehicle label, plate and Turo status. */
  search?: string;
}

export interface TuroReservationCounts {
  /** Per state, from OUR OWN table. Never from anything the feed declared. */
  byState: Record<TuroSyncState, number>;
  /** Rows whose sync_state we could not read — either absent or unrecognised. */
  unknownState: number;
  fixtures: number;
  /** Rows currently inside the 48h post-trip hold. */
  held: number;
  /** Rows carrying at least one unrecognised Turo key. */
  withUnmappedKeys: number;
  total: number;
}

function emptyCounts(): TuroReservationCounts {
  return {
    byState: {
      pending_match: 0,
      staged: 0,
      promoted: 0,
      cancellation_candidate: 0,
      conflict: 0,
      ignored: 0,
    },
    unknownState: 0,
    fixtures: 0,
    held: 0,
    withUnmappedKeys: 0,
    total: 0,
  };
}

function matchesSearch(row: TuroBridgeRow, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const plate = readVehiclePlate(row).value ?? "";
  const haystack = [
    row.reservation_id,
    row.guest_name ?? "",
    row.vehicle_label ?? "",
    plate,
    turoTripStatus(row) ?? "",
    row.status,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export interface UseTuroStagedReservationsResult {
  /** Rows after the filter. */
  rows: TuroBridgeRow[];
  /** Every row for the tenant, unfiltered — the denominator for "N of M shown". */
  allRows: TuroBridgeRow[];
  counts: TuroReservationCounts;
  /**
   * False when `sync_state` is not on the table (03-foundation-schema.sql not
   * applied). While false, every state-based affordance must be disabled rather
   * than defaulted — a row with no state is not a `pending_match` row.
   */
  foundationApplied: boolean;
  /**
   * True when the caller asked for a state filter that cannot be evaluated.
   * `rows` is then EMPTY, not "everything": silently ignoring a filter and
   * showing an unfiltered list under a filtered heading is the same class of
   * lie as a progress bar reading 8/8 on a truncated read.
   */
  filterUnavailable: boolean;
  filterUnavailableReason: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * The staged-reservation list the reconciliation screen reads.
 *
 * Filtering happens CLIENT-SIDE on purpose. Two reasons, both about honesty
 * rather than performance: (a) `.eq("sync_state", …)` against a table without
 * that column returns 42703 and takes the whole list down, so a server-side
 * filter would make the screen fail closed the moment anyone opened it before
 * the migration; (b) the counts must be absolute and computed over every row we
 * hold, so the list has to be in memory anyway. The volume is one migrating
 * operator's trips — hundreds, not millions — and the base query is already
 * shared and cached with the legacy table view.
 */
export function useTuroStagedReservations(
  filter: TuroReservationFilter = {},
): UseTuroStagedReservationsResult {
  const query = useTuroBridgeReservations();
  const allRows = useMemo(() => (query.data ?? []) as TuroBridgeRow[], [query.data]);

  const foundationApplied = useMemo(
    () => allRows.some((r) => hasColumn(r, "sync_state")),
    [allRows],
  );

  const counts = useMemo(() => {
    const c = emptyCounts();
    const now = new Date();
    for (const row of allRows) {
      c.total += 1;
      if (isFixtureRow(row)) c.fixtures += 1;
      const reading = readSyncState(row);
      if (reading.state) c.byState[reading.state] += 1;
      else c.unknownState += 1;
      if (readHold(row, now).active) c.held += 1;
      if (readUnmappedKeys(row).keys.length) c.withUnmappedKeys += 1;
    }
    return c;
  }, [allRows]);

  const wantStates = useMemo<TuroSyncState[] | null>(() => {
    const s = filter.syncState;
    if (!s || s === "all") return null;
    return Array.isArray(s) ? s : [s];
  }, [filter.syncState]);

  const filterUnavailable = !!wantStates && !foundationApplied && allRows.length > 0;

  const rows = useMemo(() => {
    if (filterUnavailable) return [];
    const includeFixtures = filter.includeFixtures !== false;
    const mapMode = filter.vehicleMapped ?? "all";
    const search = filter.search ?? "";

    return allRows.filter((row) => {
      if (!includeFixtures && isFixtureRow(row)) return false;

      if (wantStates) {
        const reading = readSyncState(row);
        if (!reading.state || !wantStates.includes(reading.state)) return false;
      }

      if (mapMode !== "all") {
        // Only decidable when the column exists. When it does not, a row is
        // neither mapped nor unmapped — it is unknown — so it is excluded from
        // both buckets rather than being guessed into one.
        if (!hasColumn(row, "vehicle_map_id")) return false;
        const mapped = !!str(row.vehicle_map_id as string | null | undefined);
        if (mapMode === "mapped" && !mapped) return false;
        if (mapMode === "unmapped" && mapped) return false;
      }

      return matchesSearch(row, search);
    });
  }, [allRows, wantStates, filter.includeFixtures, filter.vehicleMapped, filter.search, filterUnavailable]);

  return {
    rows,
    allRows,
    counts,
    foundationApplied,
    filterUnavailable,
    filterUnavailableReason: filterUnavailable ? TURO_FOUNDATION_MISSING_MESSAGE : null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * The cancellation review queue: rows the server has moved to
 * `cancellation_candidate`. A row only reaches this state when a database
 * trigger has already proved the observing job was authoritative, observed that
 * exact vehicle, covered the trip window and cleared the 48h hold — so the
 * portal never has to decide whether absence meant anything. It only asks a
 * human to confirm what the evidence already supports.
 */
export function useTuroCancellationCandidates() {
  return useTuroStagedReservations({ syncState: "cancellation_candidate" });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. MUTATIONS — all server-side; the portal has SELECT and nothing else
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Edge function names this data layer calls, exported so the function author and
 * this hook cannot drift apart silently.
 *
 * ⚠ THESE WERE WRONG AND ARE NOW BOUND TO THE FUNCTIONS THAT ACTUALLY EXIST.
 *   This layer was written against four hypothetical single-purpose functions
 *   (`turo-bridge-promote-plan`, `turo-bridge-promote-apply`,
 *   `turo-bridge-resolve-cancellation`). The repository contains
 *   `supabase/functions/turo-bridge-promote/` and
 *   `supabase/functions/turo-bridge-reconcile/`, both of which are ACTION-
 *   dispatched on a body field rather than split by name. Calling the old names
 *   would have produced a 404 on every promotion and every release — the two
 *   operations the whole feature exists for — so the names, the request bodies
 *   AND the response readers below have been corrected to the real contracts.
 *
 *   `turo-bridge-confirm-vehicle-map` is a genuinely new function
 *   (supabase/functions/turo-bridge-confirm-vehicle-map/index.ts); nothing
 *   existing could confirm a mapping, and `turo_vehicle_map.confirmed_by` is
 *   NOT NULL so it cannot be written from the client.
 *
 *   NONE of these are deployed on hviqoaokxvlancmftwuo yet (only
 *   `turo-bridge-ingest` is), so every mutation still fails loudly with a
 *   named, operator-readable error rather than appearing to work.
 */
export const TURO_FUNCTIONS = {
  confirmVehicleMap: "turo-bridge-confirm-vehicle-map",
  /** action: 'operator_release' | 'operator_resolve' */
  resolveCancellation: "turo-bridge-reconcile",
  /** action: 'plan' */
  promotePlan: "turo-bridge-promote",
  /** action: 'apply' */
  promoteApply: "turo-bridge-promote",
} as const;

async function invokeTuroFunction<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(await describeInvokeError(error, fn));
  if (data && typeof data === "object" && (data as Record<string, unknown>).error) {
    throw new Error(String((data as Record<string, unknown>).error));
  }
  return data as T;
}

/** How an operator may answer a cancellation candidate. */
export type CancellationResolution =
  /** Accept the evidence: release the Turo block through `turo_release_block()`. */
  | "release"
  /** Keep the block. Always available, always safe, and the default. */
  | "keep_block"
  /** The trip is real and still on: send the row back to `staged`. */
  | "reinstate"
  /** Stop asking about this row without releasing anything. */
  | "ignore";

export interface ResolveCancellationInput {
  /** `turo_bridge_reservations.id` (our uuid, not Turo's reservation_id). */
  reservationRowId: string;
  resolution: CancellationResolution;
  /**
   * The `turo_sync_jobs.id` whose authority is being cited. REQUIRED for
   * 'release': the database re-proves that this job was authoritative, observed
   * the vehicle, covered the window and cleared the hold, and refuses the
   * release otherwise. Passing a job id is not a permission — it is a citation.
   */
  jobId?: string;
  /** Free-text note stored with the decision. Always worth having. */
  note?: string;
  /**
   * Typed confirmation for 'release' only. The page should require the operator
   * to type the reservation id. This client-side check is a speed bump; the
   * server performs the real one.
   */
  typedConfirmation?: string;
}

/**
 * Resolve one cancellation candidate.
 *
 * RELEASE IS THE ONLY DANGEROUS BUTTON IN THIS FEATURE. A wrongly released
 * block puts a car back on sale that is physically out on rent. So:
 *
 *   - the client refuses to send a release without a cited job id and a typed
 *     confirmation matching the reservation id;
 *   - the server re-proves every condition anyway (`turo_release_block()` is
 *     SECURITY DEFINER, service_role only, and re-checks authority, tenant,
 *     vehicle observation, window coverage and the 48h hold);
 *   - and a BEFORE DELETE trigger refuses any other route to deleting a
 *     `source_type='turo'` block, so there is no way around it from here.
 *
 * The other three resolutions are safe by construction: they never remove a
 * block, so the worst case is a stale block, which ages out on its own because
 * every availability read filters `.gte("end_date", today)`.
 */
export function useResolveCancellationCandidate() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ResolveCancellationInput) => {
      if (!tenant?.id) throw new Error("No tenant context — cannot resolve a cancellation.");
      if (!input.reservationRowId) throw new Error("No reservation selected.");

      if (input.resolution === "release") {
        if (!input.jobId) {
          throw new Error(
            "A release must cite the sync job that observed the trip as gone. " +
              "Absence on its own is not evidence and will be refused by the database.",
          );
        }
        if (!input.typedConfirmation?.trim()) {
          throw new Error("Type the reservation id to confirm the release.");
        }
      }

      /* THE REAL CONTRACT (supabase/functions/turo-bridge-reconcile/index.ts:311).
         snake_case, an `action` discriminator, and `confirm_reservation_id` —
         which the server compares BYTE-FOR-BYTE against the row's
         reservation_id. camelCase keys landed as undefined server-side, which
         made a release fail the typed-confirmation check with a message about a
         value the operator had in fact typed correctly. */
      return invokeTuroFunction<{
        released?: boolean;
        block_released?: boolean;
        presence_state?: string;
        sync_state?: string;
        note?: string | null;
        message?: string;
      }>(TURO_FUNCTIONS.resolveCancellation, {
        action: input.resolution === "release" ? "operator_release" : "operator_resolve",
        /* NOT a tenant selector, and turo-bridge-reconcile ignores it outright:
           it resolves the tenant from the caller's JWT via app_users (or from a
           pairing token) and 403s when the two disagree. Sent only so a request
           log shows which account the operator believed they were acting on. */
        tenant_id: tenant.id,
        reservation_row_id: input.reservationRowId,
        // Only meaningful for the three non-releasing outcomes.
        resolution: input.resolution,
        confirm_reservation_id: input.typedConfirmation?.trim() ?? null,
        job_id: input.jobId ?? null,
        note: input.note ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: turoBridgeQueryKey(tenant?.id) });
      queryClient.invalidateQueries({ queryKey: ["turo-sync-jobs", tenant?.id] });
    },
  });
}

/* ── Promotion: two phase, never one click ────────────────────────────────── */

export interface TuroPromotionPlanRow {
  /** `turo_bridge_reservations.id`. */
  staged_id: string;
  reservation_id: string;
  guest_name: string | null;
  vehicle_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  matched_vehicle_id: string | null;
  matched_vehicle_reg: string | null;
  /**
   * How the vehicle was reached. Only 'plate' promotes without a per-row human
   * click — VIN is not unique in this database (326 distinct across 400
   * non-null) and can therefore only ever suggest.
   */
  match_basis: "plate" | "vin" | "label" | "manual" | "unmatched" | "other_tenant_plate" | string;
  requires_review: boolean;
  /** Plain sentences: what this row would create. */
  will_create: string[];
  /** Plain sentences: why it cannot be promoted. Non-empty means not ready. */
  blockers: string[];
}

export interface TuroPromotionPlan {
  /** sha256 of the plan. Apply refuses without it, and refuses on drift. */
  plan_hash: string;
  tenant_id: string;
  generated_at: string;
  rows: TuroPromotionPlanRow[];
  /**
   * The per-row vehicle confirmations THIS plan was built with, echoed back from
   * the request.
   *
   * ⚠ LOAD-BEARING. `plan_hash` is computed server-side over the rows the plan
   * judged ready, and a row a person has confirmed becomes ready only because
   * `vehicle_choices` named its car (turo-bridge-promote/index.ts:468). Apply
   * recomputes the whole plan from the body it is given, so it must be handed
   * the SAME choices or it derives a different ready set, a different hash, and
   * refuses its own plan as drifted. Kept on the plan rather than threaded
   * through the page so the two calls cannot disagree.
   */
  vehicle_choices: Record<string, string>;
  /**
   * The row-id scope this plan was built over, echoed back for the same reason
   * as `vehicle_choices`: it narrows the set the server plans across, so apply
   * must repeat it or it plans over a different set and refuses its own hash.
   * `null` means "every staged row", which is the normal case.
   */
  reservation_row_ids: string[] | null;
  /**
   * ABSOLUTE counters, sourced from our own staged table. Never a percentage,
   * never processed/total, and the word "complete" never appears — a truncated
   * Turo read must not be able to render as finished.
   */
  counts: {
    ready: number;
    needs_vehicle: number;
    conflicts: number;
    already_promoted: number;
    total_staged: number;
  };
  warnings: string[];
}

/**
 * Validate whatever the plan function returned. The function does not exist
 * yet, so this is written to reject an unexpected shape rather than to hope:
 * a plan with no `plan_hash` cannot be applied safely (the hash is the only
 * thing standing between an approved plan and a stale one), so we refuse it
 * here rather than letting the apply step invent one.
 */
export function normalisePromotionPlan(
  payload: unknown,
  vehicleChoices: Record<string, string> = {},
  reservationRowIds: string[] | null = null,
): TuroPromotionPlan {
  if (!payload || typeof payload !== "object") {
    throw new Error("The promotion planner returned nothing that could be read as a plan.");
  }
  const p = payload as Record<string, unknown>;
  const hash = str(p.plan_hash) ?? str(p.planHash);
  if (!hash) {
    throw new Error(
      "The promotion planner returned a plan with no plan_hash. Refusing it: without a hash " +
        "the apply step cannot tell an approved plan from a stale one, and approving a stale " +
        "plan is how the wrong car gets blocked.",
    );
  }
  /* ⚠ THE SERVER'S FIELD NAMES, NOT THE ONES THIS FILE ORIGINALLY GUESSED.
     turo-bridge-promote emits a `Verdict` (index.ts:186): row_id,
     turo_reservation_id, guest, turo_vehicle_string, vehicle_id, vehicle_reg,
     vehicle_match, needs_confirmation, blocker (a SINGLE nullable string), and
     will_create. Reading `staged_id` / `matched_vehicle_id` / `blockers[]` off
     that object produced a plan in which every row had an empty id, no vehicle
     and zero blockers — i.e. every row looked ready to import. The old spellings
     are still accepted first so a future rename in either direction degrades
     rather than breaks. */
  const rawRows = Array.isArray(p.rows) ? p.rows : [];
  const rows: TuroPromotionPlanRow[] = rawRows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const blockers = Array.isArray(row.blockers)
      ? row.blockers.map(String)
      : str(row.blocker)
        ? [String(row.blocker)]
        : [];
    const basis = str(row.match_basis) ?? str(row.vehicle_match) ?? "unmatched";
    return {
      staged_id: String(row.staged_id ?? row.row_id ?? row.id ?? ""),
      reservation_id: String(row.reservation_id ?? row.turo_reservation_id ?? ""),
      guest_name: str(row.guest_name) ?? str(row.guest),
      vehicle_label: str(row.vehicle_label) ?? str(row.turo_vehicle_string),
      starts_at: str(row.starts_at),
      ends_at: str(row.ends_at),
      matched_vehicle_id: str(row.matched_vehicle_id) ?? str(row.vehicle_id),
      matched_vehicle_reg: str(row.matched_vehicle_reg) ?? str(row.vehicle_reg),
      // Unknown basis is preserved verbatim and treated as review-required.
      match_basis: basis,
      requires_review:
        typeof row.requires_review === "boolean"
          ? row.requires_review
          : typeof row.needs_confirmation === "boolean"
            ? row.needs_confirmation
            // Only an exact plate match promotes without a per-row human click.
            : basis !== "plate",
      will_create: Array.isArray(row.will_create) ? row.will_create.map(String) : [],
      blockers,
    };
  });
  const c = (p.counts ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    plan_hash: hash,
    tenant_id: String(p.tenant_id ?? ""),
    generated_at: str(p.generated_at) ?? new Date().toISOString(),
    rows,
    vehicle_choices: vehicleChoices,
    reservation_row_ids: reservationRowIds,
    /* Server counter names (index.ts:543): ready / need_a_vehicle /
       need_your_confirmation / already_imported / cannot_import. The old names
       read every one of them as 0, which rendered "0 ready · 0 need a vehicle"
       over a plan full of rows. There is no total_staged on the wire — it is
       derived here from the rows the plan actually covers, so it can never be a
       number that came from a Turo feed. */
    counts: {
      ready: num(c.ready),
      needs_vehicle: num(c.needs_vehicle ?? c.need_a_vehicle),
      conflicts: num(c.conflicts ?? c.cannot_import),
      already_promoted: num(c.already_promoted ?? c.already_imported),
      total_staged: num(c.total_staged) || rows.length,
    },
    warnings: [
      ...(Array.isArray(p.warnings) ? p.warnings.map(String) : []),
      ...(Array.isArray(p.notes) ? p.notes.map(String) : []),
      ...(p.truncated === true && str(p.truncation_note) ? [String(p.truncation_note)] : []),
    ],
  };
}

/**
 * PHASE 1 — plan. Writes nothing to rentals, vehicles, customers or
 * blocked_dates; it only tells the operator what an apply WOULD do.
 *
 * Modelled as a mutation rather than a query on purpose: promotion is
 * operator-initiated, and a query would refetch a plan (and therefore a
 * plan_hash) on window focus while the operator was reading it.
 */
export function useTuroPromotionPlan() {
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (
      input: { stagedIds?: string[]; vehicleChoices?: Record<string, string> } = {},
    ): Promise<TuroPromotionPlan> => {
      if (!tenant?.id) throw new Error("No tenant context — cannot plan a promotion.");
      const payload = await invokeTuroFunction<unknown>(TURO_FUNCTIONS.promotePlan, {
        // The real contract: action-dispatched, snake_case
        // (supabase/functions/turo-bridge-promote/index.ts:220, :369).
        action: "plan",
        tenant_id: tenant.id,
        reservation_row_ids: input.stagedIds ?? undefined,
        vehicle_choices: input.vehicleChoices ?? undefined,
      });
      return normalisePromotionPlan(payload, input.vehicleChoices ?? {}, input.stagedIds ?? null);
    },
  });
}

export interface TuroPromotionAcknowledgements {
  /** "These are the right cars" — required for every row not matched by plate. */
  vehiclesConfirmed: boolean;
  /** "N placeholder guests will be created with no email or phone. They will not be contacted." */
  placeholderGuests: boolean;
  /** "No invoice, charge or receivable will be raised for these bookings." */
  noInvoices: boolean;
}

export interface ApplyPromotionInput {
  plan: TuroPromotionPlan;
  acknowledgements: TuroPromotionAcknowledgements;
  /** Rows the operator explicitly ticked. Must cover every review-required row. */
  acknowledgedRowIds?: string[];
}

/**
 * PHASE 2 — apply. Sends the approved `plan_hash`; the server re-runs the plan
 * and refuses on any drift (a vehicle reassigned, a staged row re-synced with
 * new dates, a row promoted meanwhile).
 *
 * The client-side gate below is a courtesy that keeps a mis-wired page from
 * sending an unacknowledged apply. It is NOT the security boundary — the edge
 * function resolves the caller's tenant from their JWT via `app_users` and
 * refuses when the staged rows belong to a different tenant, because RLS is OFF
 * on `rentals`/`vehicles`/`customers` and a client-side insert there would be a
 * naked cross-tenant write primitive.
 */
export function useApplyTuroPromotion() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ApplyPromotionInput) => {
      if (!tenant?.id) throw new Error("No tenant context — cannot apply a promotion.");
      const { plan, acknowledgements } = input;
      if (!plan?.plan_hash) throw new Error("No approved plan to apply.");

      const missing: string[] = [];
      if (!acknowledgements.vehiclesConfirmed) missing.push("vehicle confirmation");
      if (!acknowledgements.placeholderGuests) missing.push("placeholder guest acknowledgement");
      if (!acknowledgements.noInvoices) missing.push("no-invoice acknowledgement");
      if (missing.length) {
        throw new Error(`Cannot apply yet — still to acknowledge: ${missing.join(", ")}.`);
      }

      const needReview = plan.rows.filter((r) => r.requires_review && r.blockers.length === 0);
      const acked = new Set(input.acknowledgedRowIds ?? []);
      const unacked = needReview.filter((r) => !acked.has(r.staged_id));
      if (unacked.length) {
        throw new Error(
          `${unacked.length} booking(s) were not matched to a vehicle by licence plate and still ` +
            "need to be confirmed one by one before they can be promoted.",
        );
      }

      /* ⚠ `plan_hash`, not `planHash`. The server reads body.plan_hash and 400s
         with "`plan_hash` is required" when it is absent (index.ts:589) — so the
         camelCase spelling made apply impossible, not merely unsafe.

         ⚠ The acknowledgement KEYS are the server's, and it checks
         `acks[key] !== true` against exactly these three (index.ts:572).
         The UI's camelCase booleans are translated here rather than in the page,
         so there is one place this can be wrong.

         ⚠ reservation_row_ids is NOT sent. The plan hash covers only the rows
         the server judged ready; re-sending a filtered list would change the set
         the server plans over and therefore change the hash, and apply would
         then refuse its own plan as drifted. */
      return invokeTuroFunction<{
        ok?: boolean;
        refused?: boolean;
        reason?: string;
        batch_id?: string;
        counts?: Record<string, number>;
        results?: unknown[];
        nothing_to_do?: boolean;
        message?: string;
      }>(TURO_FUNCTIONS.promoteApply, {
        action: "apply",
        tenant_id: tenant.id,
        plan_hash: plan.plan_hash,
        reservation_row_ids: plan.reservation_row_ids ?? undefined,
        // Same choices the plan was built with — see TuroPromotionPlan above.
        // Omitting these made every operator-confirmed row drop out of the
        // server's `ready` set, so the rows a person had just ticked were the
        // exact rows that silently did not import.
        vehicle_choices: plan.vehicle_choices,
        acknowledgements: {
          vehicles_confirmed: acknowledgements.vehiclesConfirmed,
          placeholder_guests: acknowledgements.placeholderGuests,
          no_invoices: acknowledgements.noInvoices,
        },
        acknowledged_row_ids: Array.from(acked),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: turoBridgeQueryKey(tenant?.id) });
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["active-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["turo-sync-jobs", tenant?.id] });
    },
  });
}

/**
 * Convenience: the full two-phase promotion flow as one object, so a page can
 * hold `plan`, `apply` and a reset in a single ref without wiring both hooks.
 */
export function useTuroPromotion() {
  const plan = useTuroPromotionPlan();
  const apply = useApplyTuroPromotion();

  const reset = useCallback(() => {
    plan.reset();
    apply.reset();
  }, [plan, apply]);

  return {
    plan,
    apply,
    /** The plan currently approved-in-UI, or null. */
    currentPlan: (plan.data as TuroPromotionPlan | undefined) ?? null,
    reset,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. FRESHNESS — the only liveness fact this database can actually answer
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * ⚠ READ THIS BEFORE USING ANY OF IT.
 *
 * `turo_sync_jobs` does not exist on this project (see the file header), so
 * `useTuroSyncHealth` is permanently `schemaMissing` and every job-derived
 * freshness claim — "last read", "complete", "partial" — is structurally
 * unanswerable. That left the screen with NO working freshness signal at all,
 * and silence on a page like this reads as "up to date", which is the single
 * claim this feature must never make.
 *
 * The one liveness fact that IS live today is MAX(synced_at) over the rows we
 * hold. It answers a NARROWER question than a job would, and the difference is
 * load-bearing rather than pedantic:
 *
 *   MAX(synced_at)          = when a trip row was last WRITTEN.
 *   job.finished_at         = when a sync last RAN.
 *
 * A sync that reached Turo, read the whole calendar and found nothing new can
 * leave `synced_at` untouched, so this signal can eventually accuse a perfectly
 * healthy setup of being stale. It cannot do the opposite — it can never claim
 * freshness that did not happen — and that asymmetry is why it is safe to ship
 * as an interim: it errs toward "go and check", never toward "all good".
 *
 * Every consumer must carry that caveat in its copy. The moment
 * 03-foundation-schema.sql lands, replace this with `health.latest.finished_at`
 * and delete it; it is a stopgap with a named successor, not a design.
 */

/** Hours since the last row was written before we stop calling it fresh. */
export const TURO_FRESHNESS_STALE_HOURS = 24;
/** Hours after which the list must be described as a stale copy, not a copy. */
export const TURO_FRESHNESS_VERY_STALE_HOURS = 72;

export type TuroFreshnessTier = "never" | "fresh" | "stale" | "very_stale";

export interface TuroFreshness {
  /** ISO timestamp of the newest `synced_at` we hold, or null if there are none. */
  lastSyncedAt: string | null;
  /** Hours since `lastSyncedAt`. Null when nothing has ever been synced. */
  ageHours: number | null;
  /** Whole days since `lastSyncedAt`, floored. Null when never. */
  ageDays: number | null;
  tier: TuroFreshnessTier;
  /**
   * The caveat above, in one sentence, so a component cannot render this value
   * without having the honest qualifier to hand.
   */
  caveat: string;
}

export const TURO_FRESHNESS_CAVEAT =
  "This is the last time a trip row was written. A sync that reached Turo and found nothing " +
  "new may not move it.";

/**
 * Newest `synced_at` across the given rows.
 *
 * Computed explicitly rather than read off `rows[0]`. The list query orders by
 * `synced_at desc` today, so `rows[0]` would be correct today — and would
 * silently start lying the first time somebody changes that ORDER BY or feeds
 * this a filtered subset. A freshness signal that depends on a sibling's sort
 * order is exactly the kind of quiet wrongness this feature exists to avoid.
 * Rows with an unparseable timestamp are skipped rather than treated as epoch 0.
 */
export function readLastSyncedAt(rows: readonly TuroBridgeRow[]): string | null {
  let bestIso: string | null = null;
  let bestT = -Infinity;
  for (const row of rows) {
    if (!row?.synced_at) continue;
    const t = new Date(row.synced_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > bestT) {
      bestT = t;
      bestIso = row.synced_at;
    }
  }
  return bestIso;
}

/**
 * How stale the list is, in the three bands the page renders differently.
 *
 * Note there is no "fresh enough, say nothing" band. Even under 24h the caller
 * is expected to say what is NOT on the page — anything booked or cancelled on
 * Turo since the last write — because a Turo calendar changes without asking us.
 */
export function describeSyncFreshness(
  rows: readonly TuroBridgeRow[],
  now: Date = new Date(),
): TuroFreshness {
  const lastSyncedAt = readLastSyncedAt(rows);
  if (!lastSyncedAt) {
    return {
      lastSyncedAt: null,
      ageHours: null,
      ageDays: null,
      tier: "never",
      caveat: TURO_FRESHNESS_CAVEAT,
    };
  }
  // Clamp at zero: a row written by a server whose clock is a minute ahead of
  // the browser's must not render as "in 1 minute".
  const ageHours = Math.max(
    0,
    (now.getTime() - new Date(lastSyncedAt).getTime()) / 3_600_000,
  );
  const tier: TuroFreshnessTier =
    ageHours >= TURO_FRESHNESS_VERY_STALE_HOURS
      ? "very_stale"
      : ageHours >= TURO_FRESHNESS_STALE_HOURS
        ? "stale"
        : "fresh";
  return {
    lastSyncedAt,
    ageHours,
    ageDays: Math.floor(ageHours / 24),
    tier,
    caveat: TURO_FRESHNESS_CAVEAT,
  };
}
