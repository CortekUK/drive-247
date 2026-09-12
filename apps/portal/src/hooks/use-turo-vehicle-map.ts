/**
 * useTuroVehicleMap — the vehicle-identity layer of the Turo Bridge.
 *
 * A Turo trip names a car in whatever vintage the operator's feed happens to
 * speak: a stable `turo_vehicle_id` if we are lucky, otherwise a display string
 * like `"Owner 1 Wagoneer (Jon) (CA #9DUC203)"`. Drive247 names the same car by
 * `vehicles.reg`. Nothing joins those two automatically, and this file is
 * deliberately not the place where something starts to.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 * EVERY MAPPING REQUIRES A HUMAN. `turo_vehicle_map.confirmed_by` is NOT NULL
 * in the foundation schema, so there is no code path — here or anywhere — to an
 * auto-created mapping. What this hook produces is a QUEUE and a set of
 * SUGGESTIONS, each carrying the evidence it rests on and whether that evidence
 * is exact or merely plausible. The operator clicks. Always.
 *
 * ── WHY VIN IS NEVER A JOIN KEY ──────────────────────────────────────────────
 *
 * Verified live (project hviqoaokxvlancmftwuo): `vehicles.reg` is NOT NULL and
 * globally unique — 461 rows, 461 distinct — while `vehicles.vin` has 400
 * non-null values across only 326 distinct, so 74 rows share a VIN with another
 * row. A VIN can therefore raise confidence in a match reached another way, and
 * can never resolve identity on its own. A VIN that hits more than one vehicle
 * produces NO suggestion and an explicit ambiguity note, never a first-match.
 *
 * ── SCHEMA STATE (checked 2026-09-02) ────────────────────────────────────────
 *
 * `public.turo_vehicle_map` DOES NOT EXIST on the live database;
 * `turo-bridge-poc/sql/03-foundation-schema.sql` has not been applied. Rather
 * than throwing an opaque PostgREST error at the operator, the query below
 * detects a missing relation and returns `schemaMissing: true` with an empty
 * list, so the screen can say what is actually wrong. Every other error still
 * throws — a missing migration is a known state, an unknown error is not.
 *
 * Writes go through an edge function: RLS on `turo_vehicle_map` grants
 * `authenticated` SELECT only (03-foundation-schema.sql section 9), and the
 * `confirmed_by` FK plus the composite tenant-matched FK to `vehicles` are
 * enforced server-side where they cannot be bypassed.
 */
"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import {
  TURO_FOUNDATION_MISSING_MESSAGE,
  TURO_FUNCTIONS,
  describeInvokeError,
  hasColumn,
  isMissingRelation,
  readTuroVehicleId,
  readVehiclePlate,
  turoBridgeQueryKey,
  useTuroBridgeReservations,
  type TuroBridgeRow,
} from "@/hooks/use-turo-bridge";

export const TURO_VEHICLE_MAP_TABLE = "turo_vehicle_map";

export function turoVehicleMapQueryKey(tenantId: string | undefined, includeRetired = false) {
  return ["turo-vehicle-map", tenantId, includeRetired] as const;
}

