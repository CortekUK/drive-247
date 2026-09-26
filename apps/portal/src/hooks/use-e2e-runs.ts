"use client";

/**
 * The live test runner's data, for the `/dev` section
 * (`components/dev/e2e-live-runner.tsx`; contract in
 * `components/dev/e2e-runner-contract.ts`).
 *
 * WHY THIS IS NOT REACT QUERY. The `/dev` page is mounted by its gate test
 * with no QueryClientProvider, and a `useQuery` here would throw there on the
 * canary. Everything below is a small effect with its own cancellation instead,
 * which also makes the polling explicit: a set of runs, one timer, stopped
 * when every run is finished, on unmount, or after `maxWatchMs`.
 *
 * WHAT IT READS AND WRITES. From the browser: reads only — a GET and a
 * `list` to the `e2e-runner` function, SELECTs on `dev_sim_runs` /
 * `dev_sim_run_steps` for the open tenant, and a rental's number for the
 * Finances link. The calls that lead to writes are `startE2eRun`,
 * `advanceE2eRun`, `continueE2eRun`, `abortE2eRun` and `closeE2eRun` — the
 * RUNNER writes, server side, after its guards (G0–G11) and the database's;
 * `requestE2ePreview` asks for its zero-write preview (G7).
 *
 * GET, NEVER HEAD. The presence probes are GETs. A HEAD to a missing
 * PostgREST table answers 404 with no body, and postgrest-js reads a bodiless
 * answer as success — so `select(…, { head: true })` would call an absent
 * table present. `select("id").limit(1)` is a GET that returns the real error
 * (PGRST205). The function's GET answers 404 when it is not deployed, 503 when
 * its kill switch is off (G0), 401/403 when this user may not run it (G1), and
 * otherwise 400 ("unknown action") — present, and then `list` is asked.
 *
 * Every Supabase call is wrapped: supabase-js reports most failures in
 * `{ error }` rather than throwing, and the rest (a missing client in a test,
 * a network failure) must land in state, never as an unhandled rejection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionError, extractFunctionErrorPayload } from "@/lib/edge-error";
import {
  CONFIRM_SENTENCE,
  E2E_RUNNER_FUNCTION,
  E2E_RUNS_TABLE,
  E2E_STEPS_TABLE,
  isTerminal,
  normalizeRun,
  normalizeStep,
  parseOutcome,
  parseRunnerList,
  parseScenarioPreview,
  runnerSafetyProblem,
  type CatalogueScenario,
  type E2eRun,
  type ExecutedStep,
  type RunOutcome,
  type RunPreview,
  type RunStatus,
  type RunnerInfo,
  type ScenarioPreview,
} from "@/components/dev/e2e-runner-contract";

/* ── one piece of the backend: present, or why not ───────────────────────── */

export type PieceState =
  | { ok: true }
  | {
      ok: false;
      /** absent = not deployed / not applied; refused = there, but said no; unsafe = the page refuses. */
      kind: "absent" | "refused" | "error" | "unsafe";
      message: string;
    };

export type RunnerProbe =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ready"; runner: RunnerInfo; catalogue: CatalogueScenario[] }
  | { state: "unavailable"; fn: PieceState; table: PieceState; runner: RunnerInfo | null; catalogue: CatalogueScenario[] };

