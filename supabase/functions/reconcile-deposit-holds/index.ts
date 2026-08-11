// Reconcile every non-terminal deposit hold in the database against the TRUTH
// at Stripe. Runs every 6 hours via pg_cron.
//
// WHY THIS EXISTS
// ---------------
// Nothing in this codebase ever reads Stripe back. A card authorisation expires
// on its own — ~5-7 days at the network default, up to ~30 with extended
// authorization — and when it does Stripe CANCELS the PaymentIntent and returns
// the funds. Every webhook in this repo looks PaymentIntents up by
// payments.stripe_payment_intent_id, but a deposit hold's id lives on
// rentals.deposit_hold_payment_intent_id and has no payments row at all. So the
// rental keeps saying deposit_hold_status = 'held' forever: the operator sees a
// green "Held" badge on a dead authorisation, place-deposit-hold and
// create-hold-checkout both short-circuit with "a hold is already active", and
// there is no way forward from any screen. That is verbatim GMT's report — "I
// cannot refresh the hold. This is affecting our day to day business", Aug 2026.
//
// verify-deposit-hold fixes ONE rental when an operator asks. capture-deposit-hold
// self-heals at the counter, after the damage. This function is the sweep that
// makes the whole chain survivable without anyone noticing something is wrong,
// and it is also the only thing that reaps rows stranded in a claim state
// ('processing' / 'refreshing' / 'capturing') by a crash, a timeout or a deploy
// mid-flight — states that are invisible to every other code path.
//
// PRINCIPLES (all three are load-bearing; breaking any one re-creates the incident)
//
//  1. RECORD-ANCHORED. The hold lives on the platform account, connected
//     account and Stripe mode it was CREATED under (deposit_hold_platform_account
//     / deposit_hold_connect_account_id / deposit_hold_stripe_mode, falling back
//     to rentals.platform_account) —
//     never the tenant's CURRENT values. Read it with the wrong platform's keys
//     during the UK→UAE migration and Stripe reports the PI as missing, which
//     looks exactly like an expired hold and would mark a live authorisation dead.
//
//  2. FAIL SAFE, NEVER OPEN. Anything we cannot conclude — Stripe unreachable,
//     an id Stripe has never heard of, a PI still mid-authorisation, a Stripe
//     context we cannot resolve, a rental row we could not read — leaves the row
//     exactly as it is. We never write a state that would allow a SECOND
//     authorisation on a renter's card on the strength of a guess, and we never
//     cancel an authorisation without positively proving it is an orphan.
//
//     In particular a row that says 'held' is NEVER demoted on an INCONCLUSIVE
//     read. 'needs_review' is not an inert annotation: every downstream guard
//     (place-deposit-hold:175, create-hold-checkout:111, cancel-rental-refund:299,
//     deduct-from-deposit:158, sync-deposit-hold:50) keys on the literal 'held',
//     so demoting 'held' would simultaneously unblock a second authorisation and
//     stop the release path from ever giving the renter's money back. An
//     unconsultable hold keeps being treated as live; the ambiguity is recorded
//     in deposit_hold_last_error_code instead. Only rows that are NOT 'held'
//     (stranded claim states) may be moved to 'needs_review'.
//
//  3. EXPIRY PROVENANCE. deposit_hold_expires_at is only ever written from a
//     value genuinely read off the charge (payment_method_details.card.capture_before)
//     and stamped deposit_hold_expiry_source = 'stripe_capture_before'. We
//     deliberately do NOT call _shared/stripe-client.ts's resolveHoldExpiry here:
//     it returns now + 7 days whenever it cannot read capture_before, and that
//     value MOVES on every call. Persisting it would re-arm the clock on every
//     6-hourly run, and refresh-deposit-holds selects work with
//     `.lt('deposit_hold_expires_at', now + 2 days)` — so a rental reconciled
//     more often than once every 5 days could NEVER enter the refresh window and
//     its hold would die unnoticed at the real deadline. That IS the GMT
//     incident. When capture_before is absent we leave the stored value alone.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//  * It never inserts a `payments` row, not even for a hold Stripe reports as
//    'succeeded' (captured). Backfilling payments rows keyed on deposit-hold
//    PaymentIntents arms the rental-cancellation path on every rental it
//    touches. Payments rows are written exclusively by capture-deposit-hold.
//  * It never touches money except to CANCEL an authorisation that is provably
//    an orphan (a link the DB has already superseded, or a crashed writer's
//    pending link that no rental points at). Cancelling releases a renter's
//    funds; it can never take them.
//
// AUTH: `verify_jwt = false` in config.toml (pg_cron carries no user JWT), so
// the gateway lets anonymous requests through and the check in THIS file is the
// only gate. It accepts either:
//   * `x-platform-secret` — what pg_cron sends, validated by the
//     `platform_verify_secret(p_secret)` DB RPC, or
//   * `Authorization: Bearer <super-admin user JWT>` — manual/admin dispatch.
// Anything else is 401.
//
// This used to accept the service-role bearer instead. It no longer does: a
// valid production service_role JWT is committed in plaintext at
// supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql and is pending
// rotation, so it is not a credential this endpoint should trust. The platform
// secret is the same scheme onboarding-daily-digest and platform-rental-notify
// already use, which keeps the number of internal-caller credentials at one.
//
// DEPLOY ORDER MATTERS: the pg_cron command for this job must send
// `x-platform-secret` — because net.http_post is asynchronous, a 401 lands in
// net._http_response and never in cron.job_run_details, so a schedule sending
// the wrong credential looks perfectly healthy while nothing is reconciled. The
// cron_runs dead-man row is the backstop: no heartbeat is written on a 401.
//
// Body (all optional, for manual/admin dispatch):
//   { only_rental_id?: string, tenant_id?: string, dry_run?: boolean }

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getConnectAccountId,
  getStripeClientForRecord,
  readHoldCaptureFacts,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from "../_shared/stripe-client.ts";
// Imported rather than re-derived: this must agree with the refresh engine
// EXACTLY about when a chain has ended, or the bell fires on a chain that is
// still being renewed (noise) or stays silent on one that is not (the bug).
import { resolveChainBound } from "../_shared/deposit-hold-refresh.ts";
import { notifyDepositHoldChainEnded } from "../_shared/deposit-hold-notify.ts";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const JOB_NAME = "reconcile-deposit-holds";

/** Every deposit state from which the DB can still be wrong about Stripe.
 *  'released', 'captured', 'expired' and 'disputed' are terminal — the first
 *  three because nothing more can happen to the authorisation, the last because
 *  only a human closes a dispute. */
const NON_TERMINAL_HOLD_STATUSES = [
  "held",
  "refreshing",
  "processing",
  "capturing",
  "failed",
  "requires_action",
  "needs_review",
];

/** States in which another worker is supposed to be mid-flight on the row. */
const CLAIM_STATUSES = new Set(["processing", "refreshing", "capturing"]);

/** Rows fetched per keyset page. */
const PAGE_SIZE = 100;

/** Hard ceiling per invocation. Prod carries ~166 rentals in total, so this
 *  never truncates today; it exists so a runaway dataset cannot kill the
 *  isolate mid-write. Truncation is recorded in cron_runs.truncated. */
const MAX_RENTALS = 500;

/** Stop starting new work after this long so the isolate is never killed
 *  mid-write. Whatever is left is picked up on the next tick (6h). Supabase
 *  edge functions die at 150s idle / 400s wall clock. */
const MAX_RUN_MS = 120_000;

/** Small concurrent chunks: one Stripe round-trip each, well inside Stripe's
 *  rate limits, but ~5x faster than the strictly serial loop that made
 *  refresh-deposit-holds truncate arbitrarily (EC-20). */
const CONCURRENCY = 5;

/** A claim ('processing'/'refreshing'/'capturing') older than this is stranded,
 *  not in flight — spec §2.3. Resolved against Stripe, never guessed. */
const STUCK_CLAIM_MS = 30 * 60_000;

/** A deposit_hold_links row still 'pending' after this long belongs to a writer
 *  that died; its PaymentIntent (if any) may be holding a renter's funds with
 *  nothing pointing at it. */
const PENDING_LINK_STALE_MS = 60 * 60_000;

/** A pending link that never recorded a payment_intent_id cannot be checked at
 *  Stripe at all. We leave it pending (never guess) until it is this old — past
 *  Stripe's 24h idempotency window the writer is definitively dead, so we close
 *  the LEDGER row (money is unaffected either way) rather than let unresolvable
 *  rows accumulate at the head of the queue and starve newer ones. */
const UNLINKED_LINK_GIVEUP_MS = 24 * 60 * 60_000;

/** How far back the superseded-PI sweep looks. No card authorisation outlives
 *  30 days on any network (Visa 29d18h; Mastercard/Amex/Discover 30), so a
 *  superseded PaymentIntent older than this cannot still be holding funds —
 *  this bound is a network fact, not an optimistic assumption. */
const SUPERSEDED_LOOKBACK_MS = 35 * 24 * 60 * 60_000;

const ORPHAN_LINK_LIMIT = 50;

/** The superseded sweep is keyset-paginated over the WHOLE lookback window, so
 *  this is a page size, not a ceiling. It used to be a hard `.limit(40)` on a
 *  created_at DESC query with nothing recorded to mark a link as checked, which
 *  meant the newest 40 links were re-examined forever and everything older was
 *  never examined again — and the orphans that matter (a cancel that failed
 *  weeks ago and is still holding a renter's funds) are by definition the older
 *  rows. */
const SUPERSEDED_PAGE_SIZE = 25;

/** Ledger actions written by THIS function's sweeps. They carry superseded_pi_id
 *  themselves, so they must be excluded from the candidate query (otherwise the
 *  sweep re-discovers its own bookkeeping), and they are what marks a superseded
 *  PaymentIntent as already checked. */
const ORPHAN_CANCEL_ACTION = "orphan_cancel";
const SUPERSEDED_CLEAR_ACTION = "reconcile:superseded_clear";
const SWEEP_MARKER_ACTIONS = [ORPHAN_CANCEL_ACTION, SUPERSEDED_CLEAR_ACTION];

/** Time the pending-link sweep is guaranteed even if the rental pass burns the
 *  whole MAX_RUN_MS budget. See the call site: without a reserve the sweep would
 *  be starved on every run of a busy day. */
const ORPHAN_SWEEP_RESERVE_MS = 15_000;

/** Separate floor for the superseded sweep so a long pending-link sweep cannot
 *  starve it — they used to share one deadline, and the second one to run always
 *  lost. Worst case the whole invocation is MAX_RUN_MS + both reserves (~165s),
 *  still far inside the isolate's 400s wall clock. */
const SUPERSEDED_SWEEP_RESERVE_MS = 30_000;

