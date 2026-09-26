"use client";

/**
 * Live test runs, as evidence: every scenario run's steps as they happen, every
 * check with what was expected and what actually happened, links that open the
 * REAL screens for the fixture the run created, and the whole thing as a JSON
 * file. Used for the runs going now and for any run reopened from the history
 * — the same view for both, so what the lead reopens tomorrow is what he
 * watched today.
 *
 * Verdicts are this page's reading of the evidence (`runVerdict`), not the
 * runner's say-so: a failed check or a refused step fails the run, and a
 * "passed" with no checks is shown as unproven.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Circle, Download, Hand, Loader2, Minus, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { fetchRentalNumber, type RunWithSteps } from "@/hooks/use-e2e-runs";
import {
  buildEvidence,
  evidenceFileName,
  financesHref,
  isMoney,
  isTerminal,
  rentalHref,
  runCounts,
  runTimeline,
  runVerdict,
  showActual,
  showValue,
  type CatalogueScenario,
  type RunFixture,
  type RunPreview,
  type RunnerInfo,
  type StepStatus,
  type Verdict,
} from "./e2e-runner-contract";

type Shown = Verdict | StepStatus | "queued";

const WORDS: Record<Shown, string> = {
  pending: "Waiting",
  queued: "Queued",
  running: "Running",
  waiting: "Waiting for you",
  passed: "Passed",
  failed: "Failed",
  error: "Error",
  refused: "Refused",
  skipped: "Not reached",
  aborted: "Stopped",
  unproven: "Unproven",
  unknown: "Unknown status",
};

const TONE: Record<Shown, string> = {
  pending: "text-muted-foreground",
  queued: "text-muted-foreground",
  running: "text-primary",
  waiting: "text-warning",
  passed: "text-success",
  failed: "text-destructive",
  error: "text-destructive",
  refused: "text-destructive",
  skipped: "text-muted-foreground",
  aborted: "text-destructive",
  unproven: "text-warning",
  unknown: "text-muted-foreground",
};

export function VerdictIcon({ v, className }: { v: Shown; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  switch (v) {
    case "passed":
      return <Check className={cn(c, "text-success")} aria-label="passed" />;
    case "failed":
    case "error":
    case "refused":
    case "aborted":
      return <X className={cn(c, "text-destructive")} aria-label={v} />;
    case "running":
      return <Loader2 className={cn(c, "animate-spin text-primary")} aria-label="running" />;
    case "waiting":
      return <Hand className={cn(c, "text-warning")} aria-label="waiting for you" />;
    case "unproven":
      return <TriangleAlert className={cn(c, "text-warning")} aria-label="unproven" />;
    case "skipped":
      return <Minus className={cn(c, "text-muted-foreground")} aria-label="not reached" />;
    default:
      return <Circle className={cn(c, "text-muted-foreground/50")} aria-label="waiting" />;
  }
}

/**
 * Save the evidence as a file the tester chooses to keep. The same ten lines
 * as the simulator's `download` in payment-plan-free-play.tsx, kept here
 * rather than imported: that module pulls in the whole plan composer
 * (`components/payment-plans/**`), and this report should not break when the
 * composer is mid-edit.
 */