/* The dev_sim_* tables are not in the generated types (they may not exist at
   all), so they are read through an untyped view of the same client — not the
   exported `supabaseUntyped`, which a test double of this module may not carry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

const message = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : typeof e === "string" && e ? e : fallback;

/** The HTTP status a FunctionsHttpError carries on its `context` Response, if any. */
const statusOf = (error: unknown): number | null => {
  const s = (error as { context?: { status?: unknown } })?.context?.status;
  return typeof s === "number" ? s : null;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `code`/`message` of a PostgREST error, read defensively. */
function tableError(error: unknown): PieceState {
  const e = (error ?? {}) as { code?: string; message?: string };
  const text = e.message || "unknown error";
  if (e.code === "PGRST205" || e.code === "42P01" || /could not find the table|does not exist/i.test(text)) {
    return { ok: false, kind: "absent", message: `The ${E2E_RUNS_TABLE} table is not applied on this database (${text}).` };
  }
  if (e.code === "42501" || /permission denied/i.test(text)) {
    return { ok: false, kind: "refused", message: `The ${E2E_RUNS_TABLE} table exists but refuses this user (${text}).` };
  }
  return { ok: false, kind: "error", message: `The ${E2E_RUNS_TABLE} table could not be read (${text}).` };
}

/* ── probes ─────────────────────────────────────────────────────────────── */

/**
 * Is the runner there, may this user use it, and what would it run? A GET
 * first (presence: see the header), then `list` (no writes) for the catalogue
 * and the runner's own environment checks.
 */
export async function probeE2eRunner(): Promise<{ piece: PieceState; runner: RunnerInfo | null; catalogue: CatalogueScenario[] }> {
  const fail = (kind: "absent" | "refused" | "error", text: string) => ({
    piece: { ok: false as const, kind, message: text },
    runner: null,
    catalogue: [] as CatalogueScenario[],
  });
  const refusedOrMissing = async (error: unknown, how: string) => {
    const status = statusOf(error);
    const text = await extractFunctionError(error, "no message");
    if (status === 404) {
      return fail("absent", `The ${E2E_RUNNER_FUNCTION} edge function is not deployed on this project (${how} answered 404: ${text}).`);
    }
    if (status === 503) return fail("refused", `The ${E2E_RUNNER_FUNCTION} function is deployed but switched off (${text})`);
    if (status === 401 || status === 403 || status === 412) {
      // 401/403: this user (G1); 412: the tenant or the environment (G2, G3) — the runner's words say which.
      return fail("refused", `The ${E2E_RUNNER_FUNCTION} function refused (${status}): ${text}`);
    }
    return null;
  };
  try {
    // 1. Presence, with a GET. A deployed, switched-on runner answers 400 "unknown action" here.
    const probe = await supabase.functions.invoke(E2E_RUNNER_FUNCTION, { method: "GET" });
    if (probe.error) {
      const r = await refusedOrMissing(probe.error, "GET");
      if (r) return r;
      const status = statusOf(probe.error);
      if (status !== 400) {
        return fail(
          "error",
          `The ${E2E_RUNNER_FUNCTION} function could not be reached${status ? ` (${status})` : ""}: ${await extractFunctionError(probe.error, "no message")}`,
        );
      }
    }
    // 2. The catalogue and the runner's checks.
    const { data, error } = await supabase.functions.invoke(E2E_RUNNER_FUNCTION, { body: { action: "list" } });
    if (error) {
      const r = await refusedOrMissing(error, "list");
      if (r) return r;
      const status = statusOf(error);
      return fail("error", `The ${E2E_RUNNER_FUNCTION} function did not list its scenarios${status ? ` (${status})` : ""}: ${await extractFunctionError(error, "no message")}`);
    }
    const parsed = parseRunnerList(data);
    if (parsed.ok === false) return fail("error", parsed.message);
    const unsafe = runnerSafetyProblem(parsed.runner);
    if (unsafe) {
      return { piece: { ok: false, kind: "unsafe", message: unsafe }, runner: parsed.runner, catalogue: parsed.catalogue };
    }
    return { piece: { ok: true }, runner: parsed.runner, catalogue: parsed.catalogue };
  } catch (e) {
    return fail("error", `The ${E2E_RUNNER_FUNCTION} function could not be called: ${message(e, "unknown error")}`);
  }
}

export async function probeE2eRunsTable(tenantId: string): Promise<PieceState> {
  try {
    // A GET (see the header): `head: true` would read a missing table as present.
    const { error } = await db().from(E2E_RUNS_TABLE).select("id").eq("tenant_id", tenantId).limit(1);
    return error ? tableError(error) : { ok: true };
  } catch (e) {
    return { ok: false, kind: "error", message: `The ${E2E_RUNS_TABLE} table could not be queried: ${message(e, "unknown error")}` };
  }
}

/**
 * Both probes, once per mount. "ready" needs all of: the function is there and
 * listed a catalogue, its checks passed and it runs on northwind in Stripe test
 * mode, and the table answered its GET. Anything else is "unavailable", with
 * the reason for each.
 */
export function useE2eRunnerProbe(enabled: boolean, tenantId: string | null | undefined): RunnerProbe {
  const [probe, setProbe] = useState<RunnerProbe>(enabled ? { state: "checking" } : { state: "idle" });

  useEffect(() => {
    if (!enabled || !tenantId) {
      setProbe({ state: "idle" });
      return;
    }
    let live = true;
    setProbe({ state: "checking" });
    void (async () => {
      const [fn, table] = await Promise.all([probeE2eRunner(), probeE2eRunsTable(tenantId)]);
      if (!live) return;
      if (fn.piece.ok && table.ok && fn.runner) setProbe({ state: "ready", runner: fn.runner, catalogue: fn.catalogue });
      else setProbe({ state: "unavailable", fn: fn.piece, table, runner: fn.runner, catalogue: fn.catalogue });
    })();
    return () => {
      live = false;
    };
  }, [enabled, tenantId]);

  return probe;
}

/* ── reading runs ────────────────────────────────────────────────────────── */

export async function fetchE2eRuns(tenantId: string, limit = 25): Promise<E2eRun[]> {
  const { data, error } = await db()
    .from(E2E_RUNS_TABLE)
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message || `${E2E_RUNS_TABLE} could not be read`);
  return (Array.isArray(data) ? data : []).map(normalizeRun).filter((r: E2eRun | null): r is E2eRun => !!r);
}

