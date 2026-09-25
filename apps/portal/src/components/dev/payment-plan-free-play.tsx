"use client";

/**
 * Payment plan simulator — FREE PLAY.
 *
 * Build a plan with the real form, then drive time: every step calls the REAL
 * `runTick` (the cron's own engine) against an in-memory store and a simulated
 * card whose next answer you pick. The plan card underneath is the SAME
 * component the rental page renders, fed from the simulated rows, and its
 * buttons call the same engine operations the edge function calls.
 *
 * WRITES NOTHING. No Supabase client is imported here, no edge function is
 * called, no card is charged: the store is a JavaScript object in this tab and
 * the "card" is `SimulatedProvider`. Reloading the page forgets everything. The
 * /dev blast-radius sentence in dev-page.tsx stays true.
 */

import { useReducer, useRef, useState } from "react";
import { Download, FastForward, Play, RotateCcw, SkipForward, StepForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { PaymentPlanCard } from "@/components/payment-plans/payment-plan-card";
import { PaymentPlanComposer, usePlanComposer } from "@/components/payment-plans/payment-plan-composer";
import { EditPlanDialog } from "@/components/payment-plans/payment-plan-dialogs";
import { Chip, InlineDate, inlineInputCls } from "@/components/payment-plans/sentence-kit";
import { MemoryPlanStore } from "@/lib/payment-plans/memory-store";
import {
  RecordingNotifier,
  SimulatedLinkMinter,
  SimulatedProvider,
  type ChargeOutcome,
  type ChargeRequest,
  type PaymentProvider,
  type ScriptedOutcome,
} from "@/lib/payment-plans/providers";
import {
  collectOccurrenceNow,
  onLinkPaid,
  planFormToRowAndSchedule,
  recordManualPayment,
  releaseOpenLinks,
  runTick,
  sendOccurrenceLink,
  type EngineDeps,
  type TickResult,
} from "@/lib/payment-plans/engine";
import { addHoursToInstant, dueAtUtc, localDateInZone } from "@/lib/payment-plans/dates";
import { draftToPlanForm, type PlanContext, type PlanDraft } from "@/lib/payment-plans-ui/plan-form-model";
import { addDays, formatInstant, formatMoney, parseDollarsToCents, type ISODate } from "@/lib/payment-plans-ui/format";

export const SIM_TZ = "America/New_York";
const SIM = { tenantId: "sim-tenant", rentalId: "sim-rental", customerId: "sim-customer" } as const;

/* ── the card the tester controls ──────────────────────────────────────── */

export const CARD_OUTCOMES: readonly { id: string; label: string; outcome: ScriptedOutcome }[] = [
  { id: "succeed", label: "Succeeds", outcome: "succeed" },
  { id: "insufficient_funds", label: "Insufficient funds", outcome: { decline: "insufficient_funds" } },
  { id: "authentication_required", label: "Needs authentication", outcome: { decline: "authentication_required" } },
  { id: "expired_card", label: "Expired card", outcome: { decline: "expired_card" } },
  { id: "server_error_after_charge", label: "Server error after charge", outcome: "indeterminate_after_charge" },
  { id: "in_use", label: "In use (409)", outcome: "in_use" },
];

/**
 * `SimulatedProvider`, plus one thing: the tester's pick applies to the NEXT
 * new charge (a replay of a key already used gets its stored answer, exactly as
 * Stripe replays an idempotency key). After that it goes back to succeeding.
 */
export class PickableProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  readonly mode = "test" as const;
  readonly account: string | null;
  readonly platformAccount = "uk" as const;
  readonly inner: SimulatedProvider;
  next: ScriptedOutcome | null = null;
  private readonly seen = new Set<string>();

  constructor(account = "acct_sim") {
    this.inner = new SimulatedProvider({ account, mode: "test", fallback: "succeed" });
    this.account = this.inner.account;
  }

  charge(req: ChargeRequest): Promise<ChargeOutcome> {
    if (!this.seen.has(req.idempotencyKey)) {
      this.seen.add(req.idempotencyKey);
      if (this.next) {
        this.inner.queue(req.metadata?.occurrence_id ?? "", [this.next]);
        this.next = null;
      }
    }
    return this.inner.charge(req);
  }
  refund(providerRef: string, amountCents: number, idempotencyKey: string) {
    return this.inner.refund(providerRef, amountCents, idempotencyKey);
  }
  findByAttempt(attemptId: string) {
    return this.inner.findByAttempt(attemptId);
  }
}