export function turoVehicleCandidatesQueryKey(tenantId: string | undefined) {
  return ["turo-vehicle-candidates", tenantId] as const;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. NORMALISERS — these must agree with the database, byte for byte
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Mirror of `public.turo_norm_label(text)`:
 *
 *   btrim(regexp_replace(lower(coalesce(p_label,'')), '[^a-z0-9]+', ' ', 'g'))
 *
 * `match_key` is a GENERATED column computed with that function, and the unique
 * index `turo_vehicle_map_active_label_unique` is built on it. If this function
 * and that one ever disagree, the portal will offer the operator a mapping the
 * database then refuses — so the implementation is kept literal rather than
 * "equivalent", and `turoMatchKey` below reproduces the same CASE the generated
 * column uses.
 *
 * `"Owner 1 Wagoneer (Jon) (CA #9DUC203)"` -> `"owner 1 wagoneer jon ca 9duc203"`
 */
export function turoNormLabel(label: string | null | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Mirror of the generated `turo_vehicle_map.match_key`:
 *   'tid:' || lower(btrim(turo_vehicle_id))   when a Turo id is present
 *   'lbl:' || turo_norm_label(display_label)  otherwise
 *
 * This is what stops a host upgrading their export vintage from orphaning every
 * mapping they have already confirmed.
 */
export function turoMatchKey(
  turoVehicleId: string | null | undefined,
  displayLabel: string | null | undefined,
): string | null {
  const tid = (turoVehicleId ?? "").trim();
  if (tid) return `tid:${tid.toLowerCase()}`;
  const norm = turoNormLabel(displayLabel);
  if (norm) return `lbl:${norm}`;
  // Neither identity present — `turo_vehicle_map_has_identity` would refuse the
  // row, so we refuse to invent a key for it.
  return null;
}

/** Plate comparison form: uppercase, non-alphanumerics removed. */
export function normalisePlate(plate: string | null | undefined): string {
  return (plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Opportunistically mine a plate out of a legacy display string. Returns every
 * plausible candidate rather than one "the" answer, because this is a guess and
 * the whole design says a guess must be visible as one. Anything this produces
 * is marked `label_plate_parsed`, which never pre-selects.
 *
 * `"Owner 1 Wagoneer (Jon) (CA #9DUC203)"` -> ["9DUC203"]
 */
export function minePlateCandidates(label: string | null | undefined): string[] {
  if (!label) return [];
  const out = new Set<string>();
  // `#XXXX` — the shape the known legacy export uses for the plate.
  for (const m of label.matchAll(/#\s*([A-Za-z0-9-]{4,10})/g)) {
    const v = normalisePlate(m[1]);
    if (v.length >= 4) out.add(v);
  }
  // Parenthesised tokens that look like a plate: has a digit, has a letter.
  for (const m of label.matchAll(/\(([^)]{3,20})\)/g)) {
    for (const token of m[1].split(/\s+/)) {
      const v = normalisePlate(token);
      if (v.length >= 5 && v.length <= 10 && /[0-9]/.test(v) && /[A-Z]/.test(v)) out.add(v);
    }
  }
  return Array.from(out);
}

/** VINs are 17 chars, no I/O/Q. Used only to find a hint, never to resolve. */
export function mineVinCandidates(label: string | null | undefined): string[] {
  if (!label) return [];
  const out = new Set<string>();
  for (const m of label.toUpperCase().matchAll(/\b([A-HJ-NPR-Z0-9]{17})\b/g)) out.add(m[1]);
  return Array.from(out);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. ROW SHAPES
 * ──────────────────────────────────────────────────────────────────────────*/

/** A confirmed mapping. Shape per turo-bridge-poc/sql/03-foundation-schema.sql. */
export interface TuroVehicleMap {
  id: string;
  tenant_id: string;
  turo_vehicle_id: string | null;
  display_label: string | null;
  /** GENERATED — turo_norm_label(display_label). Read-only. */
  display_label_norm: string | null;
  alias_labels: string[] | null;
  /** GENERATED — 'tid:…' or 'lbl:…'. Read-only, UNIQUE per tenant. */
  match_key: string | null;
  vehicle_id: string;
  /** HINT ONLY. Never joined on: vehicles.vin is not unique. */
  vin_hint: string | null;
  /** HINT ONLY. */
  plate_hint: string | null;
  /** NOT NULL in the schema: there is no auto-created mapping. */
  confirmed_by: string;
  confirmed_at: string;
  confirmation_note: string | null;
  first_seen_job_id: string | null;
  is_active: boolean;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A Drive247 vehicle, as a mapping target. */
export interface TuroVehicleCandidate {
  id: string;
  tenant_id: string;
  /** NOT NULL and globally unique — the only safe join key. */
  reg: string;
  reg_norm: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string | null;
  is_paused: boolean | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. QUERIES
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TuroVehicleMapResult {
  rows: TuroVehicleMap[];
  /** The table does not exist yet. Not an error — an unapplied migration. */
  schemaMissing: boolean;
}

/** Confirmed Turo → Drive247 vehicle mappings for this tenant. */
export function useTuroVehicleMappings(options: { includeRetired?: boolean } = {}) {
  const includeRetired = options.includeRetired ?? false;
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: turoVehicleMapQueryKey(tenantId, includeRetired),
    queryFn: async (): Promise<TuroVehicleMapResult> => {
      // `(supabase as any)`: this table postdates the last
      // `supabase gen types` run, so it has no row in
      // integrations/supabase/types.ts. Same cast as use-vehicle-owners.ts:17.
      let q = (supabase as any)
        .from(TURO_VEHICLE_MAP_TABLE)
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("confirmed_at", { ascending: false });
      if (!includeRetired) q = q.eq("is_active", true);

      const { data, error } = await q;
      if (error) {
        if (isMissingRelation(error)) return { rows: [], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as TuroVehicleMap[], schemaMissing: false };
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  // Only meaningful once the table exists; subscribing to a table that is not
  // in the publication is harmless but pointless, and subscribing to one that
  // does not exist doubly so.
  useRealtimeInvalidate({
    table: TURO_VEHICLE_MAP_TABLE,
    tenantId,
    queryKey: turoVehicleMapQueryKey(tenantId, includeRetired),
    enabled: !!tenantId && query.data?.schemaMissing === false,
  });

  return {
    ...query,
    rows: query.data?.rows ?? [],
    schemaMissing: query.data?.schemaMissing ?? false,
    schemaMissingMessage: query.data?.schemaMissing ? TURO_FOUNDATION_MISSING_MESSAGE : null,
  };
}

/**
 * Every vehicle this tenant could be mapped to. Tenant-scoped in the query even
 * though RLS is OFF on `vehicles` (relrowsecurity = false, verified live) —
 * precisely BECAUSE it is off, the filter is the only thing keeping another
 * operator's fleet out of this dropdown.
 */
export function useTuroVehicleCandidates() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  return useQuery({
    queryKey: turoVehicleCandidatesQueryKey(tenantId),
    queryFn: async (): Promise<TuroVehicleCandidate[]> => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("id, tenant_id, reg, vin, make, model, year, status, is_paused")
        .eq("tenant_id", tenantId!)
        .order("reg", { ascending: true });
      if (error) throw error;
      return ((data || []) as Record<string, unknown>[]).map((v) => ({
        id: String(v.id),
        tenant_id: String(v.tenant_id ?? ""),
        reg: String(v.reg ?? ""),
        reg_norm: normalisePlate(v.reg as string | null),
        vin: (v.vin as string | null) ?? null,
        make: (v.make as string | null) ?? null,
        model: (v.model as string | null) ?? null,
        year: typeof v.year === "number" ? v.year : null,
        status: (v.status as string | null) ?? null,
        is_paused: typeof v.is_paused === "boolean" ? v.is_paused : null,
      }));
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. THE MAPPING QUEUE
 * ──────────────────────────────────────────────────────────────────────────*/

/** Why a suggestion is being offered. Ordered strongest first. */
export type TuroMatchEvidence =
  | "plate_exact"
  | "label_plate_parsed"
  | "vin_unique"
  | "label_fuzzy";

/** Why no suggestion could be offered. Each is a fact, not a failure. */
export type TuroMatchObstacle =
  | "no_plate_observed"
  | "plate_matched_no_vehicle"
  | "plate_belongs_to_another_tenant"
  | "vin_ambiguous"
  | "label_ambiguous"
  | "no_identity";

export interface TuroVehicleSuggestion {
  vehicle: TuroVehicleCandidate;
  evidence: TuroMatchEvidence;
  /**
   * `exact` — the observed plate equals `vehicles.reg` after normalisation.
   * `plausible` — everything else. A plausible match is shown, never pre-ticked.
   */
  strength: "exact" | "plausible";
  /** One sentence an operator can act on. */
  explanation: string;
}

export interface TuroVehicleMapQueueEntry {
  /** UNIQUE per tenant, and identical to the DB's generated `match_key`. */
  matchKey: string | null;
  turoVehicleId: string | null;
  displayLabel: string | null;
  displayLabelNorm: string;
  /** Plate as Turo spelled it, if the feed carried one at all. */
  plateObserved: string | null;
  plateSource: "column" | "raw" | "parsed_from_label" | "absent";
  vinHint: string | null;
  /** How many staged reservations are waiting on this one mapping. */
  reservationCount: number;
  reservationRowIds: string[];
  earliestStartsAt: string | null;
  latestEndsAt: string | null;
  /** Already-confirmed mapping for this key, if there is one. */
  existingMap: TuroVehicleMap | null;
  suggestions: TuroVehicleSuggestion[];
  obstacles: TuroMatchObstacle[];
  /**
   * True when a single exact plate match exists and no other candidate is
   * competing. The UI may pre-select it. IT STILL REQUIRES A HUMAN CLICK —
   * `confirmed_by` is NOT NULL and this hook never confirms anything.
   */
  preselect: boolean;
  /**
   * True when this entry cannot be mapped at all: the feed gave neither a Turo
   * vehicle id nor any label, so `turo_vehicle_map_has_identity` would refuse
   * the row. The operator needs a better read, not a better guess.
   */
  unmappable: boolean;
}

export interface UseTuroVehicleMapQueueResult {
  entries: TuroVehicleMapQueueEntry[];
  /** Absolute counters over OUR OWN rows. Never a feed-declared total. */
  counts: {
    /** Distinct Turo vehicles awaiting a mapping. */
    awaiting: number;
    /** Of those, how many have exactly one exact plate match ready to confirm. */
    readyToConfirm: number;
    /** Of those, how many have nothing better than a plausible suggestion. */
    needsJudgement: number;
    /** Of those, how many cannot be mapped from what the feed gave us. */
    unmappable: number;
    /** Staged reservations blocked behind the whole queue. */
    reservationsBlocked: number;
  };
  confirmedMappings: TuroVehicleMap[];
  /** `turo_vehicle_map` is not installed, so no mapping can be confirmed yet. */
  schemaMissing: boolean;
  schemaMissingMessage: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

function tokenSet(s: string): Set<string> {
  return new Set(turoNormLabel(s).split(" ").filter(Boolean));
}

/**
 * Build the mapping queue from the staged reservations plus the fleet.
 *
 * Everything here is derived in memory and NOTHING is written. The queue is
 * grouped by the same `match_key` the database generates, so the operator's
 * click maps one Turo identity — not one trip — and every future trip carrying
 * that identity is covered by it.
 */
export function useTuroVehicleMapQueue(): UseTuroVehicleMapQueueResult {
  const reservations = useTuroBridgeReservations();
  const vehiclesQuery = useTuroVehicleCandidates();
  const mappings = useTuroVehicleMappings();

  const entries = useMemo<TuroVehicleMapQueueEntry[]>(() => {
    const rows = (reservations.data ?? []) as TuroBridgeRow[];
    const vehicles = vehiclesQuery.data ?? [];
    const confirmed = mappings.rows;

    const byKey = new Map<string, TuroVehicleMap>();
    for (const m of confirmed) if (m.match_key) byKey.set(m.match_key, m);

    // Plate index. `vehicles.reg` is unique, so this is a 1:1 index.
    const byPlate = new Map<string, TuroVehicleCandidate>();
    for (const v of vehicles) if (v.reg_norm) byPlate.set(v.reg_norm, v);

    // VIN index. Deliberately a LIST, because vin is not unique — 74 of 400
    // non-null VINs collide live. A list makes ambiguity visible instead of
    // letting a Map silently keep the last writer.
    const byVin = new Map<string, TuroVehicleCandidate[]>();
    for (const v of vehicles) {
      const vin = (v.vin ?? "").trim().toUpperCase();
      if (!vin) continue;
      const list = byVin.get(vin) ?? [];
      list.push(v);
      byVin.set(vin, list);
    }

    interface Acc {
      matchKey: string | null;
      turoVehicleId: string | null;
      displayLabel: string | null;
      plateObserved: string | null;
      plateSource: TuroVehicleMapQueueEntry["plateSource"];
      vinHint: string | null;
      rowIds: string[];
      starts: string[];
      ends: string[];
    }

    const groups = new Map<string, Acc>();

    for (const row of rows) {
      // Rows that already carry a confirmed mapping are not in the queue. When
      // the column does not exist we cannot tell, so we fall back to matching
      // the key against the confirmed list rather than assuming "unmapped".
      const mapped =
        hasColumn(row, "vehicle_map_id") && !!(row.vehicle_map_id ?? "").toString().trim();
      if (mapped) continue;

      const tid = readTuroVehicleId(row);
      const key = turoMatchKey(tid.value, row.vehicle_label);
      // Group unmappable rows together under one bucket so the operator sees
      // the problem once, with a count, rather than once per trip.
      const groupKey = key ?? "__no_identity__";
      if (key && byKey.has(key)) continue; // already confirmed elsewhere

      const plateRead = readVehiclePlate(row);
      const parsed = plateRead.value ? [] : minePlateCandidates(row.vehicle_label);
      const vin = mineVinCandidates(row.vehicle_label)[0] ?? null;

      const acc = groups.get(groupKey) ?? {
        matchKey: key,
        turoVehicleId: tid.value,
        displayLabel: row.vehicle_label ?? null,
        plateObserved: null,
        plateSource: "absent",
        vinHint: null,
        rowIds: [],
        starts: [],
        ends: [],
      };

      if (!acc.displayLabel && row.vehicle_label) acc.displayLabel = row.vehicle_label;
      if (!acc.turoVehicleId && tid.value) acc.turoVehicleId = tid.value;

      if (!acc.plateObserved) {
        if (plateRead.value) {
          acc.plateObserved = plateRead.value;
          acc.plateSource = plateRead.source === "column" ? "column" : "raw";
        } else if (parsed.length === 1) {
          // Exactly one candidate mined. More than one is an ambiguity, and an
          // ambiguity is recorded as "no plate", never as a coin toss.
          acc.plateObserved = parsed[0];
          acc.plateSource = "parsed_from_label";
        }
      }
      if (!acc.vinHint && vin) acc.vinHint = vin;

      acc.rowIds.push(row.id);
      if (row.starts_at) acc.starts.push(row.starts_at);
      if (row.ends_at) acc.ends.push(row.ends_at);
      groups.set(groupKey, acc);
    }

    const out: TuroVehicleMapQueueEntry[] = [];

    for (const [groupKey, acc] of groups) {
      const suggestions: TuroVehicleSuggestion[] = [];
      const obstacles: TuroMatchObstacle[] = [];
      const unmappable = groupKey === "__no_identity__" || acc.matchKey === null;
      if (unmappable) obstacles.push("no_identity");

      const plateNorm = normalisePlate(acc.plateObserved);
      if (plateNorm) {
        const hit = byPlate.get(plateNorm);
        if (hit) {
          const parsedPlate = acc.plateSource === "parsed_from_label";
          suggestions.push({
            vehicle: hit,
            evidence: parsedPlate ? "label_plate_parsed" : "plate_exact",
            // A plate READ from a field is exact. A plate MINED out of a display
            // string is a parse, and a parse is plausible at best — the label
            // could be carrying somebody else's reference number.
            strength: parsedPlate ? "plausible" : "exact",
            explanation: parsedPlate
              ? `Plate ${plateNorm} was read out of the Turo label text and matches ${hit.reg}. Confirm the car before mapping it.`
              : `Turo reported plate ${acc.plateObserved}, which matches ${hit.reg} exactly.`,
          });
        } else {
          // The plate is real but no vehicle of THIS tenant carries it. We do
          // not look outside the tenant to explain why: `vehicles.reg` is
          // globally unique with no tenant in the key, so a cross-tenant probe
          // would leak another operator's fleet. The operator is told the plate
          // is not in their fleet, and that is all they need to act.
          obstacles.push("plate_matched_no_vehicle");
        }
      } else if (!unmappable) {
        obstacles.push("no_plate_observed");
      }

      const vin = (acc.vinHint ?? "").trim().toUpperCase();
      if (vin) {
        const hits = byVin.get(vin) ?? [];
        if (hits.length === 1) {
          if (!suggestions.some((s) => s.vehicle.id === hits[0].id)) {
            suggestions.push({
              vehicle: hits[0],
              evidence: "vin_unique",
              // Never 'exact': VIN is not unique in this database.
              strength: "plausible",
              explanation: `VIN ${vin} matches one vehicle (${hits[0].reg}). VINs are not unique in this database, so check the plate before confirming.`,
            });
          }
        } else if (hits.length > 1) {
          obstacles.push("vin_ambiguous");
        }
      }

      if (!suggestions.length && acc.displayLabel) {
        const tokens = tokenSet(acc.displayLabel);
        const labelHits = vehicles.filter((v) => {
          const make = turoNormLabel(v.make);
          const model = turoNormLabel(v.model);
          if (!make || !model) return false;
          const makeHit = make.split(" ").every((t) => tokens.has(t));
          const modelHit = model.split(" ").every((t) => tokens.has(t));
          return makeHit && modelHit;
        });
        if (labelHits.length === 1) {
          suggestions.push({
            vehicle: labelHits[0],
            evidence: "label_fuzzy",
            strength: "plausible",
            explanation: `The Turo label mentions ${[labelHits[0].make, labelHits[0].model].filter(Boolean).join(" ")}, which matches one car in your fleet (${labelHits[0].reg}). This is a text match only.`,
          });
        } else if (labelHits.length > 1) {
          obstacles.push("label_ambiguous");
        }
      }

      const exact = suggestions.filter((s) => s.strength === "exact");
      const starts = acc.starts.slice().sort();
      const ends = acc.ends.slice().sort();

      out.push({
        matchKey: acc.matchKey,
        turoVehicleId: acc.turoVehicleId,
        displayLabel: acc.displayLabel,
        displayLabelNorm: turoNormLabel(acc.displayLabel),
        plateObserved: acc.plateObserved,
        plateSource: acc.plateSource,
        vinHint: acc.vinHint,
        reservationCount: acc.rowIds.length,
        reservationRowIds: acc.rowIds,
        earliestStartsAt: starts[0] ?? null,
        latestEndsAt: ends.length ? ends[ends.length - 1] : null,
        existingMap: acc.matchKey ? byKey.get(acc.matchKey) ?? null : null,
        suggestions,
        obstacles,
        preselect: exact.length === 1 && !unmappable,
        unmappable,
      });
    }

    // Most trips blocked first — that is the order in which fixing one mapping
    // unblocks the most work.
    out.sort((a, b) => b.reservationCount - a.reservationCount);
    return out;
  }, [reservations.data, vehiclesQuery.data, mappings.rows]);

  const counts = useMemo(() => {
    let readyToConfirm = 0;
    let needsJudgement = 0;
    let unmappable = 0;
    let reservationsBlocked = 0;
    for (const e of entries) {
      reservationsBlocked += e.reservationCount;
      if (e.unmappable) unmappable += 1;
      else if (e.preselect) readyToConfirm += 1;
      else needsJudgement += 1;
    }
    return {
      awaiting: entries.length,
      readyToConfirm,
      needsJudgement,
      unmappable,
      reservationsBlocked,
    };
  }, [entries]);

  return {
    entries,
    counts,
    confirmedMappings: mappings.rows,
    schemaMissing: mappings.schemaMissing,
    schemaMissingMessage: mappings.schemaMissing ? TURO_FOUNDATION_MISSING_MESSAGE : null,
    isLoading: reservations.isLoading || vehiclesQuery.isLoading || mappings.isLoading,
    isError: reservations.isError || vehiclesQuery.isError || mappings.isError,
    error: reservations.error ?? vehiclesQuery.error ?? mappings.error ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. MUTATIONS
 * ──────────────────────────────────────────────────────────────────────────*/

export interface ConfirmVehicleMappingInput {
  /** The queue entry being mapped. */
  entry: Pick<
    TuroVehicleMapQueueEntry,
    "matchKey" | "turoVehicleId" | "displayLabel" | "plateObserved" | "vinHint"
  >;
  /** The vehicle the OPERATOR chose. Never a suggestion applied automatically. */
  vehicleId: string;
  /** Which suggestion (if any) the operator acted on. Recorded for audit. */
  evidence?: TuroMatchEvidence | "operator_choice";
  confirmationNote?: string;
  /** Extra label spellings to file against this mapping. */
  aliasLabels?: string[];
}

/**
 * Confirm one Turo identity → one Drive247 vehicle.
 *
 * Server-side, because: `turo_vehicle_map` grants `authenticated` SELECT only;
 * `confirmed_by` must be a real `app_users.id` which only the server can
 * resolve from the JWT; and the composite `(vehicle_id, tenant_id)` FK means a
 * cross-tenant mapping is refused by Postgres rather than by us remembering to
 * check. The function is also the only thing that can restamp the affected
 * reservations to `staged` with `match_basis = 'human'`, which is the honest
 * value: a person decided this, not a matcher.
 */
export function useConfirmTuroVehicleMapping() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ConfirmVehicleMappingInput) => {
      if (!tenant?.id) throw new Error("No tenant context — cannot confirm a mapping.");
      if (!input.vehicleId) throw new Error("Choose a vehicle before confirming the mapping.");
      if (!input.entry.matchKey) {
        throw new Error(
          "This Turo trip carries neither a vehicle id nor a label, so there is nothing stable " +
            "to map. Re-sync once the feed returns vehicle details; do not map it by hand.",
        );
      }

      const { data, error } = await supabase.functions.invoke(TURO_FUNCTIONS.confirmVehicleMap, {
        body: {
          tenantId: tenant.id,
          matchKey: input.entry.matchKey,
          turoVehicleId: input.entry.turoVehicleId,
          displayLabel: input.entry.displayLabel,
          // Both are stored as HINTS on the mapping row. They carry no index and
          // are never joined on — they exist so a human can audit the decision.
          plateHint: input.entry.plateObserved,
          vinHint: input.entry.vinHint,
          vehicleId: input.vehicleId,
          evidence: input.evidence ?? "operator_choice",
          // A human confirmed it, so this is the only truthful basis to stamp on
          // the reservations this mapping resolves.
          reservationMatchBasis: "human",
          confirmationNote: input.confirmationNote ?? null,
          aliasLabels: input.aliasLabels ?? [],
        },
      });
      if (error) throw new Error(await describeInvokeError(error, TURO_FUNCTIONS.confirmVehicleMap));
      if (data && typeof data === "object" && (data as Record<string, unknown>).error) {
        throw new Error(String((data as Record<string, unknown>).error));
      }
      return data as { mapping_id?: string; reservations_restaged?: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turo-vehicle-map", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: turoBridgeQueryKey(tenant?.id) });
    },
  });
}

export interface RetireVehicleMappingInput {
  mappingId: string;
  reason?: string;
}

/**
 * Retire a mapping the operator no longer wants applied (a car sold, or a
 * mapping made in error).
 *
 * Retiring sets `is_active = false` and `retired_at` — it does NOT delete, and
 * it does NOT touch any block or any promoted rental. A mapping is a statement
 * about identity; withdrawing it must not silently un-block a car that is
 * physically out on rent. Anything already promoted stays promoted, and any
 * block already placed stays placed until it is released through the single
 * sanctioned door (`turo_release_block()`).
 */
export function useRetireTuroVehicleMapping() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RetireVehicleMappingInput) => {
      if (!tenant?.id) throw new Error("No tenant context — cannot retire a mapping.");
      if (!input.mappingId) throw new Error("No mapping selected.");

      const { data, error } = await supabase.functions.invoke(TURO_FUNCTIONS.confirmVehicleMap, {
        body: {
          tenantId: tenant.id,
          action: "retire",
          mappingId: input.mappingId,
          reason: input.reason ?? null,
        },
      });
      if (error) throw new Error(await describeInvokeError(error, TURO_FUNCTIONS.confirmVehicleMap));
      if (data && typeof data === "object" && (data as Record<string, unknown>).error) {
        throw new Error(String((data as Record<string, unknown>).error));
      }
      return data as { retired?: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["turo-vehicle-map", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: turoBridgeQueryKey(tenant?.id) });
    },
  });
}
