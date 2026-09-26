"use client";

/**
 * `/dev` — LIVE TEST RUNS (docs/PAYMENTS_ROADMAP.md Wave 4, assumption A6).
 *
 * The lead: "However you test it, make sure I can test it that same way",
 * "Put the testing in the developer tab", "test each and every branch", and
 * "Payments are too risky for us to take your word. We'll accept evidence
 * only." (spec §1, §9). So testing on this page has two tiers, labelled on
 * screen exactly like this:
 *
 *   Instant — runs in your browser, writes nothing
 *       the payment plan simulator (`payment-plan-simulator.tsx`), unchanged.
 *   Live test run — real database and Stripe test mode, northwind only
 *       this section. It asks the `e2e-runner` edge function to create a
 *       fixture rental on northwind per scenario, fire the real engines at it,
 *       and record every step and check in `dev_sim_runs` / `dev_sim_run_steps`.
 *
 * WHAT THIS SECTION DOES FROM THE BROWSER, AND WHAT IT CAUSES
 *   - On mount: two GETs — the runner's read-only catalogue (every scenario,
 *     steps and expected values included), and one row of `dev_sim_runs` — to
 *     learn whether the backend exists at all. If either is missing (not
 *     deployed / not applied), refuses, or the runner does not say
 *     "northwind" and "test", the section says so and offers nothing to click.
 *   - Run / Run group / Run all: first ONE runner PREVIEW of the scenarios
 *     (zero writes) — its guard verdicts, and the runner's own plan of what
 *     each run writes, charges and fires; only the confirm — beside the
 *     sentence "This writes test rows to northwind in Stripe TEST mode" —
 *     starts them, one scenario after another (one dev_sim_runs row each).
 *     Just before each start the page takes a fresh preview of that one
 *     scenario (the preview_id a run must carry lasts 15 minutes, G12) and
 *     mints the run's id, so the run can be watched before `run` answers; a
 *     fresh preview that now refuses stops the queue there. The runner
 *     writes; this page never inserts, updates or deletes anything itself.
 *   - While they go: polls each run's row and step rows for live progress,
 *     calls `advance` while a run is running (waiting first when the runner
 *     asks, G8), and — at a step only a person can do — shows the payment link
 *     and a Continue button. "Stop this run" aborts one; "Close the fixture
 *     rental" closes a finished one's fixture.
 *   - History: reads `dev_sim_runs` for this tenant; any run can be reopened,
 *     and an unfinished one resumed.
 *
 * The guards that make a run safe are the RUNNER's and the database's, server
 * side (see the blast-radius note in `dev-page.tsx`); the checks here are a
 * second opinion that refuses to offer what the runner does not claim.
 *
 * Northwind only: the page gates on the slug, and this section gates again, so
 * it renders nothing — and probes nothing — anywhere else.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical, Hand, History, Loader2, Play, RefreshCw, ShieldCheck, Square, Zap } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui-v2/card";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { NORTHWIND } from "@/lib/v2";
import {
  abortE2eRun,
  closeE2eRun,
  continueE2eRun,
  driveE2eRun,
  fetchE2eRunRow,
  freshPreviewId,
  newRunId,
  requestE2ePreview,
  StartError,
  startE2eRun,
  useE2eRunHistory,
  useE2eRunnerProbe,
  useE2eRunsWatch,
  type PieceState,
} from "@/hooks/use-e2e-runs";
import {
  CONFIRM_SENTENCE,
  E2E_RUNNER_FUNCTION,
  E2E_RUNS_TABLE,
  allScenarioIds,
  groupCatalogue,
  isTerminal,
  previewProblems,
  rowVerdict,
  runVerdict,
  type CatalogueScenario,
  type E2eRun,
  type RunOutcome,
  type RunPreview,
  type RunnerInfo,
  type Verdict,
} from "./e2e-runner-contract";
import { E2eRunReport, VerdictIcon, type ReportEntry } from "./e2e-run-report";

export const INSTANT_TIER_LABEL = "Instant — runs in your browser, writes nothing";
export const LIVE_TIER_LABEL = "Live test run — real database and Stripe test mode, northwind only";

/** How long one run is driven before the page stops and says so. */
const MAX_RUN_MS = 30 * 60 * 1000;

