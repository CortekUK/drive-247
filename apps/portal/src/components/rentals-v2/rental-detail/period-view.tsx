"use client";

/**
 * A period that already exists, opened from its Management card — the same
 * layout as the extension flow: the rail carries its four steps with their
 * answers (`periodValues`), the pane shows the step the URL names. No footer:
 * the rail moves between steps, and the Original booking card leads back.
 *
 * Read-only for now: each step says what this period was set up with. The
 * periods themselves are northwind preview data (rail-preview.ts) until real
 * extensions are read.
 *
 * Island UI: every step fills the pane end to end — a row of facts on top,
 * then two cards side by side that take the rest of the height and spread
 * their rows through it. Nothing scrolls, nothing ends early.
 */

import { CalendarDays, Check, Clock, Eye, FileSignature, Mail, Minus, PenLine, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyHint, Panel, money } from "./_kit";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import {
  EXTENSION_STEPS, EXTENSION_TITLE, shortDay,
  type ExtensionStepId, type PeriodView as PeriodViewState,
} from "./extension-flow";
import { previewPeriods, type PeriodCharge, type PreviewPeriod } from "./rail-preview";

const longDay = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      })
    : "—";

const clock = (t: string | null | undefined) => {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  if (!m) return "Time not set";
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

/** What each step says in the rail for this period. */
export function periodValues(p: PreviewPeriod): Record<ExtensionStepId, string> {
  const paid = p.payments.charges.filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0);
  const due = p.payments.charges.find((c) => c.status === "due");
  return {
    when: `${shortDay(p.start)} → ${p.end ? shortDay(p.end) : `every ${p.cadence}`}`,
    agreement: p.agreement.status === "signed" ? "Signed" : "Awaiting signature",
    insurance: p.insurance.policy,
    payments: p.cadence
      ? `${money(p.payments.total)} / ${p.cadence}`
      : due
        ? `${money(due.amount)} due`
        : `Paid ${money(paid)}`,
  };
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

const BOX = "flex min-h-0 flex-col rounded-3xl bg-card p-5 ring-1 ring-foreground/5 dark:ring-foreground/10";
const H = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70";
const local = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const iso = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (isoDay: string, n: number) => {
  const d = local(isoDay);
  d.setDate(d.getDate() + n);
  return iso(d);
};

/** The step's frame: facts on top, two cards filling the rest. */
function Frame({ top, left, right }: { top: React.ReactNode; left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid shrink-0 grid-cols-3 gap-3">{top}</div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        {left}
        {right}
      </div>
    </div>
  );
}

function Fact({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3", accent ? "border-primary/20 bg-primary/[0.06]" : "border-transparent bg-card")}>
      <p
        className={cn(
          "text-[10.5px] font-semibold uppercase tracking-wider",
          accent ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground/70"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-[16px] font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Status({ tone, children }: { tone: "good" | "wait" | "plan"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        tone === "good" && "bg-success/10 text-success",
        tone === "wait" && "bg-warning/10 text-warning",
        tone === "plan" && "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone === "good" ? "bg-success" : tone === "wait" ? "bg-warning" : "bg-primary")} />
      {children}
    </span>
  );
}

/** Rows that share the card's height evenly, so a card never ends early. */
function Rows({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between divide-y divide-foreground/[0.06]">{children}</div>;
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-right text-[13px] font-medium">{value}</span>
    </div>
  );
}

/* ── the rental, as a chain ──────────────────────────────────────────────── */

type Link = { id: string; label: string; start: string; end: string; open?: boolean };

function chainOf(detail: RentalDetailV2): Link[] {
  const r = detail.rental;
  const out: Link[] = [];
  if (r.start_date && r.end_date) out.push({ id: "booking", label: "Original booking", start: String(r.start_date).slice(0, 10), end: String(r.end_date).slice(0, 10) });
  for (const x of previewPeriods(detail)) {
    out.push({
      id: x.id,
      label: x.kind === "auto" ? "Auto extension" : "Manual extension",
      start: x.start,
      end: x.end ?? addDays(x.next ?? x.start, 7),
      open: !x.end,
    });
  }
  return out;
}

/** Every period on one axis, this one solid. */
function ChainCard({ detail, current }: { detail: RentalDetailV2; current: string }) {
  const chain = chainOf(detail);
  if (!chain.length) return <div className={BOX} />;
  const from = local(chain[0].start).getTime();
  const to = local(chain[chain.length - 1].end).getTime();
  const span = Math.max(1, to - from);
  const pct = (d: string) => ((local(d).getTime() - from) / span) * 100;
  return (
    <div className={BOX}>
      <p className={H}>In the rental</p>
      <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between">
        {chain.map((l) => {
          const on = l.id === current;
          return (
            <div key={l.id} className="flex flex-1 flex-col justify-center gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("text-[12.5px]", on ? "font-semibold" : "text-muted-foreground")}>{l.label}</span>
                <span className="text-[11.5px] tabular-nums text-muted-foreground">
                  {shortDay(l.start)} → {l.open ? "ongoing" : shortDay(l.end)}
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-primary/[0.06]">
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    on ? "bg-primary" : l.id === "booking" ? "bg-primary/35" : "bg-primary/20",
                    l.open && "[mask-image:linear-gradient(to_right,black_60%,transparent)]"
                  )}
                  style={{ left: `${pct(l.start)}%`, width: `${Math.max(2, pct(l.end) - pct(l.start))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The period's month, its days solid; the rest of the rental soft. */
function MonthCard({ detail, p }: { detail: RentalDetailV2; p: PreviewPeriod }) {
  const chain = chainOf(detail);
  const first = local(p.start);
  const monthStart = new Date(first.getFullYear(), first.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const pEnd = p.end ?? addDays(p.start, 6);
  const cells = Array.from({ length: 42 }, (_, k) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + k);
    const key = iso(d);
    const mine = key >= p.start && key < pEnd;
    const rental = chain.some((l) => key >= l.start && key < l.end);
    return { key, day: d.getDate(), inMonth: d.getMonth() === first.getMonth(), mine, rental };
  });
  return (
    <div className={BOX}>
      <div className="flex items-baseline justify-between">
        <p className={H}>{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />This period</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary/20" />Rental</span>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10.5px] font-medium text-muted-foreground/70">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, k) => <span key={k}>{w}</span>)}
      </div>
      <div className="mt-1 grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
        {cells.map((c) => (
          <div
            key={c.key}
            className={cn(
              "flex items-center justify-center rounded-lg text-[12px] tabular-nums",
              !c.inMonth && "text-muted-foreground/35",
              c.mine ? "bg-primary font-semibold text-primary-foreground" : c.rental ? "bg-primary/[0.12] text-foreground" : ""
            )}
          >
            {c.day}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── steps ───────────────────────────────────────────────────────────────── */

function WhenStep({ p, detail }: { p: PreviewPeriod; detail: RentalDetailV2 }) {
  return (
    <Frame
      top={
        <>
          <Fact label="Starts" value={shortDay(p.start)} sub={`${longDay(p.start)} · ${clock(p.times.pickup)}`} />
          {p.end ? (
            <Fact label="Ends" accent value={shortDay(p.end)} sub={`${longDay(p.end)} · ${clock(p.times.ret)}`} />
          ) : (
            <Fact label="Next renewal" accent value={shortDay(p.next)} sub={`Renews every ${p.cadence}`} />
          )}
          {p.end ? (
            <Fact label="Length" value={`${p.days} ${p.days === 1 ? "day" : "days"}`} sub="Continues from the previous period" />
          ) : (
            <Fact label="Renewals so far" value={String(p.renewals ?? 0)} sub="Stops when you stop it" />
          )}
        </>
      }
      left={<ChainCard detail={detail} current={p.id} />}
      right={<MonthCard detail={detail} p={p} />}
    />
  );
}

function AgreementStep({ p }: { p: PreviewPeriod }) {
  const a = p.agreement;
  const signed = a.status === "signed";
  const trail = [
    { icon: Mail, label: "Sent for signature", on: a.sentOn, done: true },
    { icon: Eye, label: "Opened by the customer", on: a.openedOn, done: !!a.openedOn },
    { icon: PenLine, label: signed ? "Signed" : "Waiting for the signature", on: a.signedOn, done: signed },
  ];
  return (
    <Frame
      top={
        <>
          <Fact label="Agreement" value={a.ref} sub="Extension agreement" />
          <Fact label="Status" accent value={signed ? "Signed" : "Awaiting signature"} sub={signed ? `on ${shortDay(a.signedOn)}` : "Reminder goes out tomorrow"} />
          <Fact label="Signer" value={a.signer} sub={a.email ?? "No email on file"} />
        </>
      }
      left={
        <div className={cn(BOX, "items-stretch")}>
          <p className={H}>The document</p>
          {/* A page, drawn: what the operator would see in the PDF. */}
          <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-2xl bg-muted/40 p-5">
            <div className="flex items-center gap-2">
              <FileSignature className="size-4 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
              <span className="text-[12.5px] font-semibold">Rental extension · {a.ref}</span>
            </div>
            <div className="mt-4 flex-1 space-y-2.5">
              {[92, 86, 95, 70, 88, 60, 90, 78].map((w, k) => (
                <span key={k} className="block h-1.5 rounded-full bg-foreground/[0.08]" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-dashed border-foreground/15 pt-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">Signature</p>
                <p className={cn("mt-1 font-serif text-[18px] italic", signed ? "text-foreground" : "text-muted-foreground/40")}>
                  {signed ? a.signer : "—"}
                </p>
              </div>
              {signed ? <Status tone="good">Signed</Status> : <Status tone="wait">Awaiting</Status>}
            </div>
          </div>
        </div>
      }
      right={
        <div className={BOX}>
          <p className={H}>Signing trail</p>
          <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between">
            {trail.map((t, k) => (
              <div key={t.label} className="flex flex-1 items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", t.done ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "bg-muted text-muted-foreground")}>
                    <t.icon className="size-4" />
                  </span>
                  {k < trail.length - 1 && <span className="w-px flex-1 bg-primary/15" />}
                </div>
                <div className="pt-1">
                  <p className={cn("text-[13px] font-medium", !t.done && "text-muted-foreground")}>{t.label}</p>
                  <p className="text-[11.5px] text-muted-foreground">{t.on ? longDay(t.on) : "Not yet"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    />
  );
}

function InsuranceStep({ p, detail }: { p: PreviewPeriod; detail: RentalDetailV2 }) {
  const i = p.insurance;
  const days = p.days ?? 7;
  const chain = previewPeriods(detail);
  return (
    <Frame
      top={
        <>
          <Fact label="Policy" value={i.policy} sub={`${i.provider} cover`} />
          <Fact label="Status" accent value={i.status === "active" ? "Active" : "Renews with the rental"} sub={i.to ? `${shortDay(i.from)} → ${shortDay(i.to)}` : `From ${shortDay(i.from)}, each ${p.cadence}`} />
          <Fact label={p.cadence ? `Premium per ${p.cadence}` : "Premium"} value={money(i.premium)} sub="Charged with the period" />
        </>
      }
      left={
        <div className={BOX}>
          <p className={H}>What it covers</p>
          <Rows>
            {i.covers.map((c) => (
              <Row
                key={c.code}
                label={
                  <span className="flex items-center gap-2.5">
                    {c.included ? <Check className="size-4 text-success" /> : <Minus className="size-4 text-muted-foreground/50" />}
                    <span className={c.included ? "text-foreground" : ""}>{c.name}</span>
                  </span>
                }
                value={c.included ? `${money(c.perDay * days)}` : <span className="text-muted-foreground/60">Not taken</span>}
              />
            ))}
          </Rows>
        </div>
      }
      right={
        <div className={BOX}>
          <p className={H}>Continuous cover</p>
          <Rows>
            <Row label="Original booking" value={<span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-success" />Covered</span>} />
            {chain.map((x) => (
              <Row
                key={x.id}
                label={<span className={x.id === p.id ? "font-semibold text-foreground" : ""}>{x.kind === "auto" ? "Auto extension" : "Manual extension"} · {shortDay(x.start)}</span>}
                value={<span className="inline-flex items-center gap-1.5 tabular-nums"><ShieldCheck className="size-3.5 text-success" />{x.insurance.policy}</span>}
              />
            ))}
            <Row label="Gaps between periods" value={<span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" />None</span>} />
          </Rows>
        </div>
      }
    />
  );
}

const CHARGE_TONE: Record<PeriodCharge["status"], { tone: "good" | "wait" | "plan"; label: string }> = {
  paid: { tone: "good", label: "Paid" },
  due: { tone: "wait", label: "Due" },
  scheduled: { tone: "plan", label: "Scheduled" },
};

function PaymentsStep({ p }: { p: PreviewPeriod }) {
  const pay = p.payments;
  const paid = pay.charges.filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0);
  const open = pay.charges.find((c) => c.status !== "paid");
  return (
    <Frame
      top={
        <>
          <Fact label={p.cadence ? `Total per ${p.cadence}` : "Total"} value={money(pay.total)} sub={`${money(pay.rate)} a day`} />
          <Fact label="Paid" accent value={money(paid)} sub={paid ? "Visa ···4242" : "Nothing yet"} />
          <Fact
            label={open?.status === "due" ? "Due" : "Next charge"}
            value={open ? money(open.amount) : "—"}
            sub={open ? longDay(open.on) : "All settled"}
          />
        </>
      }
      left={
        <div className={BOX}>
          <p className={H}>Breakdown</p>
          <Rows>
            {pay.lines.map((l) => (
              <Row key={l.label} label={l.label} value={money(l.amount)} />
            ))}
            <Row label="Tax" value={money(pay.tax)} />
            <Row label={<span className="font-semibold text-foreground">{p.cadence ? `Total per ${p.cadence}` : "Total"}</span>} value={<span className="text-[15px] font-semibold">{money(pay.total)}</span>} />
          </Rows>
        </div>
      }
      right={
        <div className={BOX}>
          <p className={H}>{p.cadence ? "Charges, one per renewal" : "Charge"}</p>
          <Rows>
            {pay.charges.map((c) => (
              <div key={c.label + c.on} className="flex flex-1 items-center justify-between gap-3 py-1.5">
                <div className="flex items-center gap-2.5">
                  {c.status === "scheduled" ? <Clock className="size-4 text-muted-foreground" /> : <CalendarDays className="size-4 text-muted-foreground" />}
                  <div>
                    <p className="text-[13px] font-medium">{c.label}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {longDay(c.on)}
                      {c.method ? ` · ${c.method}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Status tone={CHARGE_TONE[c.status].tone}>{CHARGE_TONE[c.status].label}</Status>
                  <span className="w-16 text-right text-[13px] font-semibold tabular-nums">{money(c.amount)}</span>
                </div>
              </div>
            ))}
            {pay.charges.length === 1 && (
              <Row label="Receipt" value={pay.charges[0].status === "paid" ? "Sent to the customer" : "Sent once paid"} />
            )}
          </Rows>
        </div>
      }
    />
  );
}

/* ── the pane ────────────────────────────────────────────────────────────── */

export function PeriodView({
  detail,
  state,
  period,
}: {
  detail: RentalDetailV2;
  state: PeriodViewState;
  period: PreviewPeriod | null;
}) {
  if (!period) {
    return (
      <Panel title="Period not found" description="It may have been removed.">
        <EmptyHint>This period is not on the rental any more.</EmptyHint>
      </Panel>
    );
  }

  const step = EXTENSION_STEPS.find((s) => s.id === state.step) ?? EXTENSION_STEPS[0];

  return (
    <Panel
      fill
      title={`${EXTENSION_TITLE[period.kind]} · ${step.label}`}
      description={
        period.end
          ? `${shortDay(period.start)} → ${shortDay(period.end)} · ${period.days} ${period.days === 1 ? "day" : "days"} added`
          : `From ${shortDay(period.start)}, renewing every ${period.cadence}`
      }
    >
      {state.step === "when" && <WhenStep p={period} detail={detail} />}
      {state.step === "agreement" && <AgreementStep p={period} />}
      {state.step === "insurance" && <InsuranceStep p={period} detail={detail} />}
      {state.step === "payments" && <PaymentsStep p={period} />}
    </Panel>
  );
}

export default PeriodView;
