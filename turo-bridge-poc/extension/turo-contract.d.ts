/**
 * turo-contract.d.ts — THE TURO READ CONTRACT.
 *
 * Types only. No runtime, no imports, no build step: the extension is loaded
 * unpacked and every .js file in it is plain script. This file exists so an
 * editor and `tsc --noEmit` can check the shapes that cross the three seams
 * (tab -> worker -> ingest), and so the shapes are written down in one place
 * rather than inferred from a normaliser.
 *
 * Runtime lives in turo-read-contract.js and is a faithful mirror of this file.
 *
 * =====================================================================
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * =====================================================================
 * ABSENCE IS NOT EVIDENCE. A Turo read that returns fewer records than the
 * last one has NOT told us those trips ended. It has told us we saw fewer
 * records. A WAF answering HTTP 200 with `{"trips":[]}`, an expired session, a
 * renamed envelope key and a genuinely empty calendar are all the same bytes
 * to a naive reader — and three of those four must never be allowed to release
 * a calendar block, because releasing a block on a live trip double-sells the
 * car.
 *
 * Every outcome below therefore carries two INDEPENDENT permissions:
 *   writeSafe   — may this run write/refresh records at all?
 *   releaseSafe — may the ABSENCE of a record in this run be treated as that
 *                 record having gone away?
 * They are not the same bit and must never be collapsed into one. A partial
 * read is perfectly writeSafe (upserting the trips we did see is harmless and
 * idempotent) while being emphatically NOT releaseSafe.
 *
 * WE HAVE NEVER SEEN A REAL TURO RESPONSE. Turo does not operate in our
 * country and we hold no host account. The endpoint is confirmed; every field
 * name is a reconstruction. So nothing here asserts a schema — the runtime
 * DISCOVERS structure, records WHICH key produced each value
 * (`FieldEvidence.matchedKey`), and reports everything it could not claim.
 * The first live run is therefore self-documenting: read the matchedKey
 * histogram off `ReadManifest.keyHistogram` and you have the real schema
 * without having guessed at it.
 */

// ===========================================================================
// 1. OUTCOMES  —  the degraded-read taxonomy
// ===========================================================================

/**
 * Every distinct thing that can come back from one HTTP read of a Turo feed.
 *
 * The first six values are the ones content-turo.js already emits and they keep
 * their exact spelling: background.js:64 keys a Set off `BOT_BLOCKED`,
 * `UNKNOWN`, `UNPARSEABLE` and background.js:67 keys an advice map off the
 * rest. Renaming any of them silently breaks the MAIN-world retry.
 */
export type ReadOutcome =
  /** JSON, well-formed, and it carried at least one item we could read. */
  | "OK"
  /**
   * Signed in, the API surface is demonstrably healthy, and the trips list is
   * genuinely empty.
   *
   * DELIBERATELY EXPENSIVE TO REACH. An empty list on its own can NEVER produce
   * this — it produces EMPTY_UNCONFIRMED. Reaching NO_TRIPS_CONFIRMED requires
   * a corroborating positive signal from a SECOND, independent endpoint (see
   * `SessionProbe`): a host with vehicles but no trips is a believable empty; a
   * host with neither is far more likely a degraded read than an operator who
   * owns no cars, given we only ever run this against operators mid-migration.
   *
   * This is the ONLY empty-shaped outcome that is releaseSafe.
   */
  | "NO_TRIPS_CONFIRMED"
  /**
   * HTTP 200, valid JSON, nothing in it — and we could NOT corroborate that the
   * session is healthy. This is the WAF-returns-200-with-an-empty-body case,
   * and separating it from NO_TRIPS_CONFIRMED is the single highest-value line
   * in this contract. Writes nothing, releases nothing, tells the operator
   * plainly that it does not know.
   */
  | "EMPTY_UNCONFIRMED"
  /** No host session in this browser (401, /login redirect, login HTML). */
  | "NOT_LOGGED_IN"
  /** Cloudflare or PerimeterX interstitial — HTML, or their JSON mode. */
  | "BOT_BLOCKED"
  /** HTTP 429. The cursor is preserved; the run parks rather than restarting. */
  | "RATE_LIMITED"
  /** Network error, DNS, timeout, aborted. */
  | "UNREACHABLE"
  /**
   * 200 + JSON + items were present, and NOT ONE of them scored above the
   * normaliser threshold. Distinct from EMPTY_UNCONFIRMED (which has no items)
   * and from UNPARSEABLE (a single-record legacy verdict): this specifically
   * means Turo renamed its fields, which is a code change on our side, not an
   * operator action. Surfaced as such.
   */
  | "SHAPE_CHANGED"
  /**
   * We know more pages exist and we could not get them — a mid-run page failed,
   * or a full-size final page arrived with no pagination affordance at all.
   * writeSafe (what we read is real), never releaseSafe.
   */
  | "TRUNCATED"
  /**
   * The cursor stopped advancing: page N+1 returned ids we already hold, or an
   * identical cursor token came back. Stops the run instead of spinning into a
   * rate limit.
   */
  | "PAGINATION_STALLED"
  /** LEGACY, single-record path in content-turo.js. Treated as SHAPE_CHANGED. */
  | "UNPARSEABLE"
  /** LEGACY alias of NO_TRIPS_CONFIRMED emitted by content-turo.js:559. */
  | "NO_TRIPS"
  /** 2xx we do not recognise, or HTML we could not attribute to a cause. */
  | "UNKNOWN";