/** When Stripe says the card is gone (requires_payment_method) we hand the row
 *  back to the placement engine with a retry time. One hour: a hard decline
 *  does not fix itself in minutes, and the engine's own schedule picks it up
 *  regardless. We deliberately do NOT bump deposit_hold_failure_count — that
 *  counter drives the engine's exponential backoff, and a reconciler observing
 *  the same failure four times a day would compound the backoff into silence. */
const FAILED_RETRY_DELAY_MS = 60 * 60_000;

// Stripe PaymentIntent status -> the deposit_hold_status that is TRUE when we
// see it. Anything not listed here (processing, requires_confirmation) is still
// in motion: no funds are authorised yet, but it is not dead either, so writing
// any terminal status for it would be a lie.
//
// Every value on the right MUST exist in the rentals.deposit_hold_status CHECK
// constraint (processing | refreshing | capturing | held | requires_action |
// failed | needs_review | disputed | captured | released | expired) — the
// constraint rejects anything else at runtime.
const PI_STATUS_TO_HOLD_STATUS: Record<string, string> = {
  requires_capture: "held",
  canceled: "expired",
  succeeded: "captured",
  requires_payment_method: "failed",
  requires_action: "requires_action",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RentalRow {
  id: string;
  tenant_id: string;
  platform_account: string | null;
  /** Both feed resolveChainBound — see the chain-ended bell below. */
  end_date: string | null;
  deposit_hold_chain_expires_at: string | null;
  deposit_hold_status: string | null;
  deposit_hold_payment_intent_id: string | null;
  deposit_hold_expires_at: string | null;
  deposit_hold_expiry_source: string | null;
  deposit_hold_extended_auth: boolean | null;
  deposit_hold_window_seconds: number | null;
  deposit_hold_connect_account_id: string | null;
  deposit_hold_stripe_mode: string | null;
  deposit_hold_currency: string | null;
  /** The platform account the HOLD was created on ('uk' | 'uae'), written by
   *  place-deposit-hold. NULL on every row placed before that write existed, in
   *  which case rentals.platform_account remains the answer. */
  deposit_hold_platform_account: string | null;
  deposit_hold_status_changed_at: string | null;
  deposit_hold_attempt_seq: number | null;
  deposit_hold_amount: number | null;
  deposit_hold_last_error_code: string | null;
  deposit_hold_release_requested_at: string | null;
  deposit_hold_card_brand: string | null;
  deposit_hold_card_last4: string | null;
  deposit_hold_card_exp_month: number | null;
  deposit_hold_card_exp_year: number | null;
  deposit_hold_card_funding: string | null;
}

const RENTAL_COLUMNS = `
  id, tenant_id, platform_account,
  end_date, deposit_hold_chain_expires_at,
  deposit_hold_status, deposit_hold_payment_intent_id,
  deposit_hold_expires_at, deposit_hold_expiry_source,
  deposit_hold_extended_auth, deposit_hold_window_seconds,
  deposit_hold_connect_account_id, deposit_hold_stripe_mode, deposit_hold_currency,
  deposit_hold_platform_account,
  deposit_hold_status_changed_at, deposit_hold_attempt_seq, deposit_hold_amount,
  deposit_hold_last_error_code, deposit_hold_release_requested_at,
  deposit_hold_card_brand, deposit_hold_card_last4,
  deposit_hold_card_exp_month, deposit_hold_card_exp_year, deposit_hold_card_funding
`;

interface TenantRow {
  id: string;
  stripe_mode: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  payment_model: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
}

interface LinkRow {
  id: string;
  rental_id: string;
  tenant_id: string;
  attempt_seq: number;
  action: string;
  payment_intent_id: string | null;
  superseded_pi_id: string | null;
  platform_account: string | null;
  connect_account_id: string | null;
  stripe_mode: string | null;
  outcome: string | null;
  created_at: string;
}

const LINK_COLUMNS =
  "id, rental_id, tenant_id, attempt_seq, action, payment_intent_id, superseded_pi_id, " +
  "platform_account, connect_account_id, stripe_mode, outcome, created_at";

interface StripeContext {
  stripe: ReturnType<typeof getStripeClientForRecord>;
  stripeOptions: { stripeAccount?: string } | undefined;
  connectAccountId: string | null;
  mode: StripeMode;
  /**
   * The platform this context ACTUALLY talks to — anchor-resolved, so it can
   * differ from `rental.platform_account` during a UK<->UAE migration.
   *
   * Exposed because the ledger stamps below used to record
   * `rental.platform_account` while operating on this one. Observed live: a
   * `reconcile:held` row claiming `uk` next to a `uae` connect account. The
   * operation succeeded, so nothing broke — but the audit trail is the only
   * record of which platform an authorisation was touched on, and a migration
   * post-mortem reading it would be misled.
   */
  platformAccount: string;
}

interface Summary {
  examined: number;
  corrected: number;
  verified: number;
  inFlight: number;
  claimsSkippedActive: number;
  needsReview: number;
  /** Reads that could not be concluded (Stripe has no record of the anchored id
   *  on a row we therefore left exactly as it was). Distinct from needsReview:
   *  no state machine transition happened. */
  inconclusive: number;
  unresolvableContext: number;
  lostRace: number;
  failed: number;
  truncated: boolean;
  orphansCancelled: number;
  linksResolved: number;
  supersededCancelled: number;
  supersededExamined: number;
  supersededAlreadyChecked: number;
  transitions: Record<string, number>;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * The only gate on this endpoint (see the AUTH note in the file header).
 *
 * Accepts EITHER the platform secret (pg_cron) OR a super-admin user JWT
 * (manual/admin dispatch). Mirrors `onboarding-daily-digest` and
 * `platform-rental-notify` rather than inventing a scheme.
 *
 * Fails SAFE: every error path — a missing env var, an RPC error, a GoTrue
 * outage, a failed app_users lookup — returns false. This endpoint cancels
 * authorisations and rewrites deposit state; an outage must never open it.
 *
 * @param supabase a SERVICE-ROLE client. `platform_verify_secret` is
 *   service-role-only, and the app_users lookup must not be filtered by RLS.
 */
async function isAuthorizedCaller(req: Request, supabase: SupabaseClient): Promise<boolean> {
  // 1. Platform secret — the cron path. Validated by a DB RPC so the secret
  //    itself never has to be present in this function's environment.
  const secret = req.headers.get("x-platform-secret");
  if (secret) {
    try {
      const { data: ok, error } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (error) console.error("[HOLD-RECONCILE] platform_verify_secret rpc failed:", error.message);
      else if (ok === true) return true;
    } catch (err) {
      console.error("[HOLD-RECONCILE] platform_verify_secret rpc threw:", err);
    }
  }

  // 2. Super-admin user JWT — the manual-dispatch path.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) {
    console.error("[HOLD-RECONCILE] SUPABASE_URL / SUPABASE_ANON_KEY missing — cannot verify a user JWT; denying.");
    return false;
  }

  let userId: string | null = null;
  try {
    const authClient = createClient(supabaseUrl, anonKey);
    // NOTE: the anon key and the service-role key are themselves valid project
    // JWTs, but neither carries a `sub`, so getUser() yields no user for them.
    // That is what stops a bare apikey — or the leaked service_role key — from
    // walking through this branch.
    const { data, error } = await authClient.auth.getUser(token);
    if (error) {
      console.warn("[HOLD-RECONCILE] JWT rejected:", error.message);
      return false;
    }
    userId = data?.user?.id ?? null;
  } catch (err) {
    console.error("[HOLD-RECONCILE] getUser threw:", err);
    return false;
  }
  if (!userId) return false;

  // Filter on is_super_admin in the query and take the first row rather than
  // .single(): a principal with more than one app_users row would otherwise
  // make .single() error and lock a legitimate super admin out.
  const { data: rows, error: lookupError } = await supabase
    .from("app_users")
    .select("id")
    .eq("auth_user_id", userId)
    .eq("is_super_admin", true)
    .limit(1);
  if (lookupError) {
    console.error("[HOLD-RECONCILE] app_users lookup failed:", lookupError.message);
    return false;
  }
  return (rows?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Stripe context — RECORD-anchored
// ---------------------------------------------------------------------------

/**
 * Resolve the Stripe client the EXISTING hold lives behind.
 *
 * Preference order, strongest first:
 *   1. rentals.deposit_hold_platform_account / _stripe_mode / _connect_account_id
 *      — written at placement precisely so later operations never re-derive
 *      context. Each is preferred independently: a row may carry one anchor and
 *      not the others (they were added at different times).
 *   2. rentals.platform_account + the tenant's current Stripe columns — the
 *      legacy path, correct for every hold placed before the anchor columns
 *      existed, and still the answer for every row until they are populated.
 *
 * Returns null (never throws) when the context cannot be resolved:
 * getConnectAccountId THROWS for a live payment_model='own' tenant with no
 * connected account, and platform_account='uae' forces that model — so a tenant
 * mid-OAuth would otherwise take down the whole batch. An unresolvable context
 * means we cannot consult Stripe, which by principle 2 means we change nothing.
 */
function resolveStripeContext(rental: RentalRow, tenant: TenantRow | undefined): StripeContext | null {
  try {
    const anchoredMode =
      rental.deposit_hold_stripe_mode === "test" || rental.deposit_hold_stripe_mode === "live"
        ? (rental.deposit_hold_stripe_mode as StripeMode)
        : null;
    const mode: StripeMode = anchoredMode ?? ((tenant?.stripe_mode as StripeMode) || "test");

    // WHICH PLATFORM ACCOUNT (UK vs UAE) the hold lives on.
    //
    // rentals.platform_account is the RENTAL's platform and other paths can
    // rewrite it — sync-deposit-hold could overwrite the anchor — after which we
    // looked the PaymentIntent up on the wrong platform, got resource_missing,
    // and (correctly, by principle 2) refused to conclude anything. The hold then
    // became permanently unreconcilable. deposit_hold_platform_account is written
    // by place-deposit-hold and describes the HOLD, so it wins when present.
    //
    // COMPATIBILITY: the column is NULL on every row placed before it existed, and
    // the fallback below is byte-for-byte what getStripeClientForRecord already
    // does with rentals.platform_account (`=== 'uae' ? 'uae' : 'uk'`), so a NULL
    // anchor resolves to exactly the client this function has always used. Only a
    // row carrying a real 'uk'/'uae' value can take the new branch. A value that
    // is neither (impossible under the CHECK, but not worth trusting on a money
    // path) is ignored rather than guessed at.
    const anchoredPlatform =
      rental.deposit_hold_platform_account === "uk" || rental.deposit_hold_platform_account === "uae"
        ? rental.deposit_hold_platform_account
        : null;
    const platformAccount = anchoredPlatform ?? (rental.platform_account === "uae" ? "uae" : "uk");
    // Fed through the same helper as before so the key selection stays in one
    // place; the synthetic record differs from `rental` only when the hold's own
    // anchor is set and disagrees.
    const stripe = getStripeClientForRecord({ platform_account: platformAccount }, mode);

    let connectAccountId = rental.deposit_hold_connect_account_id || null;
    if (!connectAccountId) {
      if (!tenant) return null;
      connectAccountId = getConnectAccountId({
        // The ANCHORED mode, not tenant.stripe_mode. getConnectAccountId returns
        // a different account per mode (shared test Connect account vs the
        // tenant's own live account), so feeding it the tenant's CURRENT mode
        // while keying the client with the record's mode pairs test keys with a
        // live account id the moment a tenant goes live mid-rental — the
        // ordinary go-live flip, not an exotic case. Stripe then answers
        // resource_missing, which looks exactly like a dead hold. Anchoring the
        // client and the account to the same mode is the whole point of
        // principle 1.
        stripe_mode: mode,
        stripe_account_id: tenant.stripe_account_id,
        stripe_onboarding_complete: tenant.stripe_onboarding_complete,
        // The hold's own platform decides the model, not the tenant's today.
        // Same resolved value as the client above — deriving the account from a
        // different platform than the keys is precisely the mismatch that yields
        // resource_missing. Identical to the previous expression whenever
        // deposit_hold_platform_account is NULL.
        payment_model: platformAccount === "uae" ? "own" : "managed",
        own_stripe_account_id: tenant.own_stripe_account_id,
        own_stripe_test_account_id: tenant.own_stripe_test_account_id,
      });
    }

    return {
      stripe,
      stripeOptions: connectAccountId ? { stripeAccount: connectAccountId } : undefined,
      connectAccountId,
      mode,
      platformAccount,
    };
  } catch (err) {
    console.warn("[HOLD-RECONCILE] Stripe context unresolvable for rental", rental.id, err);
    return null;
  }
}

/** Same resolution for a ledger link, which carries its own anchor columns. */
function resolveLinkContext(link: LinkRow, rental: RentalRow | undefined, tenant: TenantRow | undefined): StripeContext | null {
  const synthetic: RentalRow = {
    ...(rental ?? ({} as RentalRow)),
    id: link.rental_id,
    tenant_id: link.tenant_id,
    platform_account: link.platform_account ?? rental?.platform_account ?? null,
    // MUST be set explicitly. The spread above now carries the RENTAL's
    // deposit_hold_platform_account, which resolveStripeContext prefers over
    // platform_account — so without this line a link would be resolved against the
    // rental's CURRENT hold platform instead of the platform recorded for that
    // link's own PaymentIntent. These sweeps cancel authorisations; the link's own
    // anchor is the strongest evidence about the PI it names and must stay first.
    // Falls through to the rental's hold anchor only when the link has none, and
    // then to `platform_account` above (via resolveStripeContext) when both are
    // NULL — which is every row today, so the link paths are unchanged.
    deposit_hold_platform_account: link.platform_account ?? rental?.deposit_hold_platform_account ?? null,
    deposit_hold_stripe_mode: link.stripe_mode ?? rental?.deposit_hold_stripe_mode ?? null,
    deposit_hold_connect_account_id: link.connect_account_id ?? rental?.deposit_hold_connect_account_id ?? null,
  };
  return resolveStripeContext(synthetic, tenant);
}

// ---------------------------------------------------------------------------
// Reading truth off the authorising charge
// ---------------------------------------------------------------------------

interface ChargeFacts {
  /** ISO timestamp, or null when Stripe has published no deadline. NEVER a guess. */
  captureBefore: string | null;
  extendedAuth: boolean | null;
  /** Raw Stripe value ('enabled' | 'disabled'), kept verbatim for the ledger. */
  extendedAuthStatus: string | null;
  windowSeconds: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardFunding: string | null;
}

/**
 * Everything we are allowed to persist about a live authorisation.
 *
 * The lifetime half delegates to _shared/stripe-client.ts's
 * readHoldCaptureFacts — the NO-FALLBACK reader, same as verify-deposit-hold
 * uses. Deliberately NOT resolveHoldExpiry / resolveHoldExpiryDetailed: those
 * layer a `now + HOLD_EXPIRY_FALLBACK_DAYS` floor on top, and that value MOVES
 * on every call. Persisting it from a job that runs four times a day would
 * re-arm deposit_hold_expires_at on every pass, and the refresh engine selects
 * work with `.lt('deposit_hold_expires_at', now + lookahead)` — so a reconciled
 * rental could NEVER enter the refresh window and its hold would die unnoticed
 * at the real deadline. That is principle 3 in the header, and it is the GMT
 * incident itself.
 *
 * readHoldCaptureFacts THROWS on transport failures and explicitly must not be
 * read as "no deadline". For us the handling is the same either way — leave the
 * stored value alone — but the log line must say which happened, so the catch
 * is here rather than folded into the return.
 *
 * The card-identity half is read locally: the shared helper does not surface it
 * and it comes free off the charge we already expanded. It makes "which card is
 * this hold on" answerable and debit stacking detectable, which is the main
 * renter-harm risk on a 90-day chain.
 */
async function readChargeFacts(
  stripe: ReturnType<typeof getStripeClientForRecord>,
  intent: any,
  stripeOptions: { stripeAccount?: string } | undefined
): Promise<ChargeFacts> {
  let lifetime: Awaited<ReturnType<typeof readHoldCaptureFacts>> = null;
  try {
    lifetime = await readHoldCaptureFacts(stripe, intent, stripeOptions);
    if (!lifetime) {
      console.log("[HOLD-RECONCILE] Stripe has published no capture_before yet for", intent?.id, "— stored expiry left untouched");
    }
  } catch (err) {
    console.warn("[HOLD-RECONCILE] Could not read capture_before; leaving stored expiry untouched:", err);
  }

  // Card identity off the charge we already have in hand. Never a second
  // round-trip: if latest_charge did not come back expanded, readHoldCaptureFacts
  // above has already paid for the retrieve and we simply record nothing here.
  const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const card = charge?.payment_method_details?.card ?? null;

  return {
    captureBefore: lifetime?.captureBefore ?? null,
    extendedAuth: lifetime?.extendedAuth ?? null,
    extendedAuthStatus: lifetime?.extendedAuthStatus ?? null,
    windowSeconds: lifetime?.windowSeconds ?? null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    cardExpMonth: typeof card?.exp_month === "number" ? card.exp_month : null,
    cardExpYear: typeof card?.exp_year === "number" ? card.exp_year : null,
    cardFunding: card?.funding ?? null,
  };
}

// ---------------------------------------------------------------------------
// Guarded writes
// ---------------------------------------------------------------------------

/**
 * Compare-and-set on BOTH the status we read AND the PaymentIntent we probed.
 *
 * Status alone is not enough, and the gap is not theoretical — it opens exactly
 * when we conclude "canceled", because that is what refresh-deposit-holds does
 * to the incumbent PI:
 *   T0  we read the row: status='held', PI=PI_A
 *   T1  the refresh engine cancels PI_A, creates PI_B, writes PI_B + 'held'
 *   T2  our probe of PI_A returns 'canceled' → we classify it dead
 *   T3  a status-only CAS still matches ('held' again) and we stamp 'expired'
 *       over a row that now carries a LIVE authorisation
 * The renter would then be authorised on top of PI_B — two live holds on one
 * card, the exact outcome this workstream exists to prevent. A row whose PI has
 * moved on is by definition not the row we probed, so a 0-row update is the
 * CORRECT outcome.
 *
 * NOTE: a PostgREST `.or()` filter on `.update()` mis-qualifies the column
 * ("column rentals.deposit_hold_status does not exist"), so we branch on the
 * proven `.is(null)` / `.eq()` filters — same idiom as place-deposit-hold's
 * atomic claim and verify-deposit-hold's casUpdate.
 */
async function casUpdateRental(
  supabase: SupabaseClient,
  rentalId: string,
  expectedStatus: string | null,
  expectedPi: string | null,
  patch: Record<string, unknown>
): Promise<boolean> {
  let query = supabase.from("rentals").update(patch).eq("id", rentalId);
  query = expectedStatus === null
    ? query.is("deposit_hold_status", null)
    : query.eq("deposit_hold_status", expectedStatus);
  query = expectedPi === null
    ? query.is("deposit_hold_payment_intent_id", null)
    : query.eq("deposit_hold_payment_intent_id", expectedPi);

  const { data, error } = await query.select("id");
  if (error) throw new Error(`Failed to save reconciled deposit hold: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Append to the authorization ledger. Bookkeeping must NEVER fail a
 * reconciliation: deposit_hold_links carries UNIQUE(rental_id, attempt_seq,
 * action), so a repeated correction at the same attempt_seq collides — that is
 * a duplicate record, not a money problem, and swallowing it is correct.
 */
async function recordLink(supabase: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("deposit_hold_links").insert({
    actor: "reconciler",
    ...row,
  });
  if (error) {
    console.warn("[HOLD-RECONCILE] Ledger insert failed (continuing):", error.message, row);
  }
}

// ---------------------------------------------------------------------------
// Per-rental reconciliation
// ---------------------------------------------------------------------------

type RentalOutcome =
  | "corrected"
  | "verified"
  | "unchanged"
  | "in_flight"
  | "claim_active"
  | "needs_review"
  | "inconclusive"
  | "unresolvable"
  | "lost_race"
  // Produced only by the per-rental catch in the main loop (a Stripe/transport
  // failure), never returned by reconcileRental itself.
  | "failed";

async function reconcileRental(
  supabase: SupabaseClient,
  rental: RentalRow,
  tenant: TenantRow | undefined,
  opts: { dryRun: boolean; activeClaim: boolean }
): Promise<{ outcome: RentalOutcome; transition?: string }> {
  const currentStatus = rental.deposit_hold_status ?? null;
  const probedPiId = rental.deposit_hold_payment_intent_id || null;
  const attemptSeq = rental.deposit_hold_attempt_seq ?? 0;
  const nowIso = new Date().toISOString();

  // ── Stuck-claim gate ────────────────────────────────────────────────────
  // A claim state means another worker owns the row: place-deposit-hold holds
  // it at 'processing' while it authorises, the refresh engine at 'refreshing'
  // while it swaps PaymentIntents, capture at 'capturing'. Only a STRANDED
  // claim is ours to resolve (spec §2.3: older than 30 minutes).
  //
  // deposit_hold_status_changed_at is NULL on every row written before that
  // column existed, and those are precisely the rows stranded by the old
  // refresh cron — the ones we most need to recover. So NULL counts as stale,
  // but `activeClaim` (a deposit_hold_links row created for this rental within
  // the last 30 minutes) still holds us off: a live writer always leaves a
  // fresh ledger row, which is a stronger liveness signal than a column nobody
  // wrote yet.
  if (CLAIM_STATUSES.has(currentStatus ?? "")) {
    const changedAt = rental.deposit_hold_status_changed_at
      ? new Date(rental.deposit_hold_status_changed_at).getTime()
      : null;
    const stale = changedAt === null || Date.now() - changedAt > STUCK_CLAIM_MS;
    if (!stale || opts.activeClaim) {
      return { outcome: "claim_active" };
    }
  }

  // ── Nothing to probe ────────────────────────────────────────────────────
  // No PaymentIntent recorded. A 'held' or claim-state row with no PI is a
  // record that cannot be true and cannot be checked: the writer died before it
  // ever persisted an id, so there may or may not be an unreferenced
  // authorisation at Stripe. Guessing 'expired' would let a second hold onto
  // the renter's card; guessing 'held' keeps a lie on screen. 'needs_review' is
  // exactly the state for "divergence we cannot safely resolve".
  //
  // 'failed' / 'requires_action' / 'needs_review' with no PI are already honest
  // — leave them for the placement engine.
  if (!probedPiId) {
    if (currentStatus === "held" || CLAIM_STATUSES.has(currentStatus ?? "")) {
      if (opts.dryRun) return { outcome: "needs_review", transition: `${currentStatus}->needs_review` };
      const applied = await casUpdateRental(supabase, rental.id, currentStatus, null, {
        deposit_hold_status: "needs_review",
        deposit_hold_status_changed_at: nowIso,
        deposit_hold_last_error: "No PaymentIntent recorded for a hold the database believes exists — cannot be verified at Stripe.",
      });
      if (!applied) return { outcome: "lost_race" };
      await recordLink(supabase, {
        rental_id: rental.id,
        tenant_id: rental.tenant_id,
        attempt_seq: attemptSeq,
        action: "reconcile:needs_review",
        outcome: "succeeded",
        error_message: `Reconciler: status '${currentStatus}' with no payment_intent_id`,
        completed_at: nowIso,
      });
      console.warn("[HOLD-RECONCILE] Rental", rental.id, `${currentStatus} -> needs_review (no PaymentIntent recorded)`);
      return { outcome: "needs_review", transition: `${currentStatus}->needs_review` };
    }
    return { outcome: "unchanged" };
  }

  // ── Resolve the account the hold actually lives on ──────────────────────
  const ctx = resolveStripeContext(rental, tenant);
  if (!ctx) return { outcome: "unresolvable" };

  // ── Ask Stripe ──────────────────────────────────────────────────────────
  let intent: any;
  try {
    intent = await ctx.stripe.paymentIntents.retrieve(
      probedPiId,
      // Expand the authorising charge so the real capture deadline, the
      // extended-authorization grant and the card identity all arrive in one
      // round-trip.
      { expand: ["latest_charge"] },
      ctx.stripeOptions
    );
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "resource_missing") {
      // Stripe has never heard of this id ON THIS ACCOUNT/MODE. Either the
      // anchor is wrong or the id is — this read is INCONCLUSIVE, and it is
      // exactly the case in which we must not touch the state machine.
      //
      // A row that says 'held' therefore KEEPS saying 'held'. 'needs_review' is
      // not an inert annotation: place-deposit-hold only runs its own Stripe
      // liveness probe under `if (priorHoldStatus === 'held')` (index.ts:175) —
      // and that probe deliberately treats resource_missing as ALIVE and
      // refuses. Demoting the row would delete that guard, let the next
      // placement authorise the renter's card a SECOND time while the first
      // authorisation may still be live on another account/mode, and at the same
      // time stop cancel-rental-refund (:299) / deduct-from-deposit (:158) /
      // sync-deposit-hold (:50) — all keyed on the literal 'held' — from ever
      // releasing it. That is fail-OPEN in both directions at once.
      //
      // So we record the divergence and nothing else. A human (or
      // verify-deposit-hold, which can be pointed at a different anchor) resolves
      // it while every placement path stays blocked. Only rows that are NOT
      // 'held' — stranded claim states, where no guard is being removed — are
      // moved to 'needs_review'. If 'needs_review' is ever made blocking in
      // place-deposit-hold/create-hold-checkout, the 'held' case can be revisited
      // then, not before.
      const missingDetail = `Stripe has no record of ${probedPiId} on ${ctx.connectAccountId ?? "the platform account"} (${ctx.mode}).`;
      const demote = CLAIM_STATUSES.has(currentStatus ?? "");

      if (!demote) {
        // Already recorded on a previous pass — nothing has changed, so do not
        // rewrite the same row four times a day.
        if (rental.deposit_hold_last_error_code === "resource_missing") {
          return { outcome: "inconclusive" };
        }
        if (opts.dryRun) return { outcome: "inconclusive" };
        const noted = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, {
          // NO deposit_hold_status, NO deposit_hold_status_changed_at and NO
          // deposit_hold_verified_at: nothing was verified and nothing moved.
          deposit_hold_last_error_code: "resource_missing",
          deposit_hold_last_error: missingDetail,
        });
        if (!noted) return { outcome: "lost_race" };
        await recordLink(supabase, {
          rental_id: rental.id,
          tenant_id: rental.tenant_id,
          attempt_seq: attemptSeq,
          action: "reconcile:unverifiable",
          payment_intent_id: probedPiId,
          platform_account: ctx.platformAccount,
          connect_account_id: ctx.connectAccountId,
          stripe_mode: ctx.mode,
          outcome: "failed",
          error_code: "resource_missing",
          error_message: `Reconciler: PaymentIntent not found on the record-anchored account; status '${currentStatus}' left untouched for review.`,
          completed_at: nowIso,
        });
        console.error(
          "[HOLD-RECONCILE] PaymentIntent missing on account",
          ctx.connectAccountId ?? "(platform)",
          probedPiId,
          "→ rental",
          rental.id,
          `status '${currentStatus}' LEFT AS IS (inconclusive — needs a human)`
        );
        return { outcome: "inconclusive" };
      }

      // Reachable only for a STRANDED claim state (processing/refreshing/
      // capturing) that the gate above already judged dead: no live worker owns
      // the row, and 'needs_review' is where an unresolvable divergence belongs.
      if (opts.dryRun) return { outcome: "needs_review", transition: `${currentStatus}->needs_review` };
      const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, {
        deposit_hold_status: "needs_review",
        deposit_hold_status_changed_at: nowIso,
        deposit_hold_last_error_code: "resource_missing",
        deposit_hold_last_error: missingDetail,
      });
      if (!applied) return { outcome: "lost_race" };
      await recordLink(supabase, {
        rental_id: rental.id,
        tenant_id: rental.tenant_id,
        attempt_seq: attemptSeq,
        action: "reconcile:needs_review",
        payment_intent_id: probedPiId,
        platform_account: ctx.platformAccount,
        connect_account_id: ctx.connectAccountId,
        stripe_mode: ctx.mode,
        outcome: "succeeded",
        error_code: "resource_missing",
        error_message: "Reconciler: PaymentIntent not found on the record-anchored account",
        completed_at: nowIso,
      });
      console.warn(
        "[HOLD-RECONCILE] PaymentIntent missing on account",
        ctx.connectAccountId ?? "(platform)",
        probedPiId,
        "→ rental",
        rental.id,
        `stranded claim '${currentStatus}' -> needs_review`
      );
      return { outcome: "needs_review", transition: `${currentStatus}->needs_review` };
    }
    // Network / auth / anything else is a genuine failure, not a state we can
    // reconcile. Reporting a hold as dead because Stripe was unreachable is the
    // one thing we must never do.
    throw err;
  }

  const piStatus = String(intent.status);
  const trueStatus = PI_STATUS_TO_HOLD_STATUS[piStatus] ?? null;

  if (!trueStatus) {
    // Still authorising (processing, requires_confirmation). No funds are held
    // yet, but it is not dead either.
    return { outcome: "in_flight" };
  }

  const patch: Record<string, unknown> = {};
  let changed = false;

  if (trueStatus === "held") {
    const facts = await readChargeFacts(ctx.stripe, intent, ctx.stripeOptions);

    // Expiry: ONLY when Stripe published one. Absent ⟹ excluded from the patch
    // entirely, so the stored deadline (and the rental's place in the refresh
    // window) is left exactly as it is. See principle 3.
    if (facts.captureBefore) {
      const storedMs = rental.deposit_hold_expires_at
        ? new Date(rental.deposit_hold_expires_at).getTime()
        : NaN;
      // Compare as instants, not strings: Postgres returns
      // "2026-08-16T10:00:00+00:00" while toISOString() gives
      // "2026-08-16T10:00:00.000Z", so a string compare is never equal and we
      // would write on every single run.
      const drifted = !(Math.abs(storedMs - new Date(facts.captureBefore).getTime()) < 1000);
      if (drifted || rental.deposit_hold_expiry_source !== "stripe_capture_before") {
        patch.deposit_hold_expires_at = facts.captureBefore;
        patch.deposit_hold_expiry_source = "stripe_capture_before";
        changed = true;
      }
      if (facts.windowSeconds !== null && facts.windowSeconds !== rental.deposit_hold_window_seconds) {
        patch.deposit_hold_window_seconds = facts.windowSeconds;
      }
    }

    if (facts.extendedAuth !== null && facts.extendedAuth !== rental.deposit_hold_extended_auth) {
      patch.deposit_hold_extended_auth = facts.extendedAuth;
      changed = true;
    }

    // Card identity — makes "which card is this hold on" answerable and debit
    // stacking (the main renter-harm risk on a long chain) detectable.
    if (facts.cardBrand && facts.cardBrand !== rental.deposit_hold_card_brand) patch.deposit_hold_card_brand = facts.cardBrand;
    if (facts.cardLast4 && facts.cardLast4 !== rental.deposit_hold_card_last4) patch.deposit_hold_card_last4 = facts.cardLast4;
    if (facts.cardExpMonth !== null && facts.cardExpMonth !== rental.deposit_hold_card_exp_month) patch.deposit_hold_card_exp_month = facts.cardExpMonth;
    if (facts.cardExpYear !== null && facts.cardExpYear !== rental.deposit_hold_card_exp_year) patch.deposit_hold_card_exp_year = facts.cardExpYear;
    if (facts.cardFunding && facts.cardFunding !== rental.deposit_hold_card_funding) patch.deposit_hold_card_funding = facts.cardFunding;

    // Currency of the authorisation as Stripe holds it. EC-45: currency is read
    // from the CURRENT tenant row in three places, so a UK→UAE settings flip
    // mid-rental can produce a replacement hold in a new currency on the old
    // account. Anchoring the real currency here is what lets anything downstream
    // notice.
    const piCurrency = typeof intent.currency === "string" ? intent.currency.toLowerCase() : null;
    if (piCurrency && piCurrency !== rental.deposit_hold_currency) {
      patch.deposit_hold_currency = piCurrency;
    }

    // Anchor the Stripe context we just PROVED correct — Stripe answering for
    // this PaymentIntent on this account/mode is the proof. Backfilling here
    // converts a derived context into a record-anchored one, so future
    // operations survive the tenant flipping platform.
    if (!rental.deposit_hold_connect_account_id && ctx.connectAccountId) {
      patch.deposit_hold_connect_account_id = ctx.connectAccountId;
    }
    if (!rental.deposit_hold_stripe_mode) {
      patch.deposit_hold_stripe_mode = ctx.mode;
    }

    if (currentStatus !== "held") {
      // Recovers rows stranded in 'refreshing' / 'processing' / 'capturing' /
      // 'failed' by a crash: the authorisation is demonstrably live.
      patch.deposit_hold_status = "held";
      patch.deposit_hold_status_changed_at = nowIso;
      // A live authorisation clears the failure state that was blocking retries.
      patch.deposit_hold_last_error = null;
      patch.deposit_hold_last_error_code = null;
      patch.deposit_hold_next_retry_at = null;
      // ...INCLUDING the counter. This was the one piece of failure state left
      // standing, and leaving it made this recovery path a monotone accumulator:
      // the only other writer of 0 is a successful refresh, so a
      // fail -> recover -> fail loop climbed the ladder forever. computeRetryAt
      // indexes the backoff by this count, so a row rescued at 3 waited the
      // rung-3 delay for its next ordinary hiccup, and a row rescued at 7 was one
      // transient blip (a Postgres wobble tagged db_write_failed counts) from
      // MAX_HOLD_ATTEMPTS and the needs_review dead end. The authorisation is
      // demonstrably live; the history that led here is spent.
      patch.deposit_hold_failure_count = 0;
      changed = true;
    } else if (rental.deposit_hold_last_error_code === "resource_missing") {
      // A previous pass could not find this PaymentIntent (wrong anchor, or a
      // Stripe-side blip) and recorded the ambiguity without touching the
      // status. Stripe has now answered for it, so the ambiguity is resolved —
      // clear the marker rather than leaving a permanent "needs a human" flag on
      // a demonstrably healthy hold.
      patch.deposit_hold_last_error = null;
      patch.deposit_hold_last_error_code = null;
      changed = true;
    }

    // Freshness heartbeat: always stamped on a conclusive read so an operator
    // (and the dead-man check) can tell "verified 20 minutes ago" from "nobody
    // has looked at this since it was placed".
    patch.deposit_hold_verified_at = nowIso;

    const amountCapturable = typeof intent.amount_capturable === "number" ? intent.amount_capturable : null;
    const expectedCents = rental.deposit_hold_amount != null ? Math.round(Number(rental.deposit_hold_amount) * 100) : null;
    if (amountCapturable !== null && expectedCents !== null && amountCapturable !== expectedCents) {
      console.warn(
        "[HOLD-RECONCILE] Amount drift on rental", rental.id,
        "DB", expectedCents, "cents vs Stripe capturable", amountCapturable,
        piCurrency ?? ""
      );
    }

    if (opts.dryRun) {
      return changed
        ? { outcome: "corrected", transition: `${currentStatus}->held` }
        : { outcome: "verified" };
    }

    const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, patch);
    if (!applied) return { outcome: "lost_race" };

    // ── CHAIN ENDED, MONEY STILL HELD ────────────────────────────────────────
    // We have just PROVEN this authorization is live at Stripe. If the chain
    // bound has also passed, nothing will renew it again and the engine
    // deliberately will not capture or release on its own — so without a bell
    // here the renter's funds sit ring-fenced until the network lapses them,
    // days later, with no one told.
    //
    // This is the only sweep that can raise it: the refresh driver's SQL
    // pre-filter drops the row the moment its bound passes, so the engine's own
    // `chain_expired` branch never runs from cron.
    //
    // After the CAS, so a lost race cannot ring it. Deduped per rental inside
    // the helper, and the helper never throws — a failed notification must not
    // fail a reconcile pass that has already written the truth.
    {
      const bound = resolveChainBound(rental as Record<string, unknown>, new Date(nowIso));

      // Ring on the LIVE bound, not on `bound.expired`.
      //
      // `expired` is the RE-AUTHORISING caller's question, and for a row whose
      // cache is NULL the seed deliberately floors itself at now + grace and
      // hard-codes expired:false — so that a hold placed late onto an
      // already-ended rental is not killed at its first link. Correct there,
      // fatal here: every deposit hold in production today carries a NULL cache,
      // so gating the bell on `expired` made it unable to fire at all.
      //
      // `live` is the un-floored bound implied by the rental's own end_date,
      // which is exactly the question this alert asks: has the rental finished
      // long enough ago that nothing will renew this authorisation again?
      const liveBoundMs = bound.live ? new Date(bound.live).getTime() : Number.NaN;
      const chainIsOver = Number.isFinite(liveBoundMs)
        ? liveBoundMs <= new Date(nowIso).getTime()
        : bound.expired;

      if (chainIsOver) {
        await notifyDepositHoldChainEnded({
          tenantId: rental.tenant_id,
          rentalId: rental.id,
          amount: rental.deposit_hold_amount != null ? Number(rental.deposit_hold_amount) : null,
          currency: piCurrency ?? rental.deposit_hold_currency,
          expiresAt: facts.captureBefore ?? rental.deposit_hold_expires_at,
          chainEndedAt: bound.live ?? bound.effective,
          source: "reconciler",
        });
      }
    }

    if (changed) {
      await recordLink(supabase, {
        rental_id: rental.id,
        tenant_id: rental.tenant_id,
        attempt_seq: attemptSeq,
        action: "reconcile:held",
        payment_intent_id: probedPiId,
        platform_account: ctx.platformAccount,
        connect_account_id: ctx.connectAccountId,
        stripe_mode: ctx.mode,
        amount_cents: amountCapturable,
        currency: piCurrency,
        capture_before: facts.captureBefore,
        extended_auth_status: facts.extendedAuthStatus,
        card_funding: facts.cardFunding,
        outcome: "succeeded",
        error_message: currentStatus === "held" ? "Reconciler refreshed hold facts from Stripe" : `Reconciler recovered ${currentStatus} -> held`,
        completed_at: nowIso,
      });
      console.log(
        "[HOLD-RECONCILE] Rental", rental.id,
        currentStatus, "-> held; expires",
        facts.captureBefore ?? "(unchanged — Stripe published no deadline)"
      );
      return { outcome: "corrected", transition: `${currentStatus}->held` };
    }
    return { outcome: "verified" };
  }

  // ── Conclusively not a live hold ────────────────────────────────────────

  // A cancelled PaymentIntent is not always a network expiry.
  // release-deposit-hold cancels the PI and then writes 'released' with a bare
  // update whose error it discards, so a failed release write leaves a row this
  // function would otherwise label 'expired' — an operator-initiated release
  // recorded as a silent network expiry. Both are terminal and the renter's
  // funds are back either way, so no money is at risk; only the audit trail is
  // wrong about a deliberate staff action. Stripe reports 'automatic' for a
  // network expiry and 'requested_by_customer' for an API cancel, and
  // deposit_hold_release_requested_at is positive evidence that a human asked.
  // We deliberately do NOT read 'abandoned' as a release: that is the reason
  // THIS function and the refresh engine pass when cancelling, so it means the
  // opposite.
  let resolvedStatus = trueStatus;
  if (trueStatus === "expired") {
    const cancellationReason = typeof intent.cancellation_reason === "string" ? intent.cancellation_reason : null;
    if (rental.deposit_hold_release_requested_at || cancellationReason === "requested_by_customer") {
      resolvedStatus = "released";
    }
  }

  if (currentStatus === resolvedStatus) {
    // Already correct. Still stamp the heartbeat so silence is not mistaken for
    // "never checked".
    if (opts.dryRun) return { outcome: "unchanged" };
    await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, {
      deposit_hold_verified_at: nowIso,
    });
    return { outcome: "unchanged" };
  }

  patch.deposit_hold_status = resolvedStatus;
  patch.deposit_hold_status_changed_at = nowIso;
  patch.deposit_hold_verified_at = nowIso;

  if (resolvedStatus === "expired" || resolvedStatus === "released") {
    // Stripe CONFIRMS the authorisation is gone and the funds are back with the
    // renter. This is the write that ends GMT's dead end: the placement paths
    // stop short-circuiting on "a hold is already active" and the operator can
    // re-collect.
    const lastError = intent.last_payment_error?.message ?? null;
    if (lastError) patch.deposit_hold_last_error = lastError;
  } else if (resolvedStatus === "failed") {
    // requires_payment_method: the card is gone or was declined. Hand it back
    // to the placement engine with a retry time rather than leaving it inert.
    patch.deposit_hold_next_retry_at = new Date(Date.now() + FAILED_RETRY_DELAY_MS).toISOString();
    patch.deposit_hold_last_error = intent.last_payment_error?.message ?? "Stripe reports the PaymentIntent needs a new payment method.";
    patch.deposit_hold_last_error_code = intent.last_payment_error?.code ?? intent.last_payment_error?.decline_code ?? null;
  }
  // resolvedStatus === 'captured' deliberately gets NO extra rental fields.
  //
  // DO NOT INSERT A payments ROW HERE (EC-23). Backfilling `payments` keyed on a
  // deposit-hold PaymentIntent arms the rental-cancellation path on every rental
  // it touches — including ones whose PI is still cancellable. Payments rows are
  // written exclusively by capture-deposit-hold, which is also the only thing
  // that knows the captured amount. There is no deposit_hold_captured_at column;
  // deposit_hold_status_changed_at above carries the timestamp.
  //
  // Because there is no payments row, the ledger link below is the ONLY place
  // the captured figure exists, so it must carry amount_cents — otherwise an
  // operator sees a rental marked 'captured' with no payment and no number to
  // reconcile against.
  const capturedCents =
    resolvedStatus === "captured" && typeof intent.amount_received === "number" ? intent.amount_received : null;

  if (opts.dryRun) return { outcome: "corrected", transition: `${currentStatus}->${resolvedStatus}` };

  const applied = await casUpdateRental(supabase, rental.id, currentStatus, probedPiId, patch);
  if (!applied) return { outcome: "lost_race" };

  await recordLink(supabase, {
    rental_id: rental.id,
    tenant_id: rental.tenant_id,
    attempt_seq: attemptSeq,
    action: `reconcile:${resolvedStatus}`,
    payment_intent_id: probedPiId,
    platform_account: ctx.platformAccount,
    connect_account_id: ctx.connectAccountId,
    stripe_mode: ctx.mode,
    amount_cents: capturedCents,
    currency: typeof intent.currency === "string" ? intent.currency.toLowerCase() : null,
    outcome: "succeeded",
    error_code: (patch.deposit_hold_last_error_code as string | null) ?? null,
    error_message: `Reconciler: Stripe reports ${piStatus}; ${currentStatus} -> ${resolvedStatus}`,
    completed_at: nowIso,
  });

  if (resolvedStatus === "captured") {
    // An operational signal, not a warning line: money left the renter's card
    // through a path that did not finish writing itself down.
    console.error(
      "[HOLD-RECONCILE] Rental", rental.id,
      "was stranded in", currentStatus, "but Stripe reports the deposit CAPTURED —",
      capturedCents !== null ? `${capturedCents} ${String(intent.currency ?? "").toLowerCase()}` : "amount unavailable",
      "(PI", probedPiId + "). No payments row is written by design; reconcile manually."
    );
  } else {
    console.warn(
      "[HOLD-RECONCILE] Stale hold corrected on rental", rental.id,
      `${currentStatus} -> ${resolvedStatus}`,
      "(Stripe PI", probedPiId, "is", piStatus + ")"
    );
  }
  return { outcome: "corrected", transition: `${currentStatus}->${resolvedStatus}` };
}

// ---------------------------------------------------------------------------
// Orphan sweep
// ---------------------------------------------------------------------------

/** Cancel a PaymentIntent, tolerating the "already dead" race. */
async function cancelIntent(
  ctx: StripeContext,
  paymentIntentId: string
): Promise<{ cancelled: boolean; note: string; code: string | null }> {
  try {
    await ctx.stripe.paymentIntents.cancel(
      paymentIntentId,
      { cancellation_reason: "abandoned" },
      ctx.stripeOptions
    );
    return { cancelled: true, note: "cancelled", code: null };
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "payment_intent_unexpected_state" || code === "resource_missing") {
      return { cancelled: false, note: `already resolved at Stripe (${code})`, code };
    }
    throw err;
  }
}

/**
 * Close a ledger row, reporting whether the write actually landed.
 *
 * supabase-js RESOLVES on a failed statement rather than throwing, so a bare
 * `await supabase.from(...).update(...)` followed by `summary.linksResolved++`
 * reports a failure as a resolution — bookkeeping that lies in the direction of
 * "nothing to see here". Returns false both when the write errored and when the
 * CAS on outcome='pending' matched nothing (someone else closed it first).
 */
async function closeLink(
  supabase: SupabaseClient,
  linkId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("deposit_hold_links")
    .update(patch)
    .eq("id", linkId)
    .eq("outcome", "pending")
    .select("id");
  if (error) {
    console.error("[HOLD-RECONCILE] Could not close ledger link", linkId, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Two classes of orphaned authorisation, both of which hold a renter's money
 * with nothing in the product pointing at it:
 *
 *  A) A deposit_hold_links row still 'pending' an hour after it was written.
 *     The ledger row is written BEFORE the Stripe call precisely so a writer
 *     that dies between "Stripe authorised" and "the DB recorded it" is still
 *     discoverable. If that PaymentIntent is live and is NOT the rental's
 *     current hold, it is money held twice on one card.
 *
 *  B) A superseded PaymentIntent that is still requires_capture. The refresh
 *     engine cancels the incumbent before/while placing the replacement; if
 *     that cancel failed the renter is carrying both. Keyset-paginated over the
 *     whole lookback window, oldest first, with confirmed-dead ids marked in the
 *     ledger so the backlog actually drains instead of the newest page being
 *     re-read forever.
 *
 * Never cancels the rental's CURRENT deposit_hold_payment_intent_id. That check
 * is the difference between releasing a duplicate and destroying the live hold —
 * which is why loadRental/loadTenant THROW instead of returning undefined: a
 * discarded read error would walk straight past the guard and cancel a live
 * authorisation on the strength of a database that did not answer.
 */
async function sweepOrphans(
  supabase: SupabaseClient,
  tenantCache: Map<string, TenantRow>,
  summary: Summary,
  opts: { dryRun: boolean; tenantId: string | null; onlyRentalId: string | null; deadline: number }
): Promise<void> {
  // BOTH loaders THROW rather than returning undefined, and both callers below
  // are inside a try/catch that records the failure in summary.errors and moves
  // on. This is load-bearing, not defensive style:
  //
  // These sweeps CANCEL live PaymentIntents. The only thing standing between
  // "released a duplicate" and "destroyed the renter's live 90-day hold" is the
  // comparison against rentals.deposit_hold_payment_intent_id. If the rental
  // read silently returns undefined on a transient PostgREST failure, that
  // comparison is false and the cancel proceeds — the row keeps saying 'held' on
  // a PaymentIntent we just killed, and the operator is uncovered until the next
  // pass flips it to 'expired'.
  //
  // A NULL result is an error too, not an absence: deposit_hold_links.rental_id
  // and .tenant_id are both `REFERENCES ... ON DELETE CASCADE`, so a link row can
  // never outlive its rental or its tenant. "No rental points at this PI" is
  // therefore never a conclusion we can draw from a missing row.
  const loadTenant = async (tenantId: string): Promise<TenantRow> => {
    const cached = tenantCache.get(tenantId);
    if (cached) return cached;
    const { data, error } = await supabase
      .from("tenants")
      .select(`id, ${TENANT_STRIPE_COLUMNS}`)
      .eq("id", tenantId)
      .maybeSingle();
    if (error) throw new Error(`Could not read tenant ${tenantId}: ${error.message}`);
    if (!data) throw new Error(`Tenant ${tenantId} not readable (FK is ON DELETE CASCADE, so this is an incomplete read, not a deleted tenant)`);
    const tenant = data as unknown as TenantRow;
    tenantCache.set(tenantId, tenant);
    return tenant;
  };

  const loadRental = async (rentalId: string): Promise<RentalRow> => {
    const { data, error } = await supabase
      .from("rentals")
      .select(RENTAL_COLUMNS)
      .eq("id", rentalId)
      .maybeSingle();
    if (error) throw new Error(`Could not read rental ${rentalId}: ${error.message}`);
    if (!data) throw new Error(`Rental ${rentalId} not readable (FK is ON DELETE CASCADE, so this is an incomplete read, not a deleted rental) — refusing to draw any conclusion about its PaymentIntents`);
    return data as unknown as RentalRow;
  };

  // ── A) stale pending links ──────────────────────────────────────────────
  {
    let query = supabase
      .from("deposit_hold_links")
      .select(LINK_COLUMNS)
      .eq("outcome", "pending")
      .lt("created_at", new Date(Date.now() - PENDING_LINK_STALE_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(ORPHAN_LINK_LIMIT);
    if (opts.tenantId) query = query.eq("tenant_id", opts.tenantId);
    if (opts.onlyRentalId) query = query.eq("rental_id", opts.onlyRentalId);

    const { data: links, error } = await query;
    if (error) {
      summary.errors.push(`pending-link sweep: ${error.message}`);
    } else {
      for (const link of (links ?? []) as LinkRow[]) {
        if (Date.now() > opts.deadline) {
          summary.truncated = true;
          break;
        }
        try {
          if (!link.payment_intent_id) {
            // Nothing to check at Stripe. Leave it pending — never guess —
            // until past Stripe's 24h idempotency window, after which the
            // writer is definitively dead and only the LEDGER row is closed.
            // Any authorisation it might have created is caught by the
            // rental-level pass above, which reads Stripe for every
            // non-terminal row.
            const ageMs = Date.now() - new Date(link.created_at).getTime();
            if (ageMs > UNLINKED_LINK_GIVEUP_MS && !opts.dryRun) {
              const closed = await closeLink(supabase, link.id, {
                outcome: "failed",
                completed_at: new Date().toISOString(),
                error_message: "Reconciler: writer died before a PaymentIntent id was recorded; nothing to verify at Stripe.",
              });
              if (closed) summary.linksResolved++;
            } else {
              console.warn("[HOLD-RECONCILE] Pending link with no PaymentIntent id:", link.id, "rental", link.rental_id);
            }
            continue;
          }

          const rental = await loadRental(link.rental_id);
          const tenant = await loadTenant(link.tenant_id);
          const ctx = resolveLinkContext(link, rental, tenant);
          if (!ctx) {
            summary.unresolvableContext++;
            continue;
          }

          let intent: any;
          try {
            intent = await ctx.stripe.paymentIntents.retrieve(link.payment_intent_id, ctx.stripeOptions);
          } catch (err: any) {
            const code = err?.code ?? err?.raw?.code;
            if (code === "resource_missing") {
              // The id never became a real PaymentIntent on this account. Close
              // the ledger row; no money is involved.
              if (!opts.dryRun) {
                const closed = await closeLink(supabase, link.id, {
                  outcome: "failed",
                  completed_at: new Date().toISOString(),
                  error_code: "resource_missing",
                  error_message: "Reconciler: PaymentIntent not found on the recorded account.",
                });
                if (closed) summary.linksResolved++;
              }
              continue;
            }
            throw err;
          }

          const piStatus = String(intent.status);
          // `rental` is guaranteed to be a positively-loaded row here: loadRental
          // throws on a read error or a missing row rather than returning
          // undefined, so this comparison can never be false merely because the
          // database did not answer.
          const isCurrentHold = rental.deposit_hold_payment_intent_id === link.payment_intent_id;

          if (piStatus === "requires_capture") {
            if (isCurrentHold) {
              // Not an orphan at all: the writer authorised successfully and
              // died before closing its own ledger row. Record the truth.
              if (!opts.dryRun) {
                const closed = await closeLink(supabase, link.id, {
                  outcome: "succeeded",
                  completed_at: new Date().toISOString(),
                  error_message: "Reconciler: authorisation is live and is this rental's current hold.",
                });
                if (closed) summary.linksResolved++;
              }
              continue;
            }

            // A live authorisation on the renter's card that no rental points
            // at. Release it.
            if (opts.dryRun) {
              summary.orphansCancelled++;
              console.warn("[HOLD-RECONCILE] (dry run) would cancel orphan", link.payment_intent_id, "rental", link.rental_id);
              continue;
            }
            const { cancelled, note } = await cancelIntent(ctx, link.payment_intent_id);
            const closed = await closeLink(supabase, link.id, {
              outcome: "orphaned",
              completed_at: new Date().toISOString(),
              error_message: `Reconciler: orphaned authorisation ${note}; no rental referenced it.`,
            });
            if (closed) summary.linksResolved++;
            if (cancelled) {
              summary.orphansCancelled++;
              await recordLink(supabase, {
                rental_id: link.rental_id,
                tenant_id: link.tenant_id,
                attempt_seq: link.attempt_seq,
                action: ORPHAN_CANCEL_ACTION,
                superseded_pi_id: link.payment_intent_id,
                platform_account: link.platform_account,
                connect_account_id: ctx.connectAccountId,
                stripe_mode: ctx.mode,
                outcome: "succeeded",
                error_message: "Reconciler cancelled an orphaned authorisation from a crashed writer.",
                completed_at: new Date().toISOString(),
              });
              console.warn("[HOLD-RECONCILE] Cancelled orphaned authorisation", link.payment_intent_id, "(rental", link.rental_id + ")");
            }
            continue;
          }

          // Any other status is already resolved at Stripe; just close the row.
          if (!opts.dryRun) {
            const closed = await closeLink(supabase, link.id, {
              outcome: piStatus === "succeeded" ? "succeeded" : "failed",
              completed_at: new Date().toISOString(),
              error_message: `Reconciler: Stripe reports ${piStatus}.`,
            });
            if (closed) summary.linksResolved++;
          }
        } catch (err: any) {
          summary.errors.push(`link ${link.id}: ${err?.message ?? err}`);
          console.error("[HOLD-RECONCILE] Pending-link sweep failed for link", link.id, err);
        }
      }
    }
  }

  // ── B) superseded PaymentIntents that are still live ────────────────────
  //
  // This sweep is KEYSET-PAGINATED over the whole lookback window, oldest first,
  // and remembers what it has already checked. The obvious shape — `order
  // created_at DESC .limit(40)` with nothing written back — re-examines the same
  // newest 40 links on every run and never looks at anything older, so the
  // moment a fleet accumulates more than 40 superseded links inside the window
  // the tail is unreachable forever. The orphans that matter are precisely the
  // OLD ones: a cancel that failed weeks ago and is still holding a renter's
  // funds. The sweep would report success while never fixing the failure it
  // exists to fix.
  //
  // "Already checked" is recorded as a ledger row (SUPERSEDED_CLEAR_ACTION /
  // ORPHAN_CANCEL_ACTION carrying the same superseded_pi_id) rather than a new
  // column, because the schema is applied and this workstream writes no DDL.
  // Those marker rows carry superseded_pi_id themselves, so they are excluded
  // from the candidate query by action — otherwise the sweep would rediscover
  // its own bookkeeping as work.
  {
    // Its own floor, so a long pending-link sweep cannot starve it: they used to
    // share one deadline and whichever ran second always lost.
    const sweepDeadline = Math.max(opts.deadline, Date.now() + SUPERSEDED_SWEEP_RESERVE_MS);
    const lookbackIso = new Date(Date.now() - SUPERSEDED_LOOKBACK_MS).toISOString();

    // Keyset cursor on created_at. Paged with `.gte` plus a seen-set rather than
    // `.gt` so rows sharing a timestamp (a batched insert takes one transaction
    // clock) can never be skipped; `strictAdvance` steps past a timestamp only
    // when a whole page was already seen, which is the only way this could loop.
    let cursor: string | null = null;
    let strictAdvance = false;
    let drained = false;
    const seen = new Set<string>();

    while (!drained) {
      if (Date.now() > sweepDeadline) {
        summary.truncated = true;
        break;
      }

      let query = supabase
        .from("deposit_hold_links")
        .select(LINK_COLUMNS)
        .not("superseded_pi_id", "is", null)
        .not("action", "in", `("${ORPHAN_CANCEL_ACTION}","${SUPERSEDED_CLEAR_ACTION}")`)
        .gt("created_at", lookbackIso)
        .order("created_at", { ascending: true })
        .limit(SUPERSEDED_PAGE_SIZE);
      if (cursor) query = strictAdvance ? query.gt("created_at", cursor) : query.gte("created_at", cursor);
      if (opts.tenantId) query = query.eq("tenant_id", opts.tenantId);
      if (opts.onlyRentalId) query = query.eq("rental_id", opts.onlyRentalId);

      const { data, error } = await query;
      if (error) {
        summary.errors.push(`superseded sweep: ${error.message}`);
        break;
      }

      const page = (data ?? []) as unknown as LinkRow[];
      if (page.length === 0) break;
      if (page.length < SUPERSEDED_PAGE_SIZE) drained = true;

      const fresh = page.filter((l) => !seen.has(l.id));
      cursor = page[page.length - 1].created_at;
      strictAdvance = fresh.length === 0;
      for (const l of fresh) seen.add(l.id);
      if (fresh.length === 0) continue;

      // Which of these superseded ids has a previous run already resolved? One
      // small query per page. On error we simply re-check: a redundant Stripe
      // read is harmless (a PaymentIntent we already cancelled answers
      // 'already resolved'), whereas skipping on a failed read would be the
      // fail-open direction.
      const checked = new Set<string>();
      const candidateIds = [...new Set(fresh.map((l) => l.superseded_pi_id).filter((v): v is string => !!v))];
      if (candidateIds.length > 0) {
        const { data: markers, error: markerError } = await supabase
          .from("deposit_hold_links")
          .select("superseded_pi_id")
          .in("action", SWEEP_MARKER_ACTIONS)
          .in("superseded_pi_id", candidateIds);
        if (markerError) {
          console.warn("[HOLD-RECONCILE] Could not read sweep markers (re-checking this page):", markerError.message);
        } else {
          for (const m of (markers ?? []) as { superseded_pi_id: string | null }[]) {
            if (m.superseded_pi_id) checked.add(m.superseded_pi_id);
          }
        }
      }

      for (const link of fresh) {
        if (Date.now() > sweepDeadline) {
          summary.truncated = true;
          drained = true;
          break;
        }
        const supersededId = link.superseded_pi_id!;
        if (checked.has(supersededId)) {
          summary.supersededAlreadyChecked++;
          continue;
        }

        try {
          summary.supersededExamined++;

          // `rental` is a positively-loaded row — loadRental throws rather than
          // returning undefined — so this guard cannot be walked past by a
          // transient read failure. It is the difference between releasing a
          // duplicate and destroying the rental's live hold.
          const rental = await loadRental(link.rental_id);
          if (rental.deposit_hold_payment_intent_id === supersededId) continue;

          const tenant = await loadTenant(link.tenant_id);
          const ctx = resolveLinkContext(link, rental, tenant);
          if (!ctx) {
            summary.unresolvableContext++;
            continue;
          }

          let intent: any;
          try {
            intent = await ctx.stripe.paymentIntents.retrieve(supersededId, ctx.stripeOptions);
          } catch (err: any) {
            const code = err?.code ?? err?.raw?.code;
            if (code === "resource_missing") {
              // Deliberately NOT marked as checked: "Stripe has no record of it
              // on THIS account" is the same signature as a wrong anchor, and
              // marking would mean never looking again at a PaymentIntent that
              // might be holding a renter's funds somewhere else. Cheap to
              // re-read next run.
              continue;
            }
            throw err;
          }

          const supersededStatus = String(intent.status);
          if (supersededStatus !== "requires_capture") {
            // Terminal at Stripe (canceled/succeeded) — record that so the row
            // drops out of the candidate set. Anything still in motion
            // (processing, requires_confirmation, requires_action,
            // requires_payment_method) could yet become requires_capture, so it
            // is deliberately NOT marked.
            if (!opts.dryRun && (supersededStatus === "canceled" || supersededStatus === "succeeded")) {
              await recordSupersededChecked(supabase, link, ctx, supersededId, `Stripe reports ${supersededStatus}`);
            }
            continue;
          }

          if (opts.dryRun) {
            summary.supersededCancelled++;
            console.warn("[HOLD-RECONCILE] (dry run) would cancel superseded", supersededId, "rental", link.rental_id);
            continue;
          }

          const { cancelled, note, code } = await cancelIntent(ctx, supersededId);
          if (cancelled) {
            summary.supersededCancelled++;
            await recordLink(supabase, {
              rental_id: link.rental_id,
              tenant_id: link.tenant_id,
              attempt_seq: link.attempt_seq,
              action: ORPHAN_CANCEL_ACTION,
              superseded_pi_id: supersededId,
              platform_account: link.platform_account,
              connect_account_id: ctx.connectAccountId,
              stripe_mode: ctx.mode,
              amount_cents: typeof intent.amount_capturable === "number" ? intent.amount_capturable : null,
              currency: typeof intent.currency === "string" ? intent.currency.toLowerCase() : null,
              outcome: "succeeded",
              error_message: "Reconciler cancelled a superseded authorisation that was still holding funds.",
              completed_at: new Date().toISOString(),
            });
            console.warn(
              "[HOLD-RECONCILE] Cancelled superseded authorisation still holding funds:",
              supersededId, "(rental", link.rental_id + ")"
            );
          } else {
            console.log("[HOLD-RECONCILE] Superseded PI", supersededId, note);
            // 'payment_intent_unexpected_state' means it is no longer
            // cancellable, i.e. terminal — safe to stop checking. A
            // 'resource_missing' here gets the same treatment as above: no mark.
            if (code === "payment_intent_unexpected_state") {
              await recordSupersededChecked(supabase, link, ctx, supersededId, note);
            }
          }
        } catch (err: any) {
          summary.errors.push(`superseded ${supersededId}: ${err?.message ?? err}`);
          console.error("[HOLD-RECONCILE] Superseded sweep failed for", supersededId, err);
        }
      }
    }
  }
}

/**
 * Mark a superseded PaymentIntent as conclusively non-live so later runs stop
 * paying for the same Stripe read. Written only when Stripe's answer is
 * terminal — never for an id Stripe merely could not find on this account.
 *
 * Collides (and is swallowed) if this rental+attempt_seq already carries a
 * marker; the pagination above is what guarantees progress regardless, so a lost
 * marker costs one redundant read per run, not correctness.
 */
async function recordSupersededChecked(
  supabase: SupabaseClient,
  link: LinkRow,
  ctx: StripeContext,
  supersededId: string,
  detail: string
): Promise<void> {
  await recordLink(supabase, {
    rental_id: link.rental_id,
    tenant_id: link.tenant_id,
    attempt_seq: link.attempt_seq,
    action: SUPERSEDED_CLEAR_ACTION,
    superseded_pi_id: supersededId,
    platform_account: link.platform_account,
    connect_account_id: ctx.connectAccountId,
    stripe_mode: ctx.mode,
    outcome: "succeeded",
    error_message: `Reconciler: superseded authorisation confirmed non-live (${detail}); no funds outstanding.`,
    completed_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Before the body is read and before the cron_runs heartbeat: an unauthorised
  // caller must not be able to write heartbeat rows either.
  if (!(await isAuthorizedCaller(req, supabase))) {
    console.warn("[HOLD-RECONCILE] Unauthorized call rejected");
    return errorResponse("Unauthorized", 401);
  }

  let onlyRentalId: string | null = null;
  let tenantId: string | null = null;
  let dryRun = false;
  try {
    const body = await req.json();
    onlyRentalId = typeof body?.only_rental_id === "string" && body.only_rental_id ? body.only_rental_id : null;
    tenantId = typeof body?.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
    dryRun = body?.dry_run === true;
  } catch {
    // No/invalid body — a normal cron tick.
  }

  // A scoped or dry run is NOT the 6-hourly job. Recording it under the same
  // job_name would satisfy a dead-man alert ("max(finished_at) < now() - 2x
  // interval") that the real schedule was failing — the exact class of silent
  // health signal cron_runs exists to remove.
  const scoped = !!(onlyRentalId || tenantId);
  const jobName = JOB_NAME + (dryRun ? ":dry-run" : "") + (scoped ? ":scoped" : "");

  const startedAt = new Date();
  const deadline = startedAt.getTime() + MAX_RUN_MS;

  const { data: runRow, error: runInsertError } = await supabase
    .from("cron_runs")
    .insert({ job_name: jobName, started_at: startedAt.toISOString() })
    .select("id")
    .maybeSingle();
  if (runInsertError) {
    // A dead-man check reads max(finished_at); with no heartbeat row this run is
    // indistinguishable from a schedule that never fired. Say so out loud rather
    // than letting the missing row be the only evidence.
    console.error("[HOLD-RECONCILE] Could not write cron_runs heartbeat — this run will look like a MISSED run to any dead-man check:", runInsertError.message);
  }
  const runId = (runRow as { id?: string } | null)?.id ?? null;

  const summary: Summary = {
    examined: 0,
    corrected: 0,
    verified: 0,
    inFlight: 0,
    claimsSkippedActive: 0,
    needsReview: 0,
    inconclusive: 0,
    unresolvableContext: 0,
    lostRace: 0,
    failed: 0,
    truncated: false,
    orphansCancelled: 0,
    linksResolved: 0,
    supersededCancelled: 0,
    supersededExamined: 0,
    supersededAlreadyChecked: 0,
    transitions: {},
    errors: [],
  };

  // Declared before `finish` closes over it: a fatal thrown by the count query
  // itself would otherwise hit the temporal dead zone and mask the real error.
  let totalDue = 0;

  const finish = async (fatal?: string) => {
    if (runId) {
      const { error: finishError } = await supabase
        .from("cron_runs")
        .update({
          finished_at: new Date().toISOString(),
          total_due: totalDue,
          processed: summary.examined,
          succeeded: summary.corrected + summary.verified,
          failed: summary.failed,
          truncated: summary.truncated,
          error: fatal ?? (summary.errors.length ? summary.errors.slice(0, 10).join(" | ") : null),
        })
        .eq("id", runId);
      if (finishError) {
        console.error("[HOLD-RECONCILE] Could not close cron_runs heartbeat", runId, "— a dead-man check will read this as an unfinished run:", finishError.message);
      }
    }
  };

  try {
    // Count the whole backlog separately from what we process, so
    // cron_runs.total_due > processed is a visible, alertable signal rather
    // than an arbitrary silent truncation (EC-20).
    {
      let countQuery = supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .in("deposit_hold_status", NON_TERMINAL_HOLD_STATUSES);
      if (tenantId) countQuery = countQuery.eq("tenant_id", tenantId);
      if (onlyRentalId) countQuery = countQuery.eq("id", onlyRentalId);
      const { count } = await countQuery;
      totalDue = count ?? 0;
    }

    console.log(
      `[HOLD-RECONCILE] Starting ${jobName} — ${totalDue} non-terminal hold(s)` +
      (scoped ? ` (scoped tenant=${tenantId ?? "-"} rental=${onlyRentalId ?? "-"})` : "")
    );

    const tenantCache = new Map<string, TenantRow>();

    // Keyset pagination on id. Deliberately NOT offset paging: this pass writes
    // terminal statuses that REMOVE rows from the very filter it is paging over,
    // so every offset page would skip exactly as many rows as it corrected.
    let cursor: string | null = null;
    let drained = false;

    while (!drained && summary.examined < MAX_RENTALS) {
      if (Date.now() > deadline) {
        summary.truncated = true;
        break;
      }

      let pageQuery = supabase
        .from("rentals")
        .select(RENTAL_COLUMNS)
        .in("deposit_hold_status", NON_TERMINAL_HOLD_STATUSES)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) pageQuery = pageQuery.gt("id", cursor);
      if (tenantId) pageQuery = pageQuery.eq("tenant_id", tenantId);
      if (onlyRentalId) pageQuery = pageQuery.eq("id", onlyRentalId);

      const { data: page, error: pageError } = await pageQuery;
      if (pageError) throw new Error(`Failed to query rentals: ${pageError.message}`);

      const rentals = (page ?? []) as unknown as RentalRow[];
      if (rentals.length === 0) {
        drained = true;
        break;
      }
      if (rentals.length < PAGE_SIZE) drained = true;
      cursor = rentals[rentals.length - 1].id;

      // Tenants for this page, one query.
      const missingTenantIds = [...new Set(rentals.map((r) => r.tenant_id))].filter((id) => !tenantCache.has(id));
      if (missingTenantIds.length > 0) {
        const { data: tenants } = await supabase
          .from("tenants")
          .select(`id, ${TENANT_STRIPE_COLUMNS}`)
          .in("id", missingTenantIds);
        for (const t of (tenants ?? []) as unknown as TenantRow[]) tenantCache.set(t.id, t);
      }

      // Liveness signal for claim states: a ledger row written for this rental
      // in the last 30 minutes means a writer is actively mid-flight, which is
      // stronger evidence than deposit_hold_status_changed_at (NULL on every
      // legacy row). One query per page, not per rental.
      const claimRentalIds = rentals.filter((r) => CLAIM_STATUSES.has(r.deposit_hold_status ?? "")).map((r) => r.id);
      const activeClaimIds = new Set<string>();
      if (claimRentalIds.length > 0) {
        const { data: recentLinks } = await supabase
          .from("deposit_hold_links")
          .select("rental_id")
          .in("rental_id", claimRentalIds)
          .gt("created_at", new Date(Date.now() - STUCK_CLAIM_MS).toISOString());
        for (const l of (recentLinks ?? []) as { rental_id: string }[]) activeClaimIds.add(l.rental_id);
      }

      for (let i = 0; i < rentals.length; i += CONCURRENCY) {
        if (Date.now() > deadline) {
          summary.truncated = true;
          break;
        }
        const chunk = rentals.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          // Explicit return type: without it the catch below narrows the union to
          // `{ outcome: "failed" }` and `result.transition` stops type-checking,
          // which `deno check` rejects at deploy time.
          chunk.map(async (rental): Promise<{ outcome: RentalOutcome; transition?: string }> => {
            try {
              return await reconcileRental(supabase, rental, tenantCache.get(rental.tenant_id), {
                dryRun,
                activeClaim: activeClaimIds.has(rental.id),
              });
            } catch (err: any) {
              // One rental's failure must never stop the others — the next row
              // may be the one whose authorisation actually died.
              const message = err?.message ?? String(err);
              console.error("[HOLD-RECONCILE] Failed for rental", rental.id, message);
              summary.errors.push(`${rental.id}: ${message}`);
              return { outcome: "failed" as const };
            }
          })
        );

        for (const result of results) {
          summary.examined++;
          switch (result.outcome) {
            case "corrected":
              summary.corrected++;
              break;
            case "verified":
              summary.verified++;
              break;
            case "in_flight":
              summary.inFlight++;
              break;
            case "claim_active":
              summary.claimsSkippedActive++;
              break;
            case "needs_review":
              summary.needsReview++;
              break;
            case "inconclusive":
              summary.inconclusive++;
              break;
            case "unresolvable":
              summary.unresolvableContext++;
              break;
            case "lost_race":
              summary.lostRace++;
              break;
            case "failed":
              summary.failed++;
              break;
            case "unchanged":
            default:
              break;
          }
          if (result.transition) {
            summary.transitions[result.transition] = (summary.transitions[result.transition] ?? 0) + 1;
          }
        }
      }
    }

    // Truncation is "we stopped before the query was exhausted" — the wall-clock
    // deadline or MAX_RENTALS. Deliberately NOT `examined < totalDue`: rows
    // legitimately leave the non-terminal set mid-run (a release, a capture, our
    // own corrections), so that comparison would cry wolf on a healthy pass and
    // the alert would be ignored exactly when it mattered.
    if (!drained) summary.truncated = true;

    // Orphan sweeps run after the rental pass so "is this the rental's current
    // hold?" is asked against a DB that has already been corrected.
    //
    // They get their own small reserve on top of the main deadline. Without it a
    // rental pass that used the whole budget would starve the sweep on EVERY
    // run, and the sweep is the only thing that releases a renter's
    // double-authorised funds — the failure it exists to fix would become
    // permanent precisely when the system is busiest. Still far inside the
    // isolate's 400s wall clock.
    //
    // This is the PENDING-LINK sweep's floor; the superseded sweep raises it
    // again by SUPERSEDED_SWEEP_RESERVE_MS internally, because it paginates the
    // whole lookback window and would otherwise inherit an already-exhausted
    // budget from the sweep that runs before it.
    const sweepDeadline = Math.max(deadline, Date.now() + ORPHAN_SWEEP_RESERVE_MS);
    await sweepOrphans(supabase, tenantCache, summary, { dryRun, tenantId, onlyRentalId, deadline: sweepDeadline });

    console.log(
      `[HOLD-RECONCILE] Complete. examined=${summary.examined}/${totalDue} corrected=${summary.corrected} ` +
      `verified=${summary.verified} needsReview=${summary.needsReview} inconclusive=${summary.inconclusive} ` +
      `inFlight=${summary.inFlight} claimsActive=${summary.claimsSkippedActive} lostRace=${summary.lostRace} ` +
      `failed=${summary.failed} orphansCancelled=${summary.orphansCancelled} ` +
      `superseded(examined=${summary.supersededExamined} alreadyChecked=${summary.supersededAlreadyChecked} ` +
      `cancelled=${summary.supersededCancelled}) truncated=${summary.truncated}`
    );

    await finish();

    return jsonResponse({
      success: true,
      job: jobName,
      dryRun,
      totalDue,
      ...summary,
      errors: summary.errors.slice(0, 25),
    });
  } catch (error: any) {
    console.error("[HOLD-RECONCILE] Fatal error:", error);
    await finish(error?.message ?? String(error));
    return errorResponse(error?.message ?? "Reconciliation failed", 500);
  }
});