interface World {
  store: MemoryPlanStore;
  provider: PickableProvider;
  notifier: RecordingNotifier;
  links: SimulatedLinkMinter;
  deps: EngineDeps;
  ticks: { asOf: string; result: TickResult }[];
  log: { at: string; text: string; tone: "ok" | "error" }[];
  planId: string | null;
  lastLinkPaid: Parameters<typeof onLinkPaid>[1] | null;
  seq: number;
}

function newWorld(owedCents: number, now: string): World {
  const store = new MemoryPlanStore({ rentals: [{ ...SIM, id: SIM.rentalId, owedCents }], now, providerName: "simulated" });
  const provider = new PickableProvider();
  const notifier = new RecordingNotifier();
  const links = new SimulatedLinkMinter();
  return { store, provider, notifier, links, deps: { store, provider, notifier, links }, ticks: [], log: [], planId: null, lastLinkPaid: null, seq: 0 };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Instants are compared as numbers, never as strings. */
const ms = (iso: string) => Date.parse(iso);

/** One line per thing a tick did, in words. */
export function tickWords(t: TickResult, seqOf: (occId: string) => number | undefined): string[] {
  const n = (id: string) => `#${seqOf(id) ?? "?"}`;
  const out: string[] = [];
  for (const r of t.recovered) out.push(`recovered ${n(r.occurrenceId)}: ${r.path.replace(/_/g, " ")} → ${r.outcome}`);
  for (const r of t.reminders) if (r.sent) out.push(`reminder ${n(r.occurrenceId)} (${r.offset > 0 ? "+" : ""}${r.offset}d)`);
  for (const a of t.actions) {
    if (a.action === "noop") continue;
    out.push(
      `${n(a.occurrenceId)} ${a.action.replace(/_/g, " ")}${a.amountCents ? ` ${formatMoney(a.amountCents)}` : ""}${a.idempotencyKey ? ` · ${a.idempotencyKey}` : ""}${a.reason ? ` · ${a.reason}` : ""}`,
    );
    if (a.fallback) out.push(`${n(a.fallback.occurrenceId)} fallback: ${a.fallback.action.replace(/_/g, " ")}`);
  }
  for (const e of t.errors) out.push(`ERROR (${e.stage}): ${e.message}`);
  return out;
}

export function PaymentPlanFreePlay() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [owedInput, setOwedInput] = useState("600.00");
  const [start, setStart] = useState<ISODate>("2026-10-02");
  const [end, setEnd] = useState<ISODate>("2026-10-23");
  const [pick, setPick] = useState<string>("succeed");
  const [outsideInput, setOutsideInput] = useState("100.00");
  const [editOpen, setEditOpen] = useState(false);
  const owedCents = parseDollarsToCents(owedInput) ?? 0;

  const world = useRef<World>(newWorld(owedCents, dueAtUtc(addDays(start, -3), "09:00", SIM_TZ)));
  const w = world.current;

  const ctx: PlanContext = { rentalStart: start, rentalEnd: end > start ? end : null, balanceCents: owedCents };
  const { state, setState, preview } = usePlanComposer(ctx, localDateInZone(w.store.now(), SIM_TZ), undefined);

  const snap = w.planId ? w.store.snapshot() : null;
  const plan = snap?.plans.find((p) => p.id === w.planId) ?? null;
  const occurrences = snap?.occurrences.filter((o) => o.planId === w.planId) ?? [];
  const attempts = snap?.attempts.filter((a) => a.planId === w.planId) ?? [];
  const events = snap?.events.filter((e) => e.planId === w.planId) ?? [];
  const payments = snap?.payments ?? [];
  const today = localDateInZone(w.store.now(), SIM_TZ);
  const seqOf = (id: string) => occurrences.find((o) => o.id === id)?.seq;
  const owedNow = snap?.rentals.find((r) => r.id === SIM.rentalId)?.owedCents ?? owedCents;

  const note = (text: string, tone: "ok" | "error" = "ok") => {
    w.log.unshift({ at: w.store.now(), text, tone });
    if (w.log.length > 200) w.log.pop();
  };

  /** Run an operation; log the outcome; re-render; rethrow so a dialog stays open on failure. */
  const act = async <T,>(label: string, op: () => Promise<T>): Promise<T> => {
    try {
      const r = await op();
      note(label);
      return r;
    } catch (e) {
      note(`${label} — refused: ${msg(e)}`, "error");
      throw e;
    } finally {
      force();
    }
  };

  const tick = async (asOf: string) => {
    w.store.setNow(asOf);
    const result = await runTick(w.deps, { asOf });
    w.ticks.push({ asOf, result });
    const words = tickWords(result, seqOf);
    note(`tick ${formatInstant(asOf, SIM_TZ)}${words.length ? " — " + words.join("; ") : " — nothing to do"}`, result.errors.length ? "error" : "ok");
  };

  /** Move the clock to `target`, ticking at least once a day on the way so reminders fire. */
  const advanceTo = async (target: string) => {
    let guard = 0;
    while (ms(w.store.now()) < ms(target) && guard++ < 800) {
      const step = addHoursToInstant(w.store.now(), 24);
      await tick(ms(step) < ms(target) ? step : new Date(ms(target)).toISOString());
    }
  };

  /** The next instant anything is scheduled to happen, or null. */
  const nextEvent = (): string | null => {
    const now = w.store.now();
    const s = w.store.snapshot();
    const live = s.plans.find((p) => p.id === w.planId);
    if (!live || live.status !== "active") return null;
    const candidates: string[] = [];
    for (const o of s.occurrences.filter((x) => x.planId === w.planId)) {
      if ((o.status === "scheduled" || o.status === "due" || o.status === "partially_paid") && ms(o.dueAt) > ms(now)) candidates.push(o.dueAt);
      if (o.status === "failed" && o.nextAttemptAt && ms(o.nextAttemptAt) > ms(now)) candidates.push(o.nextAttemptAt);
    }
    // Recovery looks at attempts left without an answer for 10 minutes.
    for (const a of s.attempts.filter((x) => x.planId === w.planId)) {
      if ((a.status === "claimed" || a.status === "in_flight" || a.status === "indeterminate") && a.method !== "checkout_link") {
        const due = new Date(Date.parse(a.createdAt) + 601_000).toISOString();
        candidates.push(ms(due) > ms(now) ? due : addHoursToInstant(now, 0.25));
      }
    }
    return candidates.sort((a, b) => ms(a) - ms(b))[0] ?? null;
  };

  const startPlan = async () => {
    if (preview.ok === false) return;
    world.current = newWorld(owedCents, dueAtUtc(addDays(preview.drafts[0].dueDate, -3), "09:00", SIM_TZ));
    const nw = world.current;
    const draft = planFormToRowAndSchedule(draftToPlanForm(preview.plan), {
      ...SIM,
      rentalEnd: ctx.rentalEnd,
      timezone: SIM_TZ,
      currency: "usd",
      paymentProvider: "stripe",
      owedCents: await nw.store.rentalOwedCents(SIM.rentalId),
    });
    nw.planId = await nw.store.createPlan({ plan: draft.plan, occurrences: draft.occurrences, actorId: "sim-operator" });
    nw.log.unshift({ at: nw.store.now(), text: `plan created — ${draft.summary.count} payments, ${formatMoney(draft.summary.totalCents)}`, tone: "ok" });
    force();
  };

  const reset = () => {
    world.current = newWorld(owedCents, dueAtUtc(addDays(start, -3), "09:00", SIM_TZ));
    force();
  };

  const openLink = attempts.find((a) => a.method === "checkout_link" && (a.status === "in_flight" || a.status === "claimed"));
  const lastPlanPayment = [...payments].reverse().find((p) => p.status !== "Refunded");

  const evidence = () => {
    const s = w.store.snapshot();
    const body = {
      kind: "payment-plan-free-play",
      writesToDatabase: false,
      timezone: SIM_TZ,
      generatedAt: new Date().toISOString(),
      clock: s.now,
      ticks: w.ticks,
      log: [...w.log].reverse(),
      store: s,
      provider: { calls: w.provider.inner.calls, charges: w.provider.inner.allCharges(), refunds: w.provider.inner.refunds },
      notifications: w.notifier.sent,
      links: w.links.minted,
    };
    download(`payment-plan-free-play-${s.now.slice(0, 10)}.json`, body);
  };

  return (
    <div className="space-y-5" data-sim-free-play="">
      {!plan ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <label className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">Rental owes $</span>
              <input aria-label="Rental owes" value={owedInput} onChange={(e) => setOwedInput(e.target.value)} className={cn(inlineInputCls, "w-24")} />
            </label>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">from</span>
              <InlineDate label="Rental start" value={start} onChange={setStart} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">to</span>
              <InlineDate label="Rental end" value={end} min={addDays(start, 1)} onChange={setEnd} />
            </span>
            <span className="text-muted-foreground">· {SIM_TZ}, charges at 10:00</span>
          </div>
          <PaymentPlanComposer state={state} onChange={setState} preview={preview} ctx={ctx} currency="usd" today={today} balanceLabel="rental owes" />
          <Button type="button" onClick={() => void startPlan()} disabled={preview.ok === false} className="gap-1.5">
            <Play className="size-3.5" />
            Start the plan
          </Button>
        </>
      ) : (
        <>
          {/* ── the clock ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-3xl bg-muted/40 px-4 py-3 ring-1 ring-foreground/5">
            <span className="mr-1 font-mono text-[12px]" data-sim-clock={w.store.now()}>
              {formatInstant(w.store.now(), SIM_TZ)} · owed {formatMoney(owedNow)}
            </span>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => void act("advance a day", () => advanceTo(addHoursToInstant(w.store.now(), 24)))}>
              <StepForward className="size-3.5" /> Advance a day
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={!nextEvent()}
              onClick={() => {
                const t = nextEvent();
                if (t) void act("to the next due date", () => advanceTo(t));
              }}
            >
              <SkipForward className="size-3.5" /> To the next due date
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={!nextEvent()}
              onClick={() =>
                void act("to the end", async () => {
                  let t = nextEvent();
                  let guard = 0;
                  while (t && guard++ < 200) {
                    await advanceTo(t);
                    t = nextEvent();
                  }
                })
              }
            >
              <FastForward className="size-3.5" /> To the end
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void act("tick now", () => tick(w.store.now()))}>
              Tick now
            </Button>
          </div>

          {/* ── the card and the customer ─────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">Next card charge</p>
            <div className="flex flex-wrap gap-1.5">
              {CARD_OUTCOMES.map((c) => (
                <Chip
                  key={c.id}
                  active={pick === c.id}
                  data-sim-outcome={c.id}
                  onClick={() => {
                    setPick(c.id);
                    w.provider.next = c.id === "succeed" ? null : c.outcome;
                  }}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Applies to the next NEW charge only, then the card goes back to succeeding. A replayed key gets its stored answer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">Customer:</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!openLink}
              title={openLink ? undefined : "No payment link is out."}
              onClick={() =>
                void act(`customer paid the link for #${openLink ? seqOf(openLink.occurrenceId) : "?"}`, async () => {
                  if (!openLink) return;
                  w.seq += 1;
                  const input = {
                    attemptId: openLink.id,
                    providerRef: `sim_pi_link_${w.seq}`,
                    amountCents: openLink.amountCents,
                    paidAt: w.store.now(),
                    checkoutSessionId: `cs_test_sim${w.seq}`,
                    paymentMethodRef: `pm_sim_${w.seq}`,
                    providerMode: "test" as const,
                  };
                  w.lastLinkPaid = input;
                  await onLinkPaid(w.deps, input);
                })
              }
            >
              Pays the link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!w.lastLinkPaid}
              title="Deliver the same checkout webhook again — it must not record twice."
              onClick={() => void act("webhook delivered again", async () => void (w.lastLinkPaid && (await onLinkPaid(w.deps, w.lastLinkPaid))))}
            >
              Webhook again
            </Button>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-muted-foreground">pays $</span>
              <input aria-label="Paid outside the plan" value={outsideInput} onChange={(e) => setOutsideInput(e.target.value)} className={cn(inlineInputCls, "w-20")} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void act(`customer paid ${formatMoney(parseDollarsToCents(outsideInput) ?? 0)} outside the plan`, async () => {
                    const c = parseDollarsToCents(outsideInput);
                    if (!c) throw new Error("Enter an amount");
                    await w.store.recordExternalPayment(SIM.rentalId, c, today);
                  })
                }
              >
                outside the plan
              </Button>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!lastPlanPayment}
              onClick={() =>
                void act(`refunded ${lastPlanPayment ? formatMoney(lastPlanPayment.amountCents - lastPlanPayment.refundCents) : ""}`, async () => {
                  if (!lastPlanPayment) return;
                  await w.store.refundPayment(lastPlanPayment.id, lastPlanPayment.amountCents - lastPlanPayment.refundCents);
                })
              }
            >
              Refund the last payment
            </Button>
          </div>

          <PaymentPlanCard
            plan={plan}
            occurrences={occurrences}
            attempts={attempts}
            events={events}
            currency="usd"
            today={today}
            accounts={null}
            badge={<span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">simulated</span>}
            actions={{
              retry: (o) => act(`retried #${o.seq}`, () => collectOccurrenceNow(w.deps, o.id, w.store.now())),
              sendLink: (o) => act(`sent a link for #${o.seq}`, () => sendOccurrenceLink(w.deps, o.id, w.store.now())),
              recordPayment: (o, input) =>
                act(`recorded ${formatMoney(input.amountCents)} ${input.method} on #${o.seq}`, () =>
                  recordManualPayment(w.deps, {
                    occurrenceId: o.id,
                    amountCents: input.amountCents,
                    method: input.method,
                    paymentDate: input.date,
                    note: input.note || null,
                    actorId: "sim-operator",
                    asOf: w.store.now(),
                  }),
                ),
              move: (o, to) => act(`moved #${o.seq} to ${to}`, () => w.store.moveOccurrence(o.id, to, "sim-operator")),
              // As payment-plan-manage does: release an open link, then skip.
              skip: (o) =>
                act(`skipped #${o.seq}`, async () => {
                  await releaseOpenLinks(w.store, o.id, "Operator skipped this payment");
                  await w.store.skipOccurrence(o.id, "sim-operator");
                }),
              edit: () => setEditOpen(true),
              pause: () => act("paused the plan", () => w.store.pausePlan(plan.id, "sim-operator", "Paused in the simulator")),
              resume: () => act("resumed the plan", () => w.store.resumePlan(plan.id, "sim-operator")),
              cancel: () => act("cancelled the plan", () => w.store.cancelPlan(plan.id, "sim-operator", "Cancelled in the simulator")),
            }}
          />

          <EditPlanDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            plan={plan}
            occurrences={occurrences}
            ctx={{ rentalStart: start, rentalEnd: ctx.rentalEnd, balanceCents: Math.max(0, owedNow) }}
            currency="usd"
            today={today}
            onSave={(d: PlanDraft, reason) =>
              act(`changed the plan (${reason})`, async () => {
                const owed = await w.store.rentalOwedCents(SIM.rentalId);
                const next = planFormToRowAndSchedule(draftToPlanForm(d), {
                  ...SIM,
                  rentalEnd: ctx.rentalEnd,
                  timezone: SIM_TZ,
                  currency: "usd",
                  paymentProvider: "stripe",
                  owedCents: owed,
                });
                await w.store.replaceFuture({
                  planId: plan.id,
                  expectedVersion: plan.version,
                  planPatch: {
                    rule: next.plan.rule,
                    amount: next.plan.amount,
                    collectionMethod: next.plan.collectionMethod,
                    reminderOffsets: next.plan.reminderOffsets,
                  },
                  occurrences: next.occurrences,
                  actorId: "sim-operator",
                  reason,
                });
              })
            }
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={evidence} data-sim-evidence="">
              <Download className="size-3.5" /> Download evidence
            </Button>
            <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={reset}>
              <RotateCcw className="size-3.5" /> Start over
            </Button>
          </div>

          {/* ── what happened ──────────────────────────────────────────── */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">Log</p>
            <ol className="max-h-64 space-y-0.5 overflow-y-auto no-scrollbar rounded-3xl bg-muted/40 px-4 py-3 font-mono text-[11px] ring-1 ring-foreground/5" data-sim-log="">
              {w.log.length === 0 ? (
                <li className="text-muted-foreground">Nothing yet. Advance the clock.</li>
              ) : (
                w.log.map((l, i) => (
                  <li key={i} className={l.tone === "error" ? "text-destructive" : undefined}>
                    <span className="text-muted-foreground">{formatInstant(l.at, SIM_TZ)}</span> {l.text}
                  </li>
                ))
              )}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

/** Hand the tester a JSON file. Client-side only — nothing leaves the browser. */
export function download(name: string, body: unknown) {
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