/**
 * The safety table. This is the load-bearing artefact of the whole contract and
 * it is data, not scattered `if`s, precisely so it can be read, reviewed and
 * tested in one place.
 */
export interface OutcomePolicy {
  outcome: ReadOutcome;
  /** May this run upsert the records it did read? */
  writeSafe: boolean;
  /**
   * May a record's ABSENCE from this run be taken as positive evidence it went
   * away — i.e. may this run release a calendar block?
   *
   * TRUE FOR EXACTLY TWO OUTCOMES: "OK" and "NO_TRIPS_CONFIRMED", and even then
   * only when the run's CoverageVerdict is complete. Both gates, always.
   */
  releaseSafe: boolean;
  /** Should the run stop issuing HTTP requests immediately? */
  halt: boolean;
  /** Should the run be parked with its cursor intact for a later resume? */
  parkAndResume: boolean;
  /** Is a MAIN-world retry plausibly useful? (page-minted-header failures only) */
  retryInMainWorld: boolean;
  /** Operator-facing sentence. Never blames the operator for our bugs. */
  advice: string;
}

// ===========================================================================
// 2. SESSION PROBE  —  how "empty" is told apart from "blocked"
// ===========================================================================

/**
 * An independent, positive signal that the Turo session is live AND that the
 * JSON API surface is answering truthfully. Without one of these, an empty
 * trips list means nothing.
 *
 * Ordered strongest first. `vehicles_nonempty` is the good one: it costs one
 * request to /api/vehicles/me, which we want anyway for vehicle binding, and a
 * non-empty vehicle list proves the cookie jar, the WAF and the JSON surface
 * are all working at the moment we read zero trips.
 */
export type SessionEvidence =
  /** /api/vehicles/me returned >=1 vehicle. Strong. */
  | "vehicles_nonempty"
  /** A feed envelope carried an authenticated user/host id. Strong. */
  | "host_id_in_envelope"
  /** An earlier page THIS RUN carried real trips. Strong, and free. */
  | "trips_seen_this_run"
  /** /api/vehicles/me answered 200 JSON but with zero vehicles. WEAK — see note. */
  | "vehicles_empty"
  /** Nothing corroborated. */
  | "none";

export interface SessionProbe {
  /**
   * True ONLY on a strong evidence value. `vehicles_empty` does NOT set this:
   * an operator we are migrating off Turo owns cars by definition, so zero
   * vehicles AND zero trips is likelier a degraded surface than a real state.
   */
  liveSession: boolean;
  evidence: SessionEvidence;
  /** Turo's own id for the signed-in host, when we can see it. */
  turoHostId: string | null;
  /**
   * Stable, non-reversible fingerprint of `turoHostId`. Used to abandon (never
   * silently continue) a resumed run if the operator switched Turo accounts
   * between the crash and the resume.
   */
  turoAccountFingerprint: string | null;
  /** Outcome of the probe request itself, so a failed probe is not "empty". */
  probeOutcome: ReadOutcome;
  probedAt: string;
}