type Flow =
  | { stage: "idle" }
  | { stage: "previewing"; ids: string[]; label: string }
  | { stage: "preview"; ids: string[]; label: string; preview: RunPreview; problems: string[] }
  | { stage: "failed"; label: string; message: string };

/** Runs started here, now: one scenario after another under one preview. */
interface Queue {
  label: string;
  ids: string[];
  runIds: Record<string, string>;
  /** The scenario whose `run` request is in flight. */
  starting: string | null;
  /** The confirmed preview. */
  preview: RunPreview;
  /** The fresh preview each scenario was started under (scenario id → preview_id). */
  startedUnder: Record<string, string>;
  note: string | null;
  /** The runner asked the page to hold off (G8). */
  defer: string | null;
  done: boolean;
}

/** A run reopened from the history. */
interface Opened {
  runId: string;
  scenarioId: string;
  /** "Resume" pressed: this page drives it again (advance / Continue). */
  driving: boolean;
}

const scrollTo = (el: HTMLElement | null) => {
  // jsdom has no scrollIntoView; a real browser does.
  if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

export function E2eLiveRunner({ pollMs = 1500 }: { pollMs?: number } = {}) {
  const { tenant } = useTenant();
  const enabled = !!tenant && tenant.slug === NORTHWIND;
  const tenantId = enabled ? tenant.id : null;

  const probe = useE2eRunnerProbe(enabled, tenantId);
  const ready = probe.state === "ready";
  const history = useE2eRunHistory(ready, tenantId);
  const refreshHistory = history.refresh;

  const [flow, setFlow] = useState<Flow>({ stage: "idle" });
  const [queue, setQueue] = useState<Queue | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const stopAfterCurrent = useRef(false);
  const alive = useRef(true);
  const flowRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const watchedIds = queue ? queue.ids.map((id) => queue.runIds[id]).filter((x): x is string => !!x) : opened ? [opened.runId] : [];
  const watch = useE2eRunsWatch(tenantId, watchedIds, { pollMs, onSettled: () => void refreshHistory() });

  useEffect(() => {
    if (flow.stage === "preview" || flow.stage === "failed") scrollTo(flowRef.current);
  }, [flow.stage]);
  const queueStarted = !!queue;
  useEffect(() => {
    if (queueStarted) scrollTo(reportRef.current);
  }, [queueStarted]);

  // Northwind only — and nothing is probed anywhere else (the hooks above are
  // disabled unless `enabled`).
  if (!enabled) return null;

  // The runner's catalogue, as it listed it (full scenarios: steps and expected values).
  const catalogue: CatalogueScenario[] = probe.state === "ready" ? probe.catalogue : [];
  const runner: RunnerInfo | null = probe.state === "ready" ? probe.runner : null;
  const queueGoing = !!queue && !queue.done;
  const locked = queueGoing || !!opened?.driving || flow.stage === "previewing" || flow.stage === "preview";

  const askPreview = async (ids: string[], label: string) => {
    if (!ids.length || locked) return;
    setFlow({ stage: "previewing", ids, label });
    try {
      const preview = await requestE2ePreview(ids);
      setFlow({ stage: "preview", ids, label, preview, problems: previewProblems(preview, ids) });
    } catch (e) {
      setFlow({ stage: "failed", label, message: `The preview failed, so nothing was run: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  /**
   * The confirmed queue: for each scenario, a fresh preview (zero writes; its
   * id is what the runner checks, G12), then `run` under a run id minted
   * here, then drive it to its end, then the next. `run` does real work before
   * it answers (the fixture and the first steps, up to ~100 s); because the
   * page chose the id, the report watches that row from the first moment.
   */
  const runQueue = async (ids: string[], label: string, preview: RunPreview) => {
    stopAfterCurrent.current = false;
    setOpened(null);
    setQueue({ label, ids, runIds: {}, starting: null, preview, startedUnder: {}, note: null, defer: null, done: false });
    const patch = (p: Partial<Queue>) => alive.current && setQueue((q) => (q ? { ...q, ...p } : q));
    const setRunId = (id: string, runId: string | null) =>
      alive.current &&
      setQueue((q) => {
        if (!q) return q;
        const runIds = { ...q.runIds };
        if (runId) runIds[id] = runId;
        else delete runIds[id];
        return { ...q, runIds };
      });
    const stopHere = (i: number, why: string) => {
      patch({
        starting: null,
        done: true,
        note: `${why} The queue stopped there${i + 1 < ids.length ? ` (${ids.length - i - 1} not run).` : "."}`,
      });
      void refreshHistory();
    };
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (!alive.current) return;
      if (stopAfterCurrent.current) {
        patch({ note: `Stopped before ${id}, as asked. ${ids.length - i} not run.`, done: true, starting: null });
        void refreshHistory();
        return;
      }
      patch({ starting: id });

      // 1. A fresh preview of this one scenario — nothing is written.
      let previewId: string;
      try {
        previewId = (await freshPreviewId(id)).previewId;
      } catch (e) {
        if (!alive.current) return;
        stopHere(i, `${id} was not started: ${e instanceof Error ? e.message : String(e)}. Nothing was written for it.`);
        return;
      }
      if (!alive.current) return;
      setQueue((q) => (q ? { ...q, startedUnder: { ...q.startedUnder, [id]: previewId } } : q));

      // 2. Start it under a run id minted here, and watch that row at once.
      const runId = newRunId();
      setRunId(id, runId);
      let first: RunOutcome | null = null;
      try {
        first = await startE2eRun(id, previewId, runId);
      } catch (e) {
        if (!alive.current) return;
        const text = e instanceof Error ? e.message : String(e);
        if (e instanceof StartError && e.refusedBeforeWrite) {
          setRunId(id, null);
          stopHere(i, `${id} did not start: ${text}. The runner refused before writing its run.`);
          return;
        }
        // No clean answer (a timeout, a 5xx, no network): the runner may still have made the run.
        const row = await fetchE2eRunRow(tenantId!, runId).catch(() => null);
        if (!alive.current) return;
        if (!row) {
          setRunId(id, null);
          stopHere(i, `${id} did not start: ${text}. No run was recorded under ${runId.slice(0, 8)}; if the runner wrote anything, it is in the history below.`);
          return;
        }
        patch({ note: `${id}: the start request ended without an answer (${text}), but its run exists — carrying on with it.` });
      }
      if (!alive.current) return;
      patch({ starting: null });
      void refreshHistory();

      // 3. Drive it to its end.
      const end = await driveE2eRun({
        tenantId: tenantId!,
        runId,
        first,
        pollMs,
        maxMs: MAX_RUN_MS,
        cancelled: () => !alive.current,
        onDefer: (secs) =>
          patch({ defer: secs ? `The runner asked to wait ${secs} s so a real cron's run window passes first (G8). It carries on by itself.` : null }),
      });
      if (end === "cancelled") return;
      if (end === "gave_up") {
        patch({ note: `${id} was still not finished after 30 minutes; the queue stopped there. Reopen it from the history.`, done: true });
        void refreshHistory();
        return;
      }
    }
    patch({ done: true, defer: null });
    void refreshHistory();
  };

  const confirm = () => {
    if (flow.stage !== "preview" || flow.problems.length) return;
    const { ids, label, preview } = flow;
    setFlow({ stage: "idle" });
    void runQueue(ids, label, preview);
  };

  const resumeOpened = async () => {
    if (!opened || !tenantId) return;
    const o = opened;
    setOpened({ ...o, driving: true });
    await driveE2eRun({ tenantId, runId: o.runId, first: null, pollMs, maxMs: MAX_RUN_MS, cancelled: () => !alive.current });
    if (alive.current) setOpened((cur) => (cur && cur.runId === o.runId ? { ...cur, driving: false } : cur));
    void refreshHistory();
  };

  const abortRun = async (runId: string) => {
    // The queue must not start the next one after a stop.
    stopAfterCurrent.current = true;
    await abortE2eRun(runId);
    watch.reload();
    void refreshHistory();
  };

  const closeFixture = async (runId: string) => {
    await closeE2eRun(runId);
    watch.reload();
    void refreshHistory();
  };

  /** A scenario's verdict in the report on screen, if it covers it. */
  const verdictIn = (scenarioId: string): Verdict | "queued" | null => {
    if (queue) {
      if (!queue.ids.includes(scenarioId)) return null;
      const runId = queue.runIds[scenarioId];
      const d = runId ? watch.byId[runId] : undefined;
      return d?.run ? runVerdict(d.run, d.steps) : runId ? "running" : "queued";
    }
    if (opened && opened.scenarioId === scenarioId) {
      const d = watch.byId[opened.runId];
      return d?.run ? runVerdict(d.run, d.steps) : null;
    }
    return null;
  };

  const toggle = (s: CatalogueScenario) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(s.id)) n.delete(s.id);
      else n.add(s.id);
      return n;
    });

  const openedData = opened ? watch.byId[opened.runId] : undefined;
  const openedUnfinished = !!openedData?.run && !isTerminal(openedData.run.status);
  const reportEntries: ReportEntry[] = queue
    ? queue.ids.map((id) => ({ scenarioId: id, runId: queue.runIds[id] ?? null, starting: queue.starting === id }))
    : opened
      ? [{ scenarioId: opened.scenarioId, runId: opened.runId }]
      : [];
  const runnableCount = allScenarioIds(catalogue).length;

  return (
    <section aria-labelledby="dev-section-e2e-live" data-e2e-live-runner="" className="mt-6 flex flex-col gap-3">
      <h2 id="dev-section-e2e-live" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Live test runs
      </h2>

      {/* The two tiers, named the same way everywhere they appear. */}
      <div className="grid gap-2 sm:grid-cols-2" data-e2e-tiers="">
        <div className="rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/5" data-e2e-tier="instant">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <Zap className="size-3.5 text-muted-foreground" />
            {INSTANT_TIER_LABEL}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The payment plan simulator above: the real plan engine, an in-memory store and a simulated card. Nothing is written
            anywhere and reloading forgets it.
          </p>
        </div>
        <div className="rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/5" data-e2e-tier="live">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            <FlaskConical className="size-3.5 text-muted-foreground" />
            {LIVE_TIER_LABEL}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Below: a fixture rental created on northwind for each scenario, the real engines and crons fired at it alone, and every
            step and check recorded so it can be reopened.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <FlaskConical className="h-4 w-4" />
            Live test run
          </CardTitle>
          <CardDescription className="mt-1.5">
            Each scenario creates its own test rental on northwind, runs it through the real booking, extension and payment code with
            Stripe in test mode, and checks every number against the expected outcome written beside it. You see a preview of exactly
            what will be written before anything is. Each result links to the real rental and to Finances so you can look for yourself.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {probe.state === "checking" && (
            <p role="status" className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground" data-e2e-status="checking">
              <Loader2 className="size-3.5 animate-spin" />
              Checking whether the live runner is deployed on this project…
            </p>
          )}

          {probe.state === "unavailable" && <Unavailable fn={probe.fn} table={probe.table} />}

          {probe.state === "ready" && runner && (
            <>
              <RunnerLine runner={runner} />

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  disabled={locked || runnableCount === 0}
                  data-e2e-run-all=""
                  onClick={() => void askPreview(allScenarioIds(catalogue), "every scenario")}
                >
                  {flow.stage === "previewing" && flow.label === "every scenario" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Run all ({runnableCount})
                </Button>
                {queueGoing && queue.ids.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    data-e2e-stop=""
                    onClick={() => {
                      stopAfterCurrent.current = true;
                      setQueue((q) => (q ? { ...q, note: "Stopping after the scenario that is running now." } : q));
                    }}
                  >
                    <Square className="size-3" />
                    Stop after this scenario
                  </Button>
                )}
                {queueGoing && (
                  <span role="status" className="font-mono text-[11px] text-muted-foreground">
                    Runs are going — new runs unlock when they finish.
                  </span>
                )}
              </div>

              <div ref={flowRef}>
                {flow.stage === "previewing" && (
                  <p role="status" className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground" data-e2e-flow="previewing">
                    <Loader2 className="size-3.5 animate-spin" />
                    Asking the runner what {flow.label} would write. Nothing is written by this step.
                  </p>
                )}
                {flow.stage === "preview" && (
                  <PreviewPanel
                    label={flow.label}
                    ids={flow.ids}
                    preview={flow.preview}
                    problems={flow.problems}
                    catalogue={catalogue}
                    onCancel={() => setFlow({ stage: "idle" })}
                    onConfirm={confirm}
                  />
                )}
                {flow.stage === "failed" && (
                  <div role="alert" className="space-y-2 rounded-2xl bg-destructive/10 px-3 py-2.5" data-e2e-flow="failed">
                    <p className="font-mono text-[11px] text-destructive">{flow.message}</p>
                    <Button type="button" size="sm" variant="outline" className="h-7 font-mono text-xs" onClick={() => setFlow({ stage: "idle" })}>
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>

              {reportEntries.length > 0 && (
                <div ref={reportRef} className="space-y-2">
                  {opened && openedUnfinished && !opened.driving && (
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/50 px-3 py-2" data-e2e-resume-offer="">
                      <p className="flex-1 text-[11px] text-muted-foreground">
                        This run is not finished. Resume lets this page take its next steps again (and show Continue at a step that
                        needs you); it writes only what this already-confirmed run would have written.
                      </p>
                      <Button type="button" size="sm" variant="outline" className="h-7 font-mono text-xs" data-e2e-resume="" onClick={() => void resumeOpened()}>
                        Resume
                      </Button>
                    </div>
                  )}
                  <E2eRunReport
                    label={queue ? `Run of ${queue.label}` : `Run ${opened!.runId.slice(0, 8)}`}
                    entries={reportEntries}
                    byId={watch.byId}
                    watching={watch.watching}
                    gaveUp={watch.gaveUp}
                    error={watch.error}
                    catalogue={catalogue}
                    runner={runner}
                    confirmedPreview={queue?.preview ?? null}
                    startedUnder={queue?.startedUnder}
                    tenantId={tenantId}
                    queueNote={queue?.note ?? null}
                    deferNote={queueGoing ? queue.defer : null}
                    onAbort={abortRun}
                    onCloseFixture={queueGoing ? undefined : closeFixture}
                    onClose={
                      queueGoing || opened?.driving
                        ? undefined
                        : () => {
                            setQueue(null);
                            setOpened(null);
                          }
                    }
                    onContinue={
                      queueGoing || opened?.driving
                        ? async (runId) => {
                            await continueE2eRun(runId);
                            watch.reload();
                          }
                        : undefined
                    }
                  />
                </div>
              )}

              <div className="space-y-4" data-e2e-catalogue="">
                {groupCatalogue(catalogue).map((g) => {
                  const runnable = g.scenarios.filter((s) => s.runnableLive).map((s) => s.id);
                  return (
                    <div key={g.key} data-e2e-group={g.key} className="space-y-1.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-medium text-foreground">
                            {g.title}
                            <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">{g.scenarios.length}</span>
                          </h3>
                          <p className="text-[11px] text-muted-foreground">{g.blurb}</p>
                        </div>
                        {runnable.length > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 font-mono text-xs"
                            disabled={locked}
                            data-e2e-run-group={g.key}
                            onClick={() => void askPreview(runnable, `the ${g.title} group`)}
                          >
                            {flow.stage === "previewing" && flow.label === `the ${g.title} group` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                            Run group
                          </Button>
                        )}
                      </div>
                      {g.scenarios.length === 0 ? (
                        <p className="rounded-2xl bg-muted/40 px-4 py-2.5 font-mono text-[11px] text-muted-foreground" data-e2e-group-empty="">
                          The runner lists no scenario for this yet — nothing here is tested live.
                        </p>
                      ) : (
                        <ol className="divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
                          {g.scenarios.map((s) => (
                            <ScenarioRow
                              key={s.id}
                              s={s}
                              verdict={verdictIn(s.id)}
                              isOpen={open.has(s.id)}
                              onToggle={() => toggle(s)}
                              locked={locked}
                              previewing={flow.stage === "previewing" && flow.label === s.id}
                              onRun={() => void askPreview([s.id], s.id)}
                            />
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>

              <HistoryTable
                runs={history.runs}
                catalogue={catalogue}
                loading={history.loading}
                error={history.error}
                shownId={opened?.runId ?? null}
                disabled={queueGoing || !!opened?.driving}
                onRefresh={() => void refreshHistory()}
                onOpen={(run) => {
                  setQueue(null);
                  setOpened({ runId: run.id, scenarioId: run.scenarioId, driving: false });
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function ScenarioRow({
  s,
  verdict,
  isOpen,
  onToggle,
  locked,
  previewing,
  onRun,
}: {
  s: CatalogueScenario;
  verdict: Verdict | "queued" | null;
  isOpen: boolean;
  onToggle: () => void;
  locked: boolean;
  previewing: boolean;
  onRun: () => void;
}) {
  return (
    <li data-e2e-scenario={s.id} data-e2e-scenario-verdict={verdict ?? "not-run"}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-5 shrink-0">{verdict ? <VerdictIcon v={verdict} /> : null}</span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 cursor-pointer text-left" aria-expanded={isOpen}>
          <span className="flex items-center gap-1.5 truncate font-mono text-[12px]">
            <span className="truncate">
              {s.id} · {s.title}
            </span>
            {s.humanSteps > 0 && (
              <span title="Asks you to pay a Stripe test link, then press Continue" data-e2e-needs-you="">
                <Hand className="size-3 shrink-0 text-warning" aria-label="needs you" />
              </span>
            )}
          </span>
          {s.why && <span className={cn("block text-[11px] text-muted-foreground", !isOpen && "truncate")}>{s.why}</span>}
        </button>
        {s.runnableLive ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 font-mono text-xs"
            disabled={locked}
            data-e2e-run={s.id}
            onClick={onRun}
          >
            {previewing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Run
          </Button>
        ) : (
          <span
            className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            data-e2e-not-live={s.id}
            title={s.liveBlockedBy ?? undefined}
          >
            {s.liveBlockedBy ? "blocked live" : "not a live test"}
          </span>
        )}
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground/50 transition-transform", isOpen && "rotate-180")} />
      </div>
      {isOpen && (
        <div className="space-y-2 px-4 pb-3 pl-12 text-[11px]" data-e2e-scenario-detail="">
          {s.engineRaw && !s.engine && <p className="font-mono text-muted-foreground">Engine as the runner names it: {s.engineRaw}</p>}
          {s.liveBlockedBy && (
            <p className="text-warning" data-e2e-blocked="">
              Not run live today: {s.liveBlockedBy}
            </p>
          )}
          {!s.liveBlockedBy && !s.runnableLive && (
            <p className="text-muted-foreground" data-e2e-other-tiers="">
              Not a live test — its evidence comes from {s.tiers.length ? s.tiers.join(" and ") : "another tier"}
              {s.references.length ? `: ${s.references.join(", ")}` : ""}. The instant tier above runs the same scenarios.
            </p>
          )}
          {s.suspect && (
            <p className="text-foreground" data-e2e-suspect="">
              <span className="font-medium">Suspected defect this may expose:</span> {s.suspect}
            </p>
          )}
          {s.humanSteps > 0 && (
            <p className="text-foreground" data-e2e-needs-you-note="">
              Needs you {s.humanSteps === 1 ? "once" : `${s.humanSteps} times`}: the run stops, shows a Stripe test payment link, and
              waits until you pay it and press Continue.
            </p>
          )}
          <div>
            <p className="font-medium text-foreground">Expected outcome</p>
            {s.expected.length ? (
              <ul className="list-disc pl-4 text-muted-foreground" data-e2e-expected="">
                {s.expected.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <p className="text-warning" data-e2e-no-expected="">
                {s.full || s.stepCount === 0
                  ? "This scenario states no expected outcome — a run of it would prove nothing."
                  : `The runner has not sent this scenario's ${s.stepCount} steps, so its expected outcome cannot be shown.`}
              </p>
            )}
          </div>
          {s.steps.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Steps</p>
              <ol className="list-decimal pl-4 text-muted-foreground" data-e2e-step-specs="">
                {s.steps.map((st) => (
                  <li key={st.id}>{st.label}</li>
                ))}
              </ol>
            </div>
          )}
          {((s.runnableLive && s.references.length > 0) || s.assumes.length > 0) && (
            <p className="font-mono text-muted-foreground">
              {s.runnableLive && s.references.length > 0 ? `Same branch as ${s.references.join(", ")} in the simulator. ` : ""}
              {s.assumes.length > 0 ? `Assumes: ${s.assumes.join(", ")}.` : ""}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Unavailable({ fn, table }: { fn: PieceState; table: PieceState }) {
  // `=== false`, not `!p.ok`: portal compiles with strictNullChecks off, and
  // under it a discriminated union narrows only on an equality check.
  const line = (name: string, p: PieceState) => (
    <li className="flex gap-2" data-e2e-piece={name} data-e2e-piece-state={p.ok === false ? p.kind : "ok"}>
      <span className="shrink-0 font-mono text-foreground">{name}</span>
      <span className={p.ok === false ? "text-muted-foreground" : "text-success"}>{p.ok === false ? p.message : "present"}</span>
    </li>
  );
  return (
    <div role="status" className="space-y-2 rounded-2xl bg-muted/50 px-4 py-3" data-e2e-status="unavailable">
      <p className="text-[13px] font-medium text-foreground">Live test runs are not available here.</p>
      <ul className="space-y-1 text-[11px]">
        {line(E2E_RUNNER_FUNCTION, fn)}
        {line(E2E_RUNS_TABLE, table)}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Nothing in this section can run until both are in place and the runner says it runs on northwind in Stripe test mode. The
        instant tier above works without either.
      </p>
    </div>
  );
}

function RunnerLine({ runner }: { runner: RunnerInfo }) {
  return (
    <div className="space-y-1" data-e2e-runner="">
      <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-success" />
        Runner{runner.version ? ` ${runner.version}` : ""} · tenant {runner.tenantSlug} · Stripe {runner.stripeMode} mode
      </p>
      <ul className="list-disc pl-8 text-[11px] text-muted-foreground" data-e2e-guards="">
        {runner.checks.map((c, i) => (
          <li key={`c${i}`}>
            {c.ok ? "✓" : "✗"} {c.name}
          </li>
        ))}
        {runner.basis.map((b, i) => (
          <li key={`b${i}`}>{b}</li>
        ))}
      </ul>
      {runner.guards.length > 0 && (
        <details className="pl-5 text-[11px] text-muted-foreground" data-e2e-runner-guards="">
          <summary className="cursor-pointer select-none">What the runner enforces ({runner.guards.length} guards, in its own words)</summary>
          <ul className="mt-1 list-disc pl-5">
            {runner.guards.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PreviewPanel({
  label,
  ids,
  preview,
  problems,
  catalogue,
  onCancel,
  onConfirm,
}: {
  label: string;
  ids: string[];
  preview: RunPreview;
  problems: string[];
  catalogue: readonly CatalogueScenario[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const byId = new Map(catalogue.map((s) => [s.id, s] as const));
  const bySid = new Map(preview.items.map((p) => [p.scenarioId, p] as const));
  const humans = ids.reduce((n, id) => n + (byId.get(id)?.humanSteps ?? 0), 0);
  const mark = (ok: boolean) => <span className={ok ? "text-success" : "text-destructive"}>{ok ? "✓" : "✗"}</span>;
  return (
    <div role="region" aria-label="Preview of the live run" data-e2e-preview="" className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-[13px] font-medium text-foreground">Preview — {label}. Nothing has been written yet.</p>
      <p className="text-[11px] text-muted-foreground">
        The runner checked every guard for {ids.length === 1 ? "this scenario" : `these ${ids.length} scenarios`} without writing anything,
        and says below, for each, what a run writes, charges and fires.{ids.length > 1 ? " They run one after another." : ""} Just before
        each one starts, the page asks for a fresh preview of it and stops if anything has changed.
        {humans > 0 ? ` ${humans === 1 ? "One step asks" : `${humans} steps ask`} you to pay a Stripe test link and press Continue.` : ""}
      </p>

      <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground" data-e2e-preview-env="">
        <li>
          {mark(preview.tenantSlug === NORTHWIND && preview.stripeMode === "test")} tenant {preview.tenantSlug ?? "?"} · Stripe{" "}
          {preview.stripeMode ?? "?"} mode
        </li>
        {preview.checks.map((c, i) => (
          <li key={i}>
            {mark(c.ok)} {c.name}
            {!c.ok && c.message ? ` — ${c.message}` : ""}
          </li>
        ))}
        <li data-e2e-preview-refused="">
          {mark(preview.refusedWrites.length === 0)}{" "}
          {preview.refusedWrites.length === 0
            ? "the preview wrote nothing (its read-only client refused no writes)"
            : `the preview tried to write: ${preview.refusedWrites.join(", ")}`}
        </li>
        <li data-e2e-preview-id="">
          {mark(!!preview.previewId)}{" "}
          {preview.previewId
            ? `preview id issued${preview.expiresAt ? `, good until ${new Date(preview.expiresAt).toLocaleTimeString()}` : ""}`
            : "no preview id — the runner would refuse to start this"}
        </li>
      </ul>

      <ol className="space-y-2">
        {ids.map((id) => {
          const p = bySid.get(id);
          return (
            <li key={id} data-e2e-preview-scenario={id} className="space-y-1.5 rounded-2xl bg-muted/40 px-3 py-2">
              <p className="font-mono text-[12px] text-foreground">
                {id} · {byId.get(id)?.title ?? id}
              </p>
              {!p ? (
                <p className="font-mono text-[11px] text-destructive">Not in the preview.</p>
              ) : (
                <>
                  <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground" data-e2e-preview-checks="">
                    <li>
                      {mark(p.runnable.ok)} {p.runnable.name}
                      {!p.runnable.ok && p.runnable.message ? ` — ${p.runnable.message}` : ""}
                    </li>
                    <li>
                      {mark(p.assumptionsOk === true)} northwind&rsquo;s settings match what the expected values assume
                      {p.assumptionsFailed.length ? ` — ${p.assumptionsFailed.join("; ")}` : ""}
                    </li>
                  </ul>
                  {p.writes.length + p.stripe.length + p.crons.length > 0 && (
                    <ul className="space-y-0.5 border-t border-foreground/5 pt-1.5 font-mono text-[11px] text-muted-foreground" data-e2e-preview-writes="">
                      {[...p.writes, ...p.stripe, ...p.crons].map((w, i) => (
                        <li key={i} data-e2e-preview-write={w.where}>
                          <span className="text-foreground">{w.where}</span> — {w.what}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-2xl bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive" data-e2e-preview-problems="">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
          <li>This preview cannot be confirmed.</li>
        </ul>
      )}

      <p className="text-[13px] font-medium text-foreground" data-e2e-confirm-sentence="">
        {CONFIRM_SENTENCE}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="gap-1.5" data-e2e-confirm="" disabled={problems.length > 0} onClick={onConfirm}>
          <Play className="size-3.5" />
          Confirm and run
        </Button>
        <Button type="button" size="sm" variant="outline" data-e2e-cancel="" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function HistoryTable({
  runs,
  catalogue,
  loading,
  error,
  shownId,
  disabled,
  onRefresh,
  onOpen,
}: {
  runs: E2eRun[];
  catalogue: readonly CatalogueScenario[];
  loading: boolean;
  error: string | null;
  shownId: string | null;
  disabled: boolean;
  onRefresh: () => void;
  onOpen: (run: E2eRun) => void;
}) {
  const byId = new Map(catalogue.map((s) => [s.id, s] as const));
  return (
    <div className="space-y-2" data-e2e-history="">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
          <History className="size-3.5 text-muted-foreground" />
          History
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">from {E2E_RUNS_TABLE}</span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1.5 font-mono text-xs" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="font-mono text-[11px] text-destructive">
          The history could not be read: {error}
        </p>
      )}
      {!error && runs.length === 0 && !loading && (
        <p className="font-mono text-[11px] text-muted-foreground" data-e2e-history-empty="">
          No live runs yet.
        </p>
      )}
      {runs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-foreground/5">
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-normal">started</th>
                <th className="px-3 py-1.5 font-normal">scenario</th>
                <th className="px-3 py-1.5 font-normal">checks</th>
                <th className="px-3 py-1.5 font-normal">result</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {runs.map((run) => {
                const v = rowVerdict(run);
                const title = run.scenario?.title ?? byId.get(run.scenarioId)?.title ?? "";
                return (
                  <tr key={run.id} data-e2e-history-row={run.id} className={cn(shownId === run.id && "bg-muted/40")}>
                    <td className="whitespace-nowrap px-3 py-1.5">{run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}</td>
                    <td className="max-w-[18rem] truncate px-3 py-1.5" title={title}>
                      {run.scenarioId}
                      {title ? ` · ${title}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="text-success">{run.passCount ?? "?"} passed</span>
                      {(run.failCount ?? 0) > 0 && <span className="text-destructive"> · {run.failCount} failed</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1" data-e2e-history-verdict={v}>
                        <VerdictIcon v={v} className="size-3.5" />
                        {v}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 font-mono text-[11px]"
                        disabled={disabled}
                        data-e2e-open={run.id}
                        onClick={() => onOpen(run)}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
