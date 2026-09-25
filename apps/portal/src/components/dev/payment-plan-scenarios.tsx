"use client";

/**
 * Payment plan simulator — SCENARIOS.
 *
 * The list is `SCENARIOS` from `lib/payment-plans/scenarios.ts` — the SAME list
 * the vitest suite runs ("However you test it, make sure I can test it that
 * same way"). Run executes one through `runScenario`, which drives the real
 * engine against a fresh in-memory store; every assertion comes back with what
 * was expected, what happened, and pass/fail, and the whole run can be saved as
 * JSON evidence.
 *
 * WRITES NOTHING: `runScenario` builds its own memory store per run. No
 * Supabase client is imported here.
 */

import { useState } from "react";
import { Check, ChevronDown, Download, Loader2, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { PaymentPlanCard } from "@/components/payment-plans/payment-plan-card";
import { SCENARIOS, runScenario, type ScenarioEvidence, type ScenarioRun } from "@/lib/payment-plans/scenarios";
import { localDateInZone } from "@/lib/payment-plans/dates";
import { download } from "./payment-plan-free-play";

type Scenario = (typeof SCENARIOS)[number];

/** A run's end state — the plan and its rows as the engine left them — so the real card can show it. */
function endStateOf(run: ScenarioRun): ScenarioEvidence | null {
  const e = run.evidence as ScenarioEvidence | null | undefined;
  return e && e.plan && Array.isArray(e.occurrences) ? e : null;
}

/** The scenario clock's last instant: its final tick. */
const lastTickAt = (e: ScenarioEvidence) => e.ticks.at(-1)?.asOf ?? null;

export function PaymentPlanScenarios() {
  const [runs, setRuns] = useState<Record<string, ScenarioRun | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const runOne = async (s: Scenario) => {
    try {
      const r = await Promise.resolve(runScenario(s));
      setRuns((prev) => ({ ...prev, [s.id]: r }));
      return r;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setRuns((prev) => ({ ...prev, [s.id]: { error } }));
      return null;
    }
  };

  const runAll = async () => {
    setBusy("all");
    for (const s of SCENARIOS) await runOne(s);
    setBusy(null);
  };

  const done = SCENARIOS.map((s) => runs[s.id]).filter(Boolean);
  const passed = done.filter((r) => r && "pass" in r && r.pass).length;
  const failed = done.length - passed;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3" data-sim-scenarios="">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void runAll()} disabled={busy !== null} className="gap-1.5" data-sim-run-all="">
          {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run all
        </Button>
        {done.length > 0 && (
          <>
            <span className="font-mono text-[12px]" data-sim-summary="">
              {SCENARIOS.length} scenarios · <span className="text-success">{passed} passed</span>
              {failed > 0 && (
                <>
                  {" "}
                  · <span className="text-destructive">{failed} failed</span>
                </>
              )}
              {done.length < SCENARIOS.length && ` · ${SCENARIOS.length - done.length} not run`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                download(`payment-plan-scenarios-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`, {
                  kind: "payment-plan-scenarios",
                  writesToDatabase: false,
                  generatedAt: new Date().toISOString(),
                  runs: SCENARIOS.map((s) => ({ id: s.id, title: s.title, run: runs[s.id] ?? null })),
                })
              }
            >
              <Download className="size-3.5" /> Download evidence
            </Button>
          </>
        )}
      </div>

      <ol className="divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
        {SCENARIOS.map((s) => {
          const r = runs[s.id];
          const ok = r && "pass" in r ? r.pass : null;
          const isOpen = open.has(s.id);
          const end = r && "pass" in r ? endStateOf(r) : null;
          return (
            <li key={s.id} data-sim-scenario={s.id} data-sim-result={ok === null ? (r ? "error" : "not-run") : ok ? "pass" : "fail"}>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 shrink-0">
                  {ok === true ? (
                    <Check className="size-4 text-success" />
                  ) : ok === false || (r && "error" in r) ? (
                    <X className="size-4 text-destructive" />
                  ) : null}
                </span>
                <button type="button" onClick={() => toggle(s.id)} className="min-w-0 flex-1 cursor-pointer text-left" aria-expanded={isOpen}>
                  <span className="block truncate font-mono text-[12px]">
                    {s.id} · {s.title}
                  </span>
                  {s.why && <span className={cn("block text-[11px] text-muted-foreground", !isOpen && "truncate")}>{s.why}</span>}
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 font-mono text-xs"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(s.id);
                    await runOne(s);
                    setBusy(null);
                    setOpen((prev) => new Set(prev).add(s.id));
                  }}
                >
                  {busy === s.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Run
                </Button>
                <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground/50 transition-transform", isOpen && "rotate-180")} />
              </div>
              {isOpen && r && (
                <div className="space-y-3 px-4 pb-4 pl-12">
                  {"error" in r ? (
                    <p role="alert" className="font-mono text-[11px] text-destructive">
                      The scenario threw: {r.error}
                    </p>
                  ) : (
                    <>
                      <table className="w-full text-left font-mono text-[11px]" data-sim-assertions="">
                        <thead className="text-muted-foreground/70">
                          <tr>
                            <th className="w-5 pb-1" />
                            <th className="pb-1 pr-3 font-normal">check</th>
                            <th className="pb-1 pr-3 font-normal">expected</th>
                            <th className="pb-1 font-normal">actual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.assertions.map((a, i) => (
                            <tr key={i} className="align-top" data-sim-assertion={a.pass ? "pass" : "fail"}>
                              <td className={a.pass ? "text-success" : "text-destructive"}>{a.pass ? "✓" : "✗"}</td>
                              <td className="pr-3">{a.label}</td>
                              <td className="break-all pr-3 text-muted-foreground">{show(a.expected)}</td>
                              <td className={cn("break-all", !a.pass && "text-destructive")}>{show(a.actual)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {end && end.plan && (
                        <PaymentPlanCard
                          plan={end.plan}
                          occurrences={end.occurrences}
                          attempts={end.attempts}
                          events={end.events}
                          currency="usd"
                          today={localDateInZone(lastTickAt(end) ?? `${end.plan.rule.anchor}T12:00:00.000Z`, end.plan.timezone)}
                          accounts={null}
                          badge={<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">end state</span>}
                        />
                      )}
                      {end?.error && (
                        <p role="alert" className="font-mono text-[11px] text-destructive">
                          {end.error}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