// ===========================================================================
// 3. PAGINATION  —  one adapter, four shapes, discovered not assumed
// ===========================================================================

/**
 * Turo returns ~200 results per search page. The PAGINATION SHAPE of the
 * host-trips feed is UNCONFIRMED — we have never seen a response. So the reader
 * supports all four plausible shapes, detects which one it is from the first
 * envelope, and locks that choice for the rest of the run.
 *
 * WHEN WE FINALLY SEE A REAL RESPONSE, exactly one thing changes: the alias
 * lists in `PAGINATION_HINTS` (turo-read-contract.js). Nothing else in the
 * codebase moves. That is the entire point of this indirection.
 */
export type PaginationStyle =
  /** Opaque token: nextCursor / cursor / nextPageToken / paging.next / links.next */
  | "cursor"
  /** Numeric window: offset + limit (+ total). */
  | "offset"
  /** Ordinal pages: page / pageNumber (+ totalPages). */
  | "page"
  /** No affordance found and the batch was short — genuinely one shot. */
  | "none"
  /**
   * No affordance found and the batch was FULL. This is NOT "none". A full
   * final page with no next-link is the classic silent truncation, and calling
   * it "none" is exactly how a sync shows 8/8 green while holding half the data.
   */
  | "unknown";

export interface PaginationPlan {
  style: PaginationStyle;
  /** Which envelope key(s) produced this verdict. Recorded for the first live run. */
  matchedKeys: string[];
  /** Items observed in the largest page so far — our empirical page size. */
  observedPageSize: number | null;
  /**
   * The feed's own claim about how many records exist, if it made one.
   *
   * NEVER TRUSTED FOR COMPLETENESS. It arrives over the same connection, from
   * the same possibly-degraded surface, as the records themselves; a WAF that
   * truncates the list can equally well report `total: 8`. It is displayed as
   * "Turo says N" and used only as a corroborating signal, never as the
   * denominator of a progress bar.
   */
  declaredTotal: number | null;
  confidence: Confidence;
}

/** How to ask for the next page, in whichever style was detected. */
export interface PageRequest {
  /** Deterministic identity of this page. Resuming re-requests the same key. */
  pageKey: string;
  /** Fully-formed RELATIVE path, e.g. "/api/v2/feeds/upcoming-trips?...&offset=200". */
  path: string;
  /** 0-based ordinal within the run, for logging and page caps. */
  index: number;
}

/**
 * Whether we actually got everything. `CoverageVerdict.complete` is a POSITIVE
 * CLAIM and requires an entry from the strong half of this ladder.
 */
export type CoverageEvidence =
  /** The feed explicitly said there is no next page (null/absent cursor). STRONG. */
  | "terminator_absent_next"
  /** The last page held fewer items than `observedPageSize`. STRONG. */
  | "short_final_page"
  /** Style detected as "none" AND the single page was short. STRONG. */
  | "single_short_page"
  /**
   * We collected exactly `declaredTotal` records. WEAK — the total came from
   * the same feed that could be lying. Corroborates; never suffices alone.
   */
  | "matched_declared_total"
  /** Hit the run's page cap. NOT complete. */
  | "page_cap_reached"
  /** A page failed mid-run. NOT complete. */
  | "page_failed"
  /** Full final page with no pagination affordance. NOT complete. */
  | "full_page_no_affordance"
  /** Cursor stopped advancing. NOT complete. */
  | "stalled";

export interface CoverageVerdict {
  /**
   * True only on `terminator_absent_next`, `short_final_page` or
   * `single_short_page`. Everything else is false. `matched_declared_total`
   * alone is NOT enough.
   */
  complete: boolean;
  evidence: CoverageEvidence;
  pagesRead: number;
  recordsSeen: number;
  /** Populated only when the feed volunteered one. Never a denominator. */
  declaredTotal: number | null;
  /**
   * Human sentence for the progress UI. On an incomplete run this must read
   * "read 8 trips (may be more)" and NEVER "8 of 8".
   */
  display: string;
}

// ===========================================================================
// 4. TOLERANT NORMALISATION
// ===========================================================================

export type Confidence = "high" | "medium" | "low" | "rejected";