/** One run row, alone — what the driver needs each turn. */
export async function fetchE2eRunRow(tenantId: string, runId: string): Promise<E2eRun | null> {
  const { data, error } = await db().from(E2E_RUNS_TABLE).select("*").eq("id", runId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(error.message || `${E2E_RUNS_TABLE} could not be read`);
  return normalizeRun(data);
}

/**
 * The run `start` is creating, found before `start` answers — the first
 * request makes the fixture and runs steps for up to ~100 s, and the lead
 * should watch them happen. The newest unfinished run of this scenario, created
 * since the request went out (with two minutes' allowance for clock skew), that
 * the page does not already know.
 */
export async function findStartingRun(tenantId: string, scenarioId: string, sentAtMs: number, known: readonly string[]): Promise<string | null> {
  const since = new Date(sentAtMs - 120_000).toISOString();
  const { data, error } = await db()
    .from(E2E_RUNS_TABLE)
    .select("id, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("scenario_id", scenarioId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !Array.isArray(data)) return null;
  const hit = (data as { id: string; status: string }[]).find((r) => !known.includes(r.id) && (r.status === "running" || r.status === "waiting"));
  return hit?.id ?? null;
}

export interface RunWithSteps {
  run: E2eRun | null;
  steps: ExecutedStep[];
}

/** One run row and its step rows, both scoped to the tenant. */
export async function fetchE2eRunWithSteps(tenantId: string, runId: string): Promise<RunWithSteps> {
  const [runRes, stepRes] = await Promise.all([
    db().from(E2E_RUNS_TABLE).select("*").eq("id", runId).eq("tenant_id", tenantId).maybeSingle(),
    db().from(E2E_STEPS_TABLE).select("*").eq("run_id", runId).eq("tenant_id", tenantId).order("step_index", { ascending: true }),
  ]);
  if (runRes.error) throw new Error(runRes.error.message || `${E2E_RUNS_TABLE} could not be read`);
  if (stepRes.error) throw new Error(stepRes.error.message || `${E2E_STEPS_TABLE} could not be read`);
  return {
    run: normalizeRun(runRes.data),
    steps: (Array.isArray(stepRes.data) ? stepRes.data : [])
      .map(normalizeStep)
      .filter((s: ExecutedStep | null): s is ExecutedStep => !!s),
  };
}

/**
 * The rental's number, for the Finances link. Finances searches by it (every
 * rental gets one from a trigger), so without it there is no honest link.
 */
export async function fetchRentalNumber(tenantId: string, rentalId: string): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("rentals")
      .select("id, rental_number")
      .eq("id", rentalId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return typeof data.rental_number === "string" && data.rental_number ? data.rental_number : null;
  } catch {
    return null;
  }
}

export function useE2eRunHistory(enabled: boolean, tenantId: string | null | undefined, limit = 25) {
  const [runs, setRuns] = useState<E2eRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !tenantId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const rows = await fetchE2eRuns(tenantId, limit);
      if (mine !== seq.current) return;
      setRuns(rows);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(message(e, "The run history could not be read."));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [enabled, tenantId, limit]);

  useEffect(() => {
    void refresh();
    return () => {
      // A later refresh (or unmount) makes any in-flight answer stale.
      seq.current += 1;
    };
  }, [refresh]);

  return { runs, loading, error, refresh };
}

