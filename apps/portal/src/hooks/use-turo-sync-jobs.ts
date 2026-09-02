/**
 * useTuroSyncJobs — sync-run history for the Turo Bridge, and the one place the
 * portal is allowed to talk about how much of Turo a run actually saw.
 *
 * A "job" is one attempt by the browser extension to read the operator's Turo
 * host feed. It is written by the ingest edge function (service_role); the
 * portal reads it and never writes it — `turo_sync_jobs` grants `authenticated`
 * SELECT only.
 *
 * ── WHY THIS FILE COMPUTES ALMOST NOTHING ────────────────────────────────────
 *
 * Three columns on `turo_sync_jobs` are `GENERATED ALWAYS ... STORED`:
 * `completeness`, `is_authoritative` and `progress_denominator`. Postgres
 * refuses any INSERT or UPDATE that supplies them — service_role included — so
 * a client can only ever report raw observations (`saw_end_of_feed`,
 * `degraded_reason`, `http_error_count`, `parse_failure_count`, the window) and
 * the database derives authority from those. That is deliberate, and it means
 * this hook must NOT recompute any of it: if the portal decided for itself that
 * a run "looked complete", it would be manufacturing exactly the authority the
 * schema was built to withhold. Everything below reads those columns and
 * presents them; nothing re-derives them.
 *
 * ── THE PROGRESS BAR THAT REFUSES TO LIE ─────────────────────────────────────
 *
 * `progress_denominator` is NULL unless the run is genuinely complete. So a
 * progress bar dividing by it renders NOTHING on a truncated read rather than a
 * confident 8/8 green. `feed_reported_total` is kept but is named untrusted and
 * is never a denominator — it arrives from the same possibly-degraded response
 * it would be describing. `describeJobProgress()` below returns
 * `percent: null` whenever coverage is unproven, and its `display` string is
 * built so it can never contain "N of N" in that case.
 *
 * ── SCHEMA STATE (checked 2026-09-02) ────────────────────────────────────────
 *
 * `public.turo_sync_jobs` DOES NOT EXIST on the live database — the extension
 * still reports one reservation at a time and
 * `turo-bridge-poc/sql/03-foundation-schema.sql` has not been applied. The
 * queries here detect a missing relation and return `schemaMissing: true` with
 * an empty list so the screen can say so plainly. Every other error still
 * throws: an unapplied migration is a known state, an unknown error is not.
 */
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import {
  TURO_FOUNDATION_MISSING_MESSAGE,
  isMissingRelation,
} from "@/hooks/use-turo-bridge";

export const TURO_SYNC_JOBS_TABLE = "turo_sync_jobs";
export const TURO_SYNC_JOB_PAGES_TABLE = "turo_sync_job_pages";

export function turoSyncJobsQueryKey(tenantId: string | undefined, limit: number) {
  return ["turo-sync-jobs", tenantId, limit] as const;
}