/** How a value was found. Direct hits are trustworthy; sweeps and derivations are not. */
export type MatchRoute =
  /** An alias matched a key directly on the candidate object. */
  | "direct"
  /** Found by the shallow breadth-first sweep of nested objects. */
  | "deep"
  /** Composed from parts (year + make + model). */
  | "derived"
  /** Parsed out of a display string. Lowest trust that still yields a value. */
  | "parsed"
  /** Not found at all. */
  | "absent";

/** Per-field provenance. This is what makes the first live run self-documenting. */
export interface FieldEvidence {
  route: MatchRoute;
  /** The ACTUAL key name on the wire that produced this value. */
  matchedKey: string | null;
  confidence: Confidence;
}

/**
 * A field we could not confidently find. It is REPORTED, never defaulted.
 * The whole point: silence about a missing field is how a wrong booking gets
 * imported looking correct.
 */
export interface UnknownField {
  /** Our field name, e.g. "ends_at". */
  field: string;
  reason:
    | "no_key_matched"
    | "value_unparseable"
    | "value_ambiguous"
    | "display_string_refused"
    | "conflicting_candidates";
  /** The aliases we looked for, so the fix is obvious when we see real data. */
  candidatesTried: string[];
  /** A short, truncated sample of what we DID see, for diagnosis. */
  sample: string | null;
  /** Does this alone disqualify the record? (missing dates do; missing guest does not) */
  fatal: boolean;
}

/**
 * How a trip was tied to a vehicle. Ordered strongest first.
 *
 * VEHICLE IDENTITY IS THE HARD PART. In our own database `vehicles.reg` is
 * globally unique (453/453 distinct) but `vehicles.vin` is NOT (322 distinct
 * across 396 rows). A VIN is therefore a HINT and never a join key, no matter
 * how authoritative it looks. Older Turo exports carry nothing but a display
 * string like "Owner 1 Wagoneer (Jon) (CA #9DUC203)".
 */
export type VehicleBindEvidence =
  /** Turo's own vehicle id appeared on both the trip and the vehicles list. */
  | "turo_vehicle_id"
  /** Normalised plate matched exactly one vehicle. */
  | "plate_exact"
  /** VIN matched exactly one vehicle. MEDIUM — vin is not unique in our data. */
  | "vin_unique"
  /** VIN matched more than one. NOT a bind. */
  | "vin_ambiguous"
  /** A plate was recovered from a display string like "(CA #9DUC203)". */
  | "label_plate_parsed"
  /** Only year/make/model matched. LOW — several cars in a fleet share these. */
  | "label_fuzzy"
  /** Nothing usable. */
  | "unbound";

/**
 * Everything we know about the vehicle a trip is on. Deliberately carries ALL
 * the identity material rather than resolving to one id here: binding a Turo
 * vehicle to a Drive247 `vehicles` row is a downstream promotion decision that
 * must be reviewable by a human, and it cannot be made at all if the read layer
 * has already thrown the raw material away.
 */
export interface TuroVehicleRef {
  turoVehicleId: string | null;
  /** Uppercased, non-alphanumerics stripped. Compare against vehicles.reg this way. */
  plateNormalised: string | null;
  /** As it appeared on the wire. */
  plateRaw: string | null;
  /** HINT ONLY. Never a join key — see VehicleBindEvidence. */
  vinHint: string | null;
  /** "2023 Tesla Model 3", or the raw display string when that is all there is. */
  label: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  evidence: VehicleBindEvidence;
  confidence: Confidence;
  /** True when a human must confirm before this drives anything. */
  requiresReview: boolean;
  /** The untouched vehicle node, so a later mapping pass has the full material. */
  raw: Record<string, unknown> | null;
}

/**
 * Turo's own lifecycle state, mapped onto a small vocabulary WITHOUT throwing
 * the original away.
 *
 * `completed` IS NOT TERMINAL. Guests can extend a trip up to 24 hours AFTER it
 * ends and Turo auto-accepts. A trip that reads "completed" can therefore
 * become active again. See `TuroReservation.holdUntil`.
 */
export type TripLifecycle =
  | "upcoming"
  | "active"
  | "completed_provisional"
  | "cancelled"
  | "unknown";