/* ── the runner's actions ───────────────────────────────────────────────── */

class RunnerHttpError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(text: string, status: number | null, code: string | null = null) {
    super(text);
    this.status = status;
    this.code = code;
  }
}

async function invokeRunner(body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(E2E_RUNNER_FUNCTION, { body });
  if (error) {
    const payload = await extractFunctionErrorPayload(error);
    const code = payload && typeof payload.code === "string" ? payload.code : null;
    throw new RunnerHttpError(await extractFunctionError(error, fallback), statusOf(error), code);
  }
  const d = (data ?? null) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") throw new RunnerHttpError(fallback, null);
  if (d.ok === false || (typeof d.error === "string" && d.error && d.ok !== true)) {
    throw new RunnerHttpError(String(d.error || d.message || fallback), null, typeof d.code === "string" ? d.code : null);
  }
  return d;
}

/** One scenario's preview: the runner's guards, and the full scenario. Writes nothing (G7). */
export async function requestScenarioPreview(scenarioId: string): Promise<ScenarioPreview> {
  const reply = await invokeRunner({ action: "preview", scenarioId }, `The runner could not preview ${scenarioId}. Nothing was written.`);
  const p = parseScenarioPreview(reply, scenarioId);
  if (!p) throw new Error(`The runner's preview of ${scenarioId} could not be read, so nothing will be run.`);
  return p;
}

/** The preview of a whole request, one scenario after another. Throws naming the one that failed. */
export async function requestE2ePreview(scenarioIds: readonly string[]): Promise<RunPreview> {
  const items: ScenarioPreview[] = [];
  for (const id of scenarioIds) items.push(await requestScenarioPreview(id));
  return { items };
}

/**
 * Start ONE scenario. The runner creates the run and the fixture and works
 * through steps for up to ~100 s before it answers. The confirm sentence goes
 * with it for the record; the runner does not require it (the page does).
 */
export async function startE2eRun(scenarioId: string): Promise<RunOutcome> {
  const reply = await invokeRunner({ action: "start", scenarioId, confirm: CONFIRM_SENTENCE }, `The runner did not start ${scenarioId}.`);
  const o = parseOutcome(reply);
  if (!o.runId) throw new Error(`The runner started ${scenarioId} but did not say which run it made.`);
  return o;
}

/** More steps of a running run. "busy" = leased by another request, or no longer running (409). */
export async function advanceE2eRun(runId: string): Promise<RunOutcome | "busy"> {
  try {
    return parseOutcome(await invokeRunner({ action: "advance", runId }, "The runner did not advance the run."));
  } catch (e) {
    if (e instanceof RunnerHttpError && e.status === 409) return "busy";
    throw e;
  }
}

/** A `human` step is done: the tester paid the link the step showed. The runner checks for itself. */
export async function continueE2eRun(runId: string): Promise<RunOutcome> {
  return parseOutcome(await invokeRunner({ action: "continue", runId }, "The runner did not accept Continue."));
}

/** Stop the run; the runner parks the fixture. */
export async function abortE2eRun(runId: string): Promise<void> {
  await invokeRunner({ action: "abort", runId }, "The runner did not stop the run.");
}

/** A finished run's fixture rental is Closed (engines off). Money rows stay — they are the evidence. */
export async function closeE2eRun(runId: string): Promise<void> {
  await invokeRunner({ action: "close", runId }, "The runner did not close the fixture.");
}

/**
 * Drive ONE started run to its end: advance while it is running (after any
 * wait the runner asks for), wait for the person while it is waiting, stop at
 * a terminal status, at `maxMs`, or when `cancelled()` says so.
 */
