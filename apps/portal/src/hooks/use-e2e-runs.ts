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
 * WHAT IT READS AND WRITES. From the browser: reads only — a GET to the
 * `e2e-runner` function (its catalogue), SELECTs on `dev_sim_runs` /
 * `dev_sim_run_steps` for the open tenant, and a rental's number for the
 * Finances link. The calls that lead to writes are `startE2eRun`,
 * `advanceE2eRun`, `continueE2eRun`, `abortE2eRun` and `closeE2eRun` — the
 * RUNNER writes, server side, after its guards (G0–G12) and the database's;
 * `requestE2ePreview` asks for its zero-write preview (G7), whose
 * `preview_id` every start must carry (G12).
 *
 * GET, NEVER HEAD. The presence probes are GETs. A HEAD to a missing
 * PostgREST table answers 404 with no body, and postgrest-js reads a bodiless
 * answer as success — so `select(…, { head: true })` would call an absent
 * table present. `select("id").limit(1)` is a GET that returns the real error
 * (PGRST205). The function's GET answers 404 when it is not deployed, 503 when
 * its kill switch is off (G0), 401/403 when this user may not run it (G1),
 * 412 when the tenant is not northwind in Stripe test mode (G2), and otherwise
 * 200 with its catalogue — the same answer as POST `list`.
 *
 * Every Supabase call is wrapped: supabase-js reports most failures in
 * `{ error }` rather than throwing, and the rest (a missing client in a test,
 * a network failure) must land in state, never as an unhandled rejection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionError, extractFunctionErrorPayload } from "@/lib/edge-error";
import {
  E2E_RUNNER_FUNCTION,
  E2E_RUNS_TABLE,
  E2E_STEPS_TABLE,
  isTerminal,
  listRequest,
  normalizeRun,
  normalizeStep,
  parseOutcome,
  parseRunPreview,
  parseRunnerList,
  previewProblems,
  previewRequest,
  runActionRequest,
  runRequest,
  runnerSafetyProblem,
  type CatalogueScenario,
  type E2eRun,
  type ExecutedStep,
  type RunOutcome,
  type RunPreview,
  type RunStatus,
  type RunnerInfo,
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
 * Is the runner there, may this user use it, and what would it run? One GET
 * (see the header): the runner answers it with its catalogue and its own
 * environment checks, and writes nothing. A runner that answers the GET 400
 * (an older build that did not treat GET as `list`) is asked with POST `list`.
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
    // Presence AND the catalogue, with one GET.
    const probe = await supabase.functions.invoke(E2E_RUNNER_FUNCTION, { method: "GET" });
    let data: unknown = probe.data;
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
      const listed = await supabase.functions.invoke(E2E_RUNNER_FUNCTION, { body: listRequest() });
      if (listed.error) {
        const r2 = await refusedOrMissing(listed.error, "list");
        if (r2) return r2;
        const s2 = statusOf(listed.error);
        return fail("error", `The ${E2E_RUNNER_FUNCTION} function did not list its scenarios${s2 ? ` (${s2})` : ""}: ${await extractFunctionError(listed.error, "no message")}`);
      }
      data = listed.data;
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
  /** The HTTP status the runner answered with; null when no answer came back (network, relay). */
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
  // A 2xx came back: the runner answered, so its refusal is its own decision.
  const d = (data ?? null) as Record<string, unknown> | null;
  if (!d || typeof d !== "object") throw new RunnerHttpError(fallback, 200);
  if (d.ok === false || (typeof d.error === "string" && d.error && d.ok !== true)) {
    throw new RunnerHttpError(String(d.error || d.message || fallback), 200, typeof d.code === "string" ? d.code : null);
  }
  return d;
}

/** The runner's zero-write preview (G7) of these scenarios, in one request. Throws when it is not one. */
export async function requestE2ePreview(scenarioIds: readonly string[]): Promise<RunPreview> {
  const reply = await invokeRunner(previewRequest(scenarioIds), `The runner could not preview ${scenarioIds.join(", ")}. Nothing was written.`);
  const p = parseRunPreview(reply);
  if (!p) throw new Error("The runner's preview could not be read, so nothing will be run.");
  return p;
}

/**
 * A preview of ONE scenario, taken just before it starts: the id a run must
 * carry lasts 15 minutes (G12), and a queue can take far longer than that.
 * Anything the preview now refuses stops the start — the tenant's settings or
 * the runner's environment may have changed since the confirm.
 */
export async function freshPreviewId(scenarioId: string): Promise<{ previewId: string; preview: RunPreview }> {
  const preview = await requestE2ePreview([scenarioId]);
  const problems = previewProblems(preview, [scenarioId]);
  if (problems.length) throw new Error(`a fresh preview of ${scenarioId} refuses it — ${problems.join(" ")}`);
  return { previewId: preview.previewId!, preview };
}

/** A run id minted here, so the page can watch the run's row before `run` answers. */
export function newRunId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // RFC 4122 v4 from Math.random — only where the platform has no randomUUID (old test runtimes).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Why `run` failed, and whether the runner could have created the run row before failing. */
export class StartError extends Error {
  /** A 4xx refusal is decided before the row is inserted; anything else may have left a run behind. */
  readonly refusedBeforeWrite: boolean;
  constructor(text: string, refusedBeforeWrite: boolean) {
    super(text);
    this.refusedBeforeWrite = refusedBeforeWrite;
  }
}

/**
 * Start ONE scenario under a fresh preview, with the confirm sentence and a
 * run id this page minted. The runner creates the run and the fixture and
 * works through steps for up to ~100 s before it answers.
 */
export async function startE2eRun(scenarioId: string, previewId: string, runId: string): Promise<RunOutcome> {
  let reply: Record<string, unknown>;
  try {
    reply = await invokeRunner(runRequest(scenarioId, previewId, runId), `The runner did not start ${scenarioId}.`);
  } catch (e) {
    const status = e instanceof RunnerHttpError ? e.status : null;
    // ok:false in a 2xx body, or a 4xx: the runner refused before writing the row (index.ts checks
    // G12/G4/G3/assumptions first). A 5xx, a platform timeout or no answer at all may not have.
    const refused = status !== null && status < 500;
    throw new StartError(message(e, `The runner did not start ${scenarioId}.`), refused);
  }
  const o = parseOutcome(reply);
  if (o.runId && o.runId !== runId) throw new StartError(`The runner started ${scenarioId} under another run id (${o.runId}).`, false);
  return { ...o, runId };
}

/** More steps of a running run. "busy" = leased by another request, or no longer running (409). */
export async function advanceE2eRun(runId: string): Promise<RunOutcome | "busy"> {
  try {
    return parseOutcome(await invokeRunner(runActionRequest("advance", runId), "The runner did not advance the run."));
  } catch (e) {
    if (e instanceof RunnerHttpError && e.status === 409) return "busy";
    throw e;
  }
}

/** A `human` step is done: the tester paid the link the step showed. The runner checks for itself. */
export async function continueE2eRun(runId: string): Promise<RunOutcome> {
  return parseOutcome(await invokeRunner(runActionRequest("continue", runId), "The runner did not accept Continue."));
}

/** Stop the run; the runner parks the fixture. */
export async function abortE2eRun(runId: string): Promise<void> {
  await invokeRunner(runActionRequest("abort", runId), "The runner did not stop the run.");
}

/** A finished run's fixture rental is Closed (engines off). Money rows stay — they are the evidence. */
export async function closeE2eRun(runId: string): Promise<void> {
  await invokeRunner(runActionRequest("close", runId), "The runner did not close the fixture.");
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