export interface TuroReservation {
  // --- identity ----------------------------------------------------------
  /** Turo's trip id. STRING, never a number: Turo has used both shapes. */
  reservationId: string;
  /**
   * A trip can be MOVED to a different vehicle, or reissued under a different
   * reservation id, by a Turo support agent. When the feed volunteers a prior
   * id we keep it, so a downstream reconciler can follow the move rather than
   * seeing one trip vanish and an unrelated one appear.
   */
  supersedesReservationId: string | null;

  // --- when --------------------------------------------------------------
  /** ISO-8601 UTC. REQUIRED — a record without both dates is rejected outright. */
  startsAt: string;
  endsAt: string;
  /**
   * The IANA zone the trip's local times are in, when the feed says. Needed
   * because `blocked_dates` is DATE-only with an INCLUSIVE end while Turo trips
   * are timestamps: converting a timestamp to a calendar date in the wrong zone
   * is how a same-day turnaround becomes a double-booking.
   */
  timezone: string | null;
  /**
   * Do not treat this trip as finished before this instant, even if Turo says
   * "completed". Set to endsAt + 48h. Longer than the 24h extension window on
   * purpose — the window is measured against Turo's clock, not ours.
   */
  holdUntil: string;

  // --- what --------------------------------------------------------------
  vehicle: TuroVehicleRef;
  /** Turo shows guests as "Marcus D." — a first name plus an initial IS complete. */
  guestName: string | null;
  guestId: string | null;
  lifecycle: TripLifecycle;
  /** Turo's own status string, verbatim and untranslated. */
  turoStatusRaw: string | null;
  totalAmount: number | null;
  currency: string | null;

  // --- how well do we believe it -----------------------------------------
  confidence: Confidence;
  /** True when confidence is not "high". Such a record may be written, never acted on. */
  requiresReview: boolean;
  /** Per-field provenance, keyed by our field name. */
  evidence: Record<string, FieldEvidence>;
  /** Everything we could not confidently find. Never empty when something is missing. */
  unknowns: UnknownField[];

  // --- the escape hatch ---------------------------------------------------
  /** The untouched candidate object. */
  raw: Record<string, unknown>;
  /**
   * Every top-level key on `raw` that NO extractor claimed, verbatim.
   *
   * This is the overflow that makes being wrong survivable: when Turo renames
   * `endsAt` to `tripEndTs`, the value is still here, the normaliser reports
   * `ends_at` as an unknown, the record is rejected rather than guessed, and
   * the fix is a one-line alias addition informed by a real payload we kept.
   */
  rawOverflow: Record<string, unknown>;
}

/** A candidate that did not clear the bar. Counted and sampled, never silently dropped. */
export interface RejectedRecord {
  reason: "below_threshold" | "missing_dates" | "missing_id" | "impossible_dates";
  unknowns: UnknownField[];
  /** Key names present on the rejected object — the fastest schema-drift signal there is. */
  observedKeys: string[];
  rawSample: Record<string, unknown> | null;
}

// ===========================================================================
// 5. WHAT ONE PAGE READ RETURNS
// ===========================================================================

/**
 * Returned by the injected reader for ONE HTTP request. Crosses the
 * chrome.scripting bridge, so it must be structured-cloneable: no Errors, no
 * functions, no cycles.
 */
export interface PageReadResult {
  pageKey: string;
  outcome: ReadOutcome;
  message: string;
  httpStatus: number | null;
  finalUrl: string | null;
  /** Which world the read ran in. "chrome" is undefined in MAIN. */
  world: "ISOLATED" | "MAIN";
  bytes: number | null;
  /** Top-level envelope keys. Free schema documentation on the first live run. */
  envelopeKeys: string[];
  /** First 300 chars of a challenge/login body, for attribution. Never logged wholesale. */
  snippet: string | null;
  /** Seconds, parsed from a Retry-After header when the edge sent one. */
  retryAfterSeconds: number | null;
  /** Raw items pulled out of the envelope, before normalisation. */
  items: unknown[];
  /** How to get the next page, or null if this page terminated the walk. */
  next: PageRequest | null;
  /** What this page contributed to the pagination verdict. */
  plan: PaginationPlan;
}

// ===========================================================================
// 6. WHAT A WHOLE RUN RETURNS
// ===========================================================================