export function downloadJson(name: string, body: unknown) {
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const when = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function ExternalLink({ href, children, testId }: { href: string; children: ReactNode; testId: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-e2e-link={testId}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground ring-1 ring-foreground/5 hover:text-primary"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  );
}

/**
 * The fixture's rental number, for the Finances link: from the run's own
 * fixture record when the runner wrote it there, else read once (a GET).
 */
function useFixtureWithNumber(tenantId: string | null, fixture: RunFixture | null): RunFixture | null {
  const [number, setNumber] = useState<string | null>(null);
  const rentalId = fixture?.rentalId ?? null;
  const known = fixture?.rentalNumber ?? null;
  useEffect(() => {
    if (known || !rentalId || !tenantId) return;
    let live = true;
    void fetchRentalNumber(tenantId, rentalId).then((n) => {
      if (live) setNumber(n);
    });
    return () => {
      live = false;
    };
  }, [tenantId, rentalId, known]);
  if (!fixture) return null;
  return { ...fixture, rentalNumber: known ?? number };
}

export interface ReportEntry {
  scenarioId: string;
  /** Null while the queue has not reached this scenario, or before its row is found. */
  runId: string | null;
  /** Its `run` request is in flight (the runner is making the fixture and taking the first steps). */
  starting?: boolean;
}

export function E2eRunReport({
  label,
  entries,
  byId,
  watching,
  gaveUp,
  error,
  catalogue,
  runner,
  confirmedPreview,
  startedUnder,
  tenantId,
  onClose,
  onContinue,
  onAbort,
  onCloseFixture,
  queueNote,
  deferNote,
}: {
  label: string;
  entries: readonly ReportEntry[];
  byId: Record<string, RunWithSteps>;
  watching: boolean;
  gaveUp: boolean;
  error: string | null;
  catalogue: readonly CatalogueScenario[];
  runner: RunnerInfo | null;
  confirmedPreview: RunPreview | null;
  /** The fresh preview each run was started under (scenario id → preview_id, G12), for the evidence. */
  startedUnder?: Readonly<Record<string, string>>;
  tenantId: string | null;
  onClose?: () => void;
  /** Only while runs are being driven; the button shows beside a waiting step. */
  onContinue?: (runId: string) => Promise<void>;
  /** Stop an unfinished run (the runner parks its fixture). */
  onAbort?: (runId: string) => Promise<void>;
  /** Close a finished run's fixture rental. */
  onCloseFixture?: (runId: string) => Promise<void>;
  /** A line about the queue (stopped, failed to start the next one…). */
  queueNote?: string | null;
  /** The runner asked the page to hold off (a real cron's window, G8). */
  deferNote?: string | null;
}) {
  const byScenario = new Map(catalogue.map((s) => [s.id, s] as const));
  const loaded = entries
    .map((e) => (e.runId ? byId[e.runId] : undefined))
    .filter((d): d is RunWithSteps => !!d && !!d.run);
  const verdicts = entries.map((e) => {
    const d = e.runId ? byId[e.runId] : undefined;
    return d?.run ? runVerdict(d.run, d.steps) : e.runId || e.starting ? "running" : "queued";
  });
  const tally = {
    passed: verdicts.filter((v) => v === "passed").length,
    failed: verdicts.filter((v) => v === "failed" || v === "error" || v === "aborted").length,
    unproven: verdicts.filter((v) => v === "unproven" || v === "unknown").length,
  };
  const togo = entries.length - tally.passed - tally.failed - tally.unproven;
  const overall: Shown =
    tally.failed > 0 ? "failed" : togo > 0 ? (verdicts.includes("waiting") ? "waiting" : "running") : tally.unproven > 0 ? "unproven" : "passed";

  return (
    <div data-e2e-report="" data-e2e-verdict={overall} className="space-y-3 rounded-3xl bg-muted/40 p-4 ring-1 ring-foreground/5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictIcon v={overall} />
        <p className="font-mono text-[12px] text-foreground">
          {label} · <span className={TONE[overall]}>{WORDS[overall]}</span>
          <span className="text-muted-foreground" data-e2e-counts="">
            {" "}
            · {tally.passed} passed · {tally.failed} failed
            {tally.unproven > 0 && ` · ${tally.unproven} unproven`}
            {togo > 0 && ` · ${togo} to go`}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {loaded.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              data-e2e-download=""
              onClick={() =>
                downloadJson(
                  evidenceFileName(loaded.map((d) => d.run!.id)),
                  buildEvidence({
                    runs: loaded.map((d) => ({ run: d.run!, steps: d.steps })),
                    runner,
                    catalogue,
                    confirmedPreview,
                    startedUnder,
                  }),
                )
              }
            >
              <Download className="size-3.5" /> Download evidence
            </Button>
          )}
          {onClose && (
            <Button type="button" size="sm" variant="ghost" className="h-7 font-mono text-xs" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {watching && <p className="font-mono text-[11px] text-muted-foreground">Updating live.</p>}
      {deferNote && (
        <p role="status" className="font-mono text-[11px] text-muted-foreground" data-e2e-defer-note="">
          {deferNote}
        </p>
      )}
      {queueNote && (
        <p role="status" className="font-mono text-[11px] text-muted-foreground" data-e2e-queue-note="">
          {queueNote}
        </p>
      )}
      {gaveUp && (
        <p role="status" className="font-mono text-[11px] text-warning">
          Stopped watching after 30 minutes with a run still not finished. Reopen it from the history to look again.
        </p>
      )}
      {error && (
        <p role="alert" className="font-mono text-[11px] text-destructive">
          The last update could not be read: {error}
        </p>
      )}

      <ol className="space-y-2">
        {entries.map((e) => (
          <RunCard
            key={`${e.scenarioId}:${e.runId ?? "queued"}`}
            entry={e}
            data={e.runId ? byId[e.runId] : undefined}
            spec={byScenario.get(e.scenarioId) ?? null}
            tenantId={tenantId}
            onContinue={onContinue}
            onAbort={onAbort}
            onCloseFixture={onCloseFixture}
          />
        ))}
      </ol>
    </div>
  );
}

function RunCard({
  entry,
  data,
  spec,
  tenantId,
  onContinue,
  onAbort,
  onCloseFixture,
}: {
  entry: ReportEntry;
  data: RunWithSteps | undefined;
  spec: CatalogueScenario | null;
  tenantId: string | null;
  onContinue?: (runId: string) => Promise<void>;
  onAbort?: (runId: string) => Promise<void>;
  onCloseFixture?: (runId: string) => Promise<void>;
}) {
  const run = data?.run ?? null;
  const steps = data?.steps ?? [];
  const v: Shown = run ? runVerdict(run, steps) : entry.runId || entry.starting ? "running" : "queued";
  const fixture = useFixtureWithNumber(tenantId, run?.fixture ?? null);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [acting, setActing] = useState<"abort" | "close" | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const act = async (kind: "abort" | "close") => {
    const fn = kind === "abort" ? onAbort : onCloseFixture;
    if (!fn || !entry.runId) return;
    setActing(kind);
    setActError(null);
    try {
      await fn(entry.runId);
    } catch (e) {
      setActError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  };
  const canAbort = !!onAbort && !!run && !isTerminal(run.status);
  const canClose = !!onCloseFixture && !!run && isTerminal(run.status) && !!run.fixture?.rentalId && !run.fixtureClosedAt;
  const title = run?.scenario?.title ?? spec?.title ?? entry.scenarioId;
  const counts = runCounts(steps);
  const timeline = run ? runTimeline(run, steps, spec) : [];
  const rental = fixture ? rentalHref(fixture) : null;
  const billed = fixture ? financesHref(fixture, "billed") : null;
  const received = fixture ? financesHref(fixture, "received") : null;
  // Only once the run is over: mid-run the row and its steps are written one after the other.
  const countsDisagree =
    !!run &&
    isTerminal(run.status) &&
    run.passCount !== null &&
    run.failCount !== null &&
    (run.passCount !== counts.passed || run.failCount !== counts.failed) &&
    steps.length > 0;

  const pressContinue = async () => {
    if (!onContinue || !entry.runId) return;
    setContinuing(true);
    setContinueError(null);
    try {
      await onContinue(entry.runId);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : String(e));
    } finally {
      setContinuing(false);
    }
  };

  return (
    <li
      data-e2e-result={entry.scenarioId}
      data-e2e-run-id={entry.runId ?? ""}
      data-e2e-verdict={v}
      className="space-y-2 rounded-2xl bg-card px-3 py-2.5 ring-1 ring-foreground/5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <VerdictIcon v={v} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {entry.scenarioId} · {title}
        </span>
        {steps.length > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {counts.passed} check{counts.passed === 1 ? "" : "s"} passed
            {counts.failed > 0 && <span className="text-destructive"> · {counts.failed} failed</span>}
          </span>
        )}
        <span className={cn("font-mono text-[11px]", TONE[v])}>{WORDS[v]}</span>
      </div>

      {!run && (
        <p role="status" className="pl-6 font-mono text-[11px] text-muted-foreground">
          {entry.runId
            ? `Waiting for the runner to record this run (dev_sim_runs row ${entry.runId})…`
            : entry.starting
              ? "Starting — the runner is creating the fixture (a customer, a Stripe TEST card, the rental) and taking the first steps. This first request can take up to two minutes."
              : "Queued — starts when the one before it finishes."}
        </p>
      )}
      {run && (
        <p className="pl-6 font-mono text-[10px] text-muted-foreground/80">
          run {run.id.slice(0, 8)}
          {run.createdAt ? ` · started ${when(run.createdAt)}` : ""}
          {run.finishedAt ? ` · finished ${when(run.finishedAt)}` : ""}
          {run.fixtureClosedAt ? ` · fixture closed ${when(run.fixtureClosedAt)}` : ""}
        </p>
      )}
      {(canAbort || canClose) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {canAbort && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              data-e2e-abort={entry.runId ?? ""}
              disabled={acting !== null}
              onClick={() => void act("abort")}
            >
              {acting === "abort" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Stop this run
            </Button>
          )}
          {canClose && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 font-mono text-xs"
              data-e2e-close-fixture={entry.runId ?? ""}
              title="Marks the fixture rental Closed and turns its engines off. Its money rows stay, as evidence."
              disabled={acting !== null}
              onClick={() => void act("close")}
            >
              {acting === "close" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Close the fixture rental
            </Button>
          )}
          {actError && (
            <span role="alert" className="font-mono text-[11px] text-destructive" data-e2e-act-error="">
              {actError}
            </span>
          )}
        </div>
      )}

      {(rental || billed || received) && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {rental && (
            <ExternalLink href={rental} testId="rental">
              Open the rental
            </ExternalLink>
          )}
          {billed && (
            <ExternalLink href={billed} testId="finances-billed">
              Finances · Billed
            </ExternalLink>
          )}
          {received && (
            <ExternalLink href={received} testId="finances-received">
              Finances · Received
            </ExternalLink>
          )}
        </div>
      )}

      {timeline.length > 0 && (
        <ol className="space-y-1.5 pl-6" data-e2e-steps="">
          {timeline.map((t) => (
            <li key={t.index} data-e2e-step={t.index} data-e2e-step-status={t.status} className="space-y-1">
              <div className="flex items-start gap-2">
                <VerdictIcon v={t.status} className="mt-px size-3.5" />
                <span className="min-w-0 flex-1 text-[11px]">
                  {t.label}
                  {t.detail && <span className="block font-mono text-[10px] text-destructive">{t.detail}</span>}
                </span>
                {t.at && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{when(t.at)}</span>}
              </div>
              {t.waiting && (
                <div className="ml-5 space-y-1.5 rounded-xl bg-warning/10 px-3 py-2" data-e2e-waiting={t.index}>
                  {t.waiting.say && <p className="text-[11px] text-foreground">{t.waiting.say}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.waiting.url && (
                      <ExternalLink href={t.waiting.url} testId="human">
                        Open the payment link (Stripe test mode)
                      </ExternalLink>
                    )}
                    {onContinue && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1.5 font-mono text-xs"
                        data-e2e-continue={t.index}
                        disabled={continuing}
                        onClick={() => void pressContinue()}
                      >
                        {continuing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Continue
                      </Button>
                    )}
                  </div>
                  {continueError && (
                    <p role="alert" className="font-mono text-[11px] text-destructive" data-e2e-continue-error="">
                      Continue was not accepted: {continueError}
                    </p>
                  )}
                </div>
              )}
              {t.assertions.length > 0 && (
                <table className="ml-5 w-[calc(100%-1.25rem)] text-left font-mono text-[11px]" data-e2e-checks="">
                  <thead className="text-muted-foreground/70">
                    <tr>
                      <th className="w-5 pb-1" />
                      <th className="pb-1 pr-3 font-normal">check</th>
                      <th className="pb-1 pr-3 font-normal">expected</th>
                      <th className="pb-1 font-normal">actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.assertions.map((a, i) => (
                      <tr key={i} className="align-top" data-e2e-check={a.pass ? "pass" : "fail"}>
                        <td className={a.pass ? "text-success" : "text-destructive"}>{a.pass ? "✓" : "✗"}</td>
                        <td className="pr-3">{a.label}</td>
                        <td className="break-all pr-3 text-muted-foreground">
                          {showValue(a.expected)}
                          {a.math && !isMoney(a.expected) && <span className="block text-[10px] text-muted-foreground/70">{a.math}</span>}
                        </td>
                        <td className={cn("break-all", !a.pass && "text-destructive")}>{showActual(a.expected, a.actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ol>
      )}

      {v === "unproven" && (
        <p className="pl-6 font-mono text-[11px] text-warning">
          The runner reported a pass with no checks recorded. That proves nothing, so it is not counted as passed.
        </p>
      )}
      {run && run.status === "passed" && v === "failed" && (
        <p role="alert" className="pl-6 font-mono text-[11px] text-destructive">
          The runner marked this run passed, but the evidence here does not support it — it is shown as failed.
        </p>
      )}
      {countsDisagree && (
        <p role="alert" className="pl-6 font-mono text-[11px] text-warning" data-e2e-count-mismatch="">
          The run row says {run!.passCount} passed / {run!.failCount} failed; its step rows hold {counts.passed} / {counts.failed}. The
          step rows are what is shown.
        </p>
      )}
      {run?.error && (
        <p role="alert" className="pl-6 font-mono text-[11px] text-destructive">
          The runner reported: {run.error}
        </p>
      )}
    </li>
  );
}