export async function driveE2eRun(opts: {
  tenantId: string;
  runId: string;
  first: RunOutcome | null;
  pollMs: number;
  maxMs: number;
  cancelled: () => boolean;
  /** Told when the runner asks the page to hold off (G8), and when it is over. */
  onDefer?: (seconds: number | null) => void;
}): Promise<RunStatus | "gave_up" | "cancelled"> {
  const { tenantId, runId, pollMs, maxMs, cancelled, onDefer } = opts;
  const started = Date.now();
  let last: RunOutcome | null = opts.first;
  for (;;) {
    if (cancelled()) return "cancelled";
    if (Date.now() - started > maxMs) return "gave_up";
    const wait = last?.deferredSeconds ?? 0;
    if (wait > 0) {
      onDefer?.(wait);
      const until = Date.now() + wait * 1000;
      while (Date.now() < until) {
        if (cancelled()) return "cancelled";
        await sleep(Math.min(pollMs, until - Date.now()));
      }
      onDefer?.(null);
    }
    let row: E2eRun | null = null;
    try {
      row = await fetchE2eRunRow(tenantId, runId);
    } catch {
      /* a failed read is retried on the next turn */
    }
    const status = row?.status ?? last?.status ?? null;
    if (status && isTerminal(status)) return status;
    if (status === "running") {
      const r = await advanceE2eRun(runId).catch(() => "busy" as const);
      last = r === "busy" ? null : r;
      if (r === "busy") await sleep(pollMs);
      continue;
    }
    // Waiting for the person (the report's Continue), or not readable yet.
    last = null;
    await sleep(pollMs);
  }
}

/* ── watching runs ───────────────────────────────────────────────────────── */

export interface RunsWatch {
  byId: Record<string, RunWithSteps>;
  /** The last poll's failure, if the most recent one failed. */
  error: string | null;
  /** Still polling. */
  watching: boolean;
  /** Polling stopped at `maxWatchMs` with a run still not finished. */
  gaveUp: boolean;
  /** Read every run again once, finished or not (after a close, say). */
  reload: () => void;
}

/**
 * Poll a set of runs (their rows and step rows) until every one is finished.
 * `runIds` may grow while it watches (a queue adding its next run): the effect
 * restarts with the longer list and keeps what it had.
 */
export function useE2eRunsWatch(
  tenantId: string | null | undefined,
  runIds: readonly string[],
  opts: { pollMs?: number; maxWatchMs?: number; onSettled?: () => void } = {},
): RunsWatch {
  const { pollMs = 1500, maxWatchMs = 30 * 60 * 1000 } = opts;
  const key = runIds.join(",");
  const [bump, setBump] = useState(0);
  const [state, setState] = useState<Omit<RunsWatch, "reload">>({ byId: {}, error: null, watching: runIds.length > 0, gaveUp: false });
  const kept = useRef<Record<string, RunWithSteps>>({});
  const onSettled = useRef(opts.onSettled);
  onSettled.current = opts.onSettled;
  const reload = useCallback(() => setBump((n) => n + 1), []);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!tenantId || ids.length === 0) {
      kept.current = {};
      setState({ byId: {}, error: null, watching: false, gaveUp: false });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    // Keep what is already known about runs still on the list.
    const known: Record<string, RunWithSteps> = {};
    for (const id of ids) if (kept.current[id]) known[id] = kept.current[id];
    setState({ byId: { ...known }, error: null, watching: true, gaveUp: false });
    // A reload reads finished runs too, once.
    let everything = bump > 0;

    const tick = async () => {
      let err: string | null = null;
      const open = everything ? ids : ids.filter((id) => !(known[id]?.run && isTerminal(known[id].run!.status)));
      everything = false;
      const read = await Promise.all(
        open.map((id) =>
          fetchE2eRunWithSteps(tenantId, id).catch((e) => {
            err = message(e, "The run could not be read.");
            return null;
          }),
        ),
      );
      if (!live) return;
      open.forEach((id, i) => {
        const r = read[i];
        if (r && r.run) known[id] = r;
      });
      kept.current = { ...known };
      const done = ids.every((id) => known[id]?.run && isTerminal(known[id].run!.status));
      const expired = !done && Date.now() - started >= maxWatchMs;
      setState({ byId: { ...known }, error: err, watching: !done && !expired, gaveUp: expired });
      if (done) onSettled.current?.();
      else if (!expired) timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [tenantId, key, pollMs, maxWatchMs, bump]);

  return { ...state, reload };
}