/**
 * The absence ledger. Computed by comparing this run's ids against the previous
 * run's manifest, and it is the mechanism that stops silence from deleting.
 */
export type DisappearanceEvidence =
  /** We READ the record and it said cancelled/declined. POSITIVE. Release allowed. */
  | "explicit_cancelled_status"
  /** A targeted re-read of that one reservation id returned 404. POSITIVE. */
  | "targeted_404"
  /** The trip moved to a reservation id we DID see this run. POSITIVE, not a release. */
  | "superseded"
  /**
   * It simply was not in the response. THIS IS NOT EVIDENCE OF ANYTHING and
   * must never release a block, no matter how many consecutive runs repeat it.
   */
  | "absent_only";

export interface Disappearance {
  reservationId: string;
  evidence: DisappearanceEvidence;
  /** True ONLY for the three positive values above. */
  releaseAllowed: boolean;
  /** How many consecutive runs have failed to see it. Reported, never acted on. */
  consecutiveAbsentRuns: number;
  lastSeenAt: string;
}

export interface ReadManifest {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  /** Every reservation id this run positively observed. */
  seenReservationIds: string[];
  /**
   * Histogram of `matchedKey` across every field of every record: the real Turo
   * schema, recovered empirically. Read this after the first live run and the
   * alias lists stop being guesses.
   */
  keyHistogram: Record<string, number>;
  /** Envelope keys seen, deduplicated, across all pages. */
  envelopeKeys: string[];
}

/** The single object a whole sync run hands to the writer. */
export interface TuroReadRun {
  runId: string;
  /** Worst outcome across all pages — the run is only as good as its weakest read. */
  outcome: ReadOutcome;
  policy: OutcomePolicy;
  coverage: CoverageVerdict;
  session: SessionProbe;
  pagination: PaginationPlan;

  reservations: TuroReservation[];
  rejected: RejectedRecord[];
  /** Vehicles from /api/vehicles/me, when that read succeeded. */
  vehicles: TuroVehicleRef[];
  disappearances: Disappearance[];
  manifest: ReadManifest;

  /**
   * THE TWO GATES, resolved. Both must be consulted; neither implies the other.
   *
   *   mayWrite   = policy.writeSafe
   *   mayRelease = policy.releaseSafe && coverage.complete && session.liveSession
   *
   * `mayRelease` is deliberately the conjunction of three independent facts. A
   * clean OK on a truncated walk does not release. A complete walk on an
   * uncorroborated session does not release.
   */
  mayWrite: boolean;
  mayRelease: boolean;
  /** Plain sentence naming which of the three gates failed. Shown to the operator. */
  gateReason: string;
}

// ===========================================================================
// 7. RESUMABILITY  —  MV3 kills the worker at any time
// ===========================================================================

export type RunPhase =
  | "probing_session"
  | "reading_vehicles"
  | "reading_trips"
  | "flushing"
  | "done"
  | "parked";

/**
 * Written AFTER a page's records have been acknowledged by the ingest — never
 * before. Resume replays from the last RECEIPT, not the last fetch, so a worker
 * killed between "fetch returned" and "ingest acked" re-does that one page.
 * That is at-least-once, which is safe: the ingest upserts on
 * (tenant_id, reservation_id).
 */
export interface PageReceipt {
  pageKey: string;
  index: number;
  recordCount: number;
  /** Ids acked by the ingest, so a replay can be recognised as a replay. */
  reservationIds: string[];
  committedAt: string;
}

/**
 * Persisted to chrome.storage.local before EVERY interruptible await. The
 * worker holds no run state in memory — memory does not survive, and a design
 * that pretends otherwise silently restarts (or worse, half-writes) every time
 * Chrome decides to reclaim the worker.
 */
export interface RunCursor {
  runId: string;
  phase: RunPhase;
  /** Monotonic. Bumped on every persist; detects a torn/stale write on resume. */
  seq: number;