export function turoSyncJobPagesQueryKey(tenantId: string | undefined, jobId: string | undefined) {
  return ["turo-sync-job-pages", tenantId, jobId] as const;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. ROW SHAPES — mirroring turo-bridge-poc/sql/03-foundation-schema.sql
 * ──────────────────────────────────────────────────────────────────────────*/

export type TuroJobKind = "trips" | "vehicles" | "guests" | "earnings_csv" | "manual_single";
export type TuroJobState = "running" | "succeeded" | "failed" | "abandoned";
export type TuroJobCompleteness = "in_progress" | "complete" | "partial";

/**
 * The CHECK list as written. It is a closed vocabulary of failures we PREDICTED
 * rather than observed — we have no Turo host account — so an unrecognised
 * value is entirely possible once a real account is behind this, and is
 * rendered verbatim rather than folded into "unknown". See
 * `describeDegradedReason`.
 */
export type TuroDegradedReason =
  | "waf_challenge"
  | "waf_empty_200"
  | "captcha"
  | "session_expired"
  | "not_signed_in"
  | "http_error"
  | "shape_unrecognised"
  | "page_cap_reached"
  | "worker_killed"
  | "tab_closed"
  | "timeout"
  | "user_cancelled"
  | "heartbeat_lost"
  | "unknown";

export interface TuroSyncJob {
  id: string;
  tenant_id: string;
  token_id: string | null;
  job_kind: TuroJobKind | string;
  source: "turo" | "fixture" | string;
  state: TuroJobState | string;

  /** Raw observations the client is allowed to report. */
  saw_end_of_feed: boolean;
  degraded_reason: TuroDegradedReason | string | null;
  http_error_count: number;
  parse_failure_count: number;
  pages_fetched: number;
  records_seen: number;
  records_ingested: number;
  /** UNTRUSTED. Never a denominator. */
  feed_reported_total: number | null;

  requested_window_start: string | null;
  requested_window_end: string | null;
  window_start: string | null;
  window_end: string | null;
  observed_turo_vehicle_ids: string[] | null;
  turo_account_fingerprint: string | null;

  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;

  /**
   * §10 run-qualification observations. The client reports these raw; it does
   * NOT get to report what they add up to.
   */
  reader_outcome: string | null;
  /** Containers seen in the envelope BEFORE normalisation. */
  raw_item_count: number | null;
  /**
   * THE LIVENESS PROOF. Reservations this run positively parsed.
   * `raw_item_count > 0` with `parsed_count === 0` is the field-rename
   * signature — the two counts only mean anything side by side.
   */
  parsed_count: number;
  turo_account_ref: string | null;

  /** GENERATED ALWAYS — derived by Postgres, unforgeable by any client. */
  completeness: TuroJobCompleteness | string;
  /**
   * GENERATED ALWAYS — the run's SHAPE was clean: succeeded, saw the end of the
   * feed, no degraded reason, no HTTP errors, no parse failures, a window on
   * both ends.
   *
   * ⚠ NOT SUFFICIENT TO RELEASE A BLOCK ON ITS OWN. Every term above can hold
   * on a run that read nothing at all — that is precisely the WAF
   * HTTP-200-with-an-empty-body case. Use `observed_complete`.
   */
  is_authoritative: boolean;
  /**
   * GENERATED ALWAYS — `is_authoritative` AND `parsed_count > 0`. THIS is the
   * flag a release may be justified by, and the one public.turo_release_block()
   * enforces.
   */
  observed_complete: boolean;
  /** GENERATED ALWAYS — the inverse-of-authority flag. Guilty until proven. */
  degraded: boolean;
  /** GENERATED ALWAYS — NULL means "this run proves coverage of nothing". */
  observed_from: string | null;
  observed_to: string | null;
  /** GENERATED ALWAYS — NULL unless the run genuinely completed. */
  progress_denominator: number | null;
}

export interface TuroSyncJobPage {
  id: string;
  tenant_id: string;
  job_id: string;
  seq: number;
  requested_at: string;
  /** Path only — never a session-bearing query string. */
  url_path: string | null;
  http_status: number | null;
  byte_count: number | null;
  record_count: number | null;
  cursor_in: string | null;
  cursor_out: string | null;
  degraded_reason: string | null;
  /** TOP-LEVEL KEY NAMES ONLY, so a Turo rename is diagnosable without storing guest data. */
  observed_keys: unknown;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. PRESENTERS — plain functions, unit-testable, no React
 * ──────────────────────────────────────────────────────────────────────────*/

const DEGRADED_REASON_TEXT: Record<TuroDegradedReason, string> = {
  waf_challenge: "Turo's bot protection challenged the request.",
  waf_empty_200: "Turo answered OK but returned no trips — that is indistinguishable from a block, so nothing was concluded.",
  captcha: "Turo asked for a CAPTCHA.",
  session_expired: "The Turo session had expired.",
  not_signed_in: "Nobody was signed in to Turo in that browser.",
  http_error: "Turo returned an HTTP error.",
  shape_unrecognised: "Turo's response did not look like anything this build recognises.",
  page_cap_reached: "The read stopped at its own page limit before reaching the end of the feed.",
  worker_killed: "The browser shut the extension down mid-read.",
  tab_closed: "The Turo tab was closed mid-read.",
  timeout: "The read ran out of time.",
  user_cancelled: "The read was cancelled.",
  heartbeat_lost: "The run stopped reporting and was recorded as abandoned.",
  unknown: "The read failed for a reason this build does not have a name for.",
};

/**
 * Never coerce an unrecognised reason into `unknown`: the vocabulary was
 * written against predicted failures, and the first real Turo account will
 * almost certainly produce values we have not seen. Showing the raw string is
 * how that discovery reaches a human instead of being swallowed.
 */
export function describeDegradedReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const known = DEGRADED_REASON_TEXT[reason as TuroDegradedReason];
  if (known) return known;
  return `Unrecognised failure reason from the extension: "${reason}". This build does not know it; the read was treated as degraded.`;
}

export interface JobProgress {
  /** records_ingested — what we actually wrote. */
  processed: number;
  /** records_seen — what we actually parsed. */
  seen: number;
  /**
   * `progress_denominator`, straight from the database. NULL means coverage was
   * never proven, and a NULL denominator must render as no bar at all.
   */
  denominator: number | null;
  /** 0–100, or NULL. NULL whenever the denominator is NULL. */
  percent: number | null;
  /** True only when the DATABASE says completeness = 'complete'. */
  coverageProven: boolean;
  /** True only when the DATABASE says is_authoritative. */
  authoritative: boolean;
  /**
   * Operator-facing sentence. When coverage is unproven it never contains
   * "of" — there is no honest denominator to put after it.
   */
  display: string;
  /** Why coverage is unproven, when it is. */
  caveat: string | null;
}

/**
 * Render one job's progress without ever overstating it.
 *
 * The shape of this function IS the anti-"8/8 green" mechanism: it takes the
 * denominator from `progress_denominator` (generated, NULL unless complete) and
 * from nowhere else. `feed_reported_total` is deliberately not consulted.
 */
export function describeJobProgress(job: TuroSyncJob | null | undefined): JobProgress {
  if (!job) {
    return {
      processed: 0,
      seen: 0,
      denominator: null,
      percent: null,
      coverageProven: false,
      authoritative: false,
      display: "No sync has run yet.",
      caveat: null,
    };
  }

  const seen = job.records_seen ?? 0;
  const processed = job.records_ingested ?? 0;
  const denominator = job.progress_denominator ?? null;
  const parsed = job.parsed_count ?? 0;
  /**
   * ⚠ `observed_complete`, NOT `completeness === "complete"`.
   *
   * They differ by `parsed_count > 0`. Without that term, the WAF case —
   * turo.com answers the trips feed HTTP 200 with a valid but EMPTY body —
   * arrives here as a run that succeeded, saw the end of the feed (an empty
   * page carries no next link), logged no HTTP error and no parse failure. It
   * would render as coverage PROVEN with a denominator of 0, which the branch
   * below turned into `percent: 100` and "Read the whole feed — no trips in
   * it", drawn as a full green bar. That is the 8/8-green lie, aimed squarely
   * at the one failure this whole feature exists to survive.
   */
  const coverageProven = job.observed_complete === true;
  const authoritative = job.observed_complete === true && !!job.is_authoritative;
  const reason = describeDegradedReason(job.degraded_reason);

  if (job.state === "running") {
    return {
      processed,
      seen,
      denominator: null,
      percent: null,
      coverageProven: false,
      authoritative: false,
      display: `Reading Turo — ${seen} trip${seen === 1 ? "" : "s"} so far`,
      caveat: "Still running. How much of Turo this covers is not known until it finishes.",
    };
  }

  if (coverageProven && denominator !== null && denominator > 0) {
    const percent = Math.min(100, Math.round((processed / denominator) * 100));
    return {
      processed,
      seen,
      denominator,
      percent,
      coverageProven: true,
      authoritative,
      display: `Read ${processed} of ${denominator} trips`,
      caveat: null,
    };
  }

  /**
   * NOTHING WAS PARSED. Three completely different things look identical from
   * here: a genuinely quiet week, a WAF answering 200 with an empty body, and a
   * wholesale field rename that made every record unreadable. `raw_item_count`
   * is the one discriminator we have — items in the envelope that none of our
   * extractors could claim is OUR bug, not an empty calendar — and even it
   * cannot separate the first two. So this says what was observed and refuses
   * to conclude, and `coverageProven` stays false so nothing downstream can
   * treat it as evidence a trip has ended.
   */
  if (parsed === 0) {
    const rawSeen = job.raw_item_count ?? null;
    const confirmedEmpty = job.reader_outcome === "NO_TRIPS_CONFIRMED";
    return {
      processed: 0,
      seen,
      denominator: null,
      percent: null,
      coverageProven: false,
      authoritative: false,
      display:
        rawSeen !== null && rawSeen > 0
          ? `Turo returned ${rawSeen} item${rawSeen === 1 ? "" : "s"} and we could not read any of them`
          : "Turo returned no trips",
      caveat:
        rawSeen !== null && rawSeen > 0
          ? "Turo sent records in a shape we do not recognise — most likely a field was renamed. Nothing was imported and nothing was released."
          : confirmedEmpty
            ? "A second endpoint agreed the calendar is empty, but a read that saw no trips still cannot prove a particular trip has ended, so no blocks were released."
            : "An empty answer and a blocked answer look the same from here. This read cannot be used as evidence that any trip has ended.",
    };
  }

  // Coverage unproven. No denominator, no percentage, and no "of".
  const caveat =
    reason ??
    (job.saw_end_of_feed
      ? "The read finished but could not prove it reached the end of the feed."
      : "The read stopped before the end of the feed, so there may be more trips.");
  return {
    processed,
    seen,
    denominator: null,
    percent: null,
    coverageProven: false,
    authoritative,
    display: `Read ${seen} trip${seen === 1 ? "" : "s"} (there may be more)`,
    caveat,
  };
}

export interface HeartbeatReading {
  /** Minutes since the run last reported in. NULL when it is not running. */
  minutesSinceHeartbeat: number | null;
  /**
   * The heartbeat LOOKS stale. This is a suspicion the UI may show, and never a
   * claim that the run died: only the reaper
   * (`public.turo_reap_stale_sync_jobs`) may state that, by writing
   * `state = 'abandoned'` with `degraded_reason = 'heartbeat_lost'`. The
   * database is the judge here exactly as it is everywhere else in this
   * feature — MV3 kills the worker at any time, and a slow, heavily challenged
   * read on a large fleet can legitimately go quiet for a while.
   */
  suspectedStale: boolean;
  note: string | null;
}

/** The reaper's default staleness window. A guess, tunable at phase 1. */
export const TURO_HEARTBEAT_STALE_MINUTES = 5;

export function describeHeartbeat(
  job: TuroSyncJob | null | undefined,
  now: Date = new Date(),
): HeartbeatReading {
  if (!job || job.state !== "running") {
    return { minutesSinceHeartbeat: null, suspectedStale: false, note: null };
  }
  const t = new Date(job.heartbeat_at).getTime();
  if (!Number.isFinite(t)) {
    return { minutesSinceHeartbeat: null, suspectedStale: false, note: null };
  }
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  const stale = minutes >= TURO_HEARTBEAT_STALE_MINUTES;
  return {
    minutesSinceHeartbeat: minutes,
    suspectedStale: stale,
    note: stale
      ? `This run last reported ${minutes} minutes ago. It may have been shut down by the browser; it will be recorded as abandoned once the server confirms that.`
      : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. QUERIES
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TuroSyncJobsResult {
  rows: TuroSyncJob[];
  schemaMissing: boolean;
}

export interface UseTuroSyncJobsOptions {
  limit?: number;
  /** Restrict to one kind of run (`'trips'`, `'vehicles'`, …). */
  kind?: TuroJobKind;
}

/**
 * Sync history, newest first.
 *
 * POLLING: adaptive, 5s while any run is still going and 30s otherwise, plus a
 * refetch on window focus (overriding the portal's global `false`). The
 * operator physically leaves this tab to drive the extension and comes back —
 * that return IS the signal. Realtime is wired as an accelerator only: the
 * table is not published to `supabase_realtime` today, and a subscription on an
 * unpublished table subscribes happily and then never fires. A poll also
 * catches the one thing no socket ever can — the reaper flipping a silent run
 * to `abandoned`, which is a clock event with no client-side cause.
 */
export function useTuroSyncJobs(options: UseTuroSyncJobsOptions = {}) {
  const limit = options.limit ?? 25;
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: [...turoSyncJobsQueryKey(tenantId, limit), options.kind ?? "all"] as const,
    queryFn: async (): Promise<TuroSyncJobsResult> => {
      // `(supabase as any)`: this table postdates the last
      // `supabase gen types` run, so it has no row in
      // integrations/supabase/types.ts. Same cast as use-vehicle-owners.ts:17.
      let q = (supabase as any)
        .from(TURO_SYNC_JOBS_TABLE)
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (options.kind) q = q.eq("job_kind", options.kind);

      const { data, error } = await q;
      if (error) {
        if (isMissingRelation(error)) return { rows: [], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as TuroSyncJob[], schemaMissing: false };
    },
    enabled: !!tenantId,
    staleTime: 5_000,
    refetchInterval: (q) => {
      const snapshot = q.state.data as TuroSyncJobsResult | undefined;
      // Nothing to poll for if the table is not installed — polling a 404 every
      // 30s for the life of the tab is just noise.
      if (!snapshot || snapshot.schemaMissing) return false;
      return snapshot.rows.some((r) => r.state === "running") ? 5_000 : 30_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  useRealtimeInvalidate({
    table: TURO_SYNC_JOBS_TABLE,
    tenantId,
    queryKey: [...turoSyncJobsQueryKey(tenantId, limit), options.kind ?? "all"] as const,
    enabled: !!tenantId && query.data?.schemaMissing === false,
  });

  const rows = query.data?.rows ?? [];
  const schemaMissing = query.data?.schemaMissing ?? false;

  return {
    ...query,
    rows,
    schemaMissing,
    schemaMissingMessage: schemaMissing ? TURO_FOUNDATION_MISSING_MESSAGE : null,
    /** The most recent run of any outcome. */
    latest: rows[0] ?? null,
    /** A run still in flight, if there is one. At most one per (tenant, kind). */
    running: rows.find((r) => r.state === "running") ?? null,
  };
}

export interface TuroSyncJobPagesResult {
  rows: TuroSyncJobPage[];
  schemaMissing: boolean;
}

/**
 * Per-page detail for one run — the forensic view.
 *
 * `byte_count` next to `record_count` is what makes a WAF's "HTTP 200, valid
 * JSON, zero records" distinguishable from an honestly empty page, and
 * `observed_keys` is what makes a Turo field rename diagnosable without ever
 * storing a guest's data. Both are the reason this table is worth showing.
 */
export function useTuroSyncJobPages(jobId: string | undefined) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: turoSyncJobPagesQueryKey(tenantId, jobId),
    queryFn: async (): Promise<TuroSyncJobPagesResult> => {
      const { data, error } = await (supabase as any)
        .from(TURO_SYNC_JOB_PAGES_TABLE)
        .select("*")
        .eq("tenant_id", tenantId!)
        .eq("job_id", jobId!)
        .order("seq", { ascending: true });
      if (error) {
        if (isMissingRelation(error)) return { rows: [], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as TuroSyncJobPage[], schemaMissing: false };
    },
    enabled: !!tenantId && !!jobId,
    staleTime: 10_000,
  });

  return {
    ...query,
    rows: query.data?.rows ?? [],
    schemaMissing: query.data?.schemaMissing ?? false,
  };
}

/**
 * The most recent AUTHORITATIVE run of a given kind — the only kind of run
 * whose observations may justify releasing a block, and therefore the job id a
 * cancellation resolution should cite.
 *
 * Authority is read from the database, never recomputed here. Returns null when
 * there is no such run, which is the correct answer far more often than it is a
 * problem: it means nothing may be released yet.
 *
 * ⚠ BOTH `observed_complete` AND `is_authoritative` are required, and the first
 * one is the load-bearing half. They differ by exactly one term —
 * `parsed_count > 0`, the liveness proof — and every other term in
 * is_authoritative can hold on a run that read NOTHING: turo.com answers the
 * trips feed HTTP 200 with a valid empty body (the WAF case), the walk
 * terminates on its own because an empty page carries no next link, and
 * /api/vehicles/me answers normally so the run still names the vehicles it
 * "observed". Offering that job as the citation for a release is how a car goes
 * back on sale while it is out on rent. public.turo_release_block() enforces the
 * same rule server-side; this keeps the UI from ever proposing a citation the
 * database is going to refuse — or worse, one an older database would accept.
 */
export function useLatestAuthoritativeJob(kind: TuroJobKind = "trips") {
  const { rows, schemaMissing, isLoading, isError, error } = useTuroSyncJobs({ limit: 50, kind });

  const job = useMemo(
    () =>
      rows.find(
        (r) =>
          r.job_kind === kind &&
          r.observed_complete === true &&
          r.is_authoritative === true &&
          (r.parsed_count ?? 0) > 0,
      ) ?? null,
    [rows, kind],
  );

  return {
    job,
    /** Nothing may be released while this is false. */
    hasAuthority: !!job,
    schemaMissing,
    isLoading,
    isError,
    error,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. ONE SUMMARY FOR THE HEADER OF THE SCREEN
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TuroSyncHealth {
  latest: TuroSyncJob | null;
  progress: JobProgress;
  heartbeat: HeartbeatReading;
  /** Straight from the database's generated column. */
  authoritative: boolean;
  /** True while a run is in flight. */
  running: boolean;
  /**
   * A single sentence for the top of the page. It states what the last read
   * proved — not what it hoped. When nothing has been proven it says so.
   */
  headline: string;
  /** Present when the operator should be told something is wrong. */
  warning: string | null;
  schemaMissing: boolean;
  schemaMissingMessage: string | null;
  isLoading: boolean;
}

/**
 * The status line for the Turo Bridge screen.
 *
 * Note what it deliberately does NOT say: it never reports "in sync", "up to
 * date" or "all trips imported". No read can support those claims — a degraded
 * feed and a genuinely quiet week look identical from here — and the operator
 * acting on a false "up to date" is how a car gets double-sold.
 */
export function useTuroSyncHealth(kind: TuroJobKind = "trips"): TuroSyncHealth {
  const { rows, schemaMissing, isLoading } = useTuroSyncJobs({ limit: 25, kind });

  const latest = rows[0] ?? null;
  const progress = describeJobProgress(latest);
  const heartbeat = describeHeartbeat(latest);
  const running = !!latest && latest.state === "running";

  let headline: string;
  let warning: string | null = null;

  if (schemaMissing) {
    headline = "Sync history is not available on this database yet.";
    warning = TURO_FOUNDATION_MISSING_MESSAGE;
  } else if (!latest) {
    headline = "No Turo sync has run yet.";
  } else if (running) {
    headline = progress.display;
    warning = heartbeat.note;
  } else if (latest.observed_complete === true) {
    // observed_complete, not is_authoritative: the latter is true for a run
    // whose SHAPE was clean but which parsed nothing, and "covered the whole
    // feed" is the single most dangerous sentence this screen can print about
    // a WAF answering 200 with an empty body.
    headline = `Last read covered the whole feed — ${progress.display.toLowerCase()}.`;
  } else if (latest.is_authoritative && (latest.parsed_count ?? 0) === 0) {
    headline = "Last read finished cleanly but returned no trips we could read.";
    warning =
      progress.caveat ??
      "A clean-looking read that finds nothing is not proof the calendar is empty. Nothing was released.";
  } else {
    headline = `Last read was partial — ${progress.display.toLowerCase()}.`;
    warning =
      progress.caveat ??
      "This read cannot be used as evidence that a trip has ended, so no blocks were released.";
  }

  return {
    latest,
    progress,
    heartbeat,
    // The flag the release path actually gates on. See TuroSyncJob above:
    // is_authoritative alone is true for a run that read nothing.
    authoritative: latest?.observed_complete === true,
    running,
    headline,
    warning,
    schemaMissing,
    schemaMissingMessage: schemaMissing ? TURO_FOUNDATION_MISSING_MESSAGE : null,
    isLoading,
  };
}