  /**
   * TENANT SAFETY. sha256(pairingToken).slice(0,16).
   *
   * One Chrome profile can hold ONE Turo cookie jar and TWO Drive247 tenants.
   * If the pairing token in storage no longer fingerprints to this value, the
   * operator re-paired to a different tenant and this run is ABANDONED, not
   * resumed. Flushing tenant A's pages under tenant B's token is the worst
   * outcome available in this system and it is unrecoverable once written.
   */
  tokenFingerprint: string;
  /** Same idea for the Turo side: switching Turo accounts abandons the run. */
  turoAccountFingerprint: string | null;

  /** The page we are about to request (the "intent"). */
  pending: PageRequest | null;
  /** Pages whose records the ingest has acknowledged. */
  receipts: PageReceipt[];
  /** Locked after the first page; a mid-run style change is a stall, not an adaptation. */
  pagination: PaginationPlan | null;
  session: SessionProbe | null;

  /** Ids already flushed this run — replay recognition without re-reading storage. */
  flushedIds: string[];
  /** Consecutive 429s / challenges, for backoff across a worker death. */
  throttleStrikes: number;
  /** Do not issue another request before this instant. Survives a worker death. */
  nextAllowedAt: string | null;

  startedAt: string;
  updatedAt: string;
  /** Why the run parked, when phase === "parked". */
  parkedReason: ReadOutcome | null;
}

// ===========================================================================
// 8. RATE DISCIPLINE
// ===========================================================================

export interface RateLimits {
  /** Serial only. Concurrency is never an option against a WAF-fronted host. */
  readonly concurrency: 1;
  /** Base gap between page reads, ms. */
  baseDelayMs: number;
  /** +/- jitter, ms. Uniform pacing is itself a bot signal. */
  jitterMs: number;
  /** Backoff ladder for 429, ms. Retry-After overrides when present. */
  backoffLadderMs: number[];
  /** Give up and PARK (cursor intact) after this many consecutive 429s. */
  maxThrottleStrikes: number;
  /** Hard ceiling on pages per run. Hitting it is `page_cap_reached`, not complete. */
  maxPages: number;
  /** Hard ceiling on wall-clock per run, ms. */
  maxRunMs: number;
  /**
   * Cool-down after a bot challenge, ms. On BOT_BLOCKED we issue ZERO further
   * requests: retrying into a live challenge is what turns a soft check into a
   * hard block on the operator's own account.
   */
  challengeCooldownMs: number;
}

// ===========================================================================
// 9. PAGINATION HEALTH
// ===========================================================================

/**
 * Two ways a paginated walk goes wrong without ever failing: the cursor stops
 * advancing (we re-request one page forever, walking straight into a rate limit
 * and then a challenge on the operator's own Turo account), or the cursor
 * advances but the CONTENT repeats (inflating the record count so a truncated
 * read looks abundant). Both look like progress from the inside.
 */
export interface StallVerdict {
  stalled: boolean;
  reason: string | null;
}

/** Records are deduplicated on reservationId across pages; last write wins. */
export interface MergeResult {
  added: string[];
  duplicates: number;
}

// ===========================================================================
// 10. THE ORCHESTRATION SEAM
//
// The runtime is split by CAPABILITY, not by convenience:
//
//   TAB ONLY  (touches fetch/location, must be same-origin — see the header of
//              turo-read-contract.js): readPage, readVehicles
//   PURE      (safe in the worker, in either world, and in a plain node test):
//              everything else
//
// The orchestrator lives in the worker because only the worker has chrome.*,
// and it does exactly this per page:
//
//   1. persist the cursor with `pending` set          <- BEFORE the await
//   2. executeScript -> readPage(pending, lockedPlan)
//   3. throttleDecision() on a non-OK outcome; park or back off
//   4. normalizeRecord() each item; mergeRecords()
//   5. detectStall(); stop if stalled
//   6. POST to turo-bridge-ingest
//   7. commitReceipt() and persist                    <- AFTER the ack
//
// Step 1 before step 2 and step 7 after step 6 are the whole resumability
// design. A worker killed anywhere in between re-runs one page, which the
// ingest's upsert on (tenant_id, reservation_id) absorbs.
//
// NOT YET IN manifest.json: resuming after a worker death needs the "alarms"
// permission (chrome.alarms is the only thing that can wake a dead worker).
// The current manifest declares only "scripting" and "storage". Adding a
// permission is also a Chrome Web Store review surface, so it is called out
// here rather than assumed.
// ===========================================================================
