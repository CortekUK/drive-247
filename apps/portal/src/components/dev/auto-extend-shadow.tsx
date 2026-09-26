"use client";

/**
 * Developer tab — the renewal shadow comparison (docs/PAYMENTS_ROADMAP.md
 * Wave 3: "the engine computes what it would charge next to what the old job
 * charges, for review before any rental is moved").
 *
 * For each of this tenant's rentals still on the old renewal job
 * (`auto_extend_enabled`), it asks `payment-plan-manage` 'shadow_compare' what
 * the old job charges per period and what the plan engine would charge for the
 * same period, and shows the two side by side. A row that differs is marked,
 * with the server's reasons in words.
 *
 * READ-ONLY. Two reads and nothing else: a SELECT on this tenant's rentals
 * (RLS scopes it to the tenant) and 'shadow_compare', which the server defines
 * as read-only (super admin or head admin). No rental is moved, nothing is
 * charged, nothing is written. It does not even read on mount — the operator
 * presses Load — so opening /dev costs nothing. The blast-radius sentence in
 * dev-page.tsx stays true.
 *
 * Plain state rather than React Query on purpose: /dev renders outside any
 * query provider in its own tests, and a comparison is a one-off look.
 */

import { Fragment, useState } from "react";
import { ChevronDown, GitCompare, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui-v2/card";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import { invokePaymentPlanManage } from "@/hooks/use-payment-plan";
import { formatInstant, formatMoney, plural } from "@/lib/payment-plans-ui/format";

/* ── the pinned reply ──────────────────────────────────────────────────── */

export interface ShadowSide {
  dueAt: string | null;
  /** Old job only: the date it would charge. */
  chargeDate?: string | null;
  amountCents: number | null;
  breakdown?: Record<string, unknown> | null;
}

export interface ShadowRow {
  period: string;
  oldEngine: ShadowSide;
  newEngine: ShadowSide;
  matches: boolean;
  notes: string[];
}

/** Defensive read of `{ rows }` — a malformed row becomes a visible mismatch, never a silent match. */
export function readShadowRows(reply: unknown): ShadowRow[] {
  const rows = (reply as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  const side = (v: unknown): ShadowSide => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const n = typeof o.amountCents === "number" && Number.isFinite(o.amountCents) ? o.amountCents : null;
    return {
      dueAt: typeof o.dueAt === "string" ? o.dueAt : null,
      chargeDate: typeof o.chargeDate === "string" ? o.chargeDate : null,
      amountCents: n,
      breakdown: o.breakdown && typeof o.breakdown === "object" ? (o.breakdown as Record<string, unknown>) : null,
    };
  };
  return rows.map((r, i) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const notes = Array.isArray(o.notes) ? o.notes.filter((x): x is string => typeof x === "string") : [];
    return {
      period: typeof o.period === "string" ? o.period : `Period ${i + 1}`,
      oldEngine: side(o.oldEngine),
      newEngine: side(o.newEngine),
      matches: o.matches === true,
      notes: o.matches === true || notes.length > 0 ? notes : ["The server did not say why this period differs."],
    };
  });
}

/**
 * Notes about the rental as a whole (paused, a period parked unpaid, the
 * credit-scope difference …) — the engine's `ShadowResult.notes`, beside the
 * per-period rows.
 */
export function readShadowNotes(reply: unknown): string[] {
  const notes = (reply as { notes?: unknown } | null)?.notes;
  return Array.isArray(notes) ? notes.filter((x): x is string => typeof x === "string") : [];
}

/** Keys whose values differ between the two breakdowns. */
export function breakdownDiff(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out = new Set<string>();
  for (const k of keys) if (JSON.stringify((a ?? {})[k]) !== JSON.stringify((b ?? {})[k])) out.add(k);
  return out;
}

interface ShadowRental {
  id: string;
  label: string;
  cadence: string;
  status: string;
}

type Comparison = { state: "loading" } | { state: "error"; message: string } | { state: "done"; rows: ShadowRow[]; notes: string[] };

/* ── the section ───────────────────────────────────────────────────────── */

export function AutoExtendShadow() {
  const { tenant } = useTenant();
  const [rentals, setRentals] = useState<ShadowRental[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Comparison>>({});

  const currency = ((tenant as { currency_code?: string } | null)?.currency_code || "USD").toUpperCase();
  const timezone = (tenant as { timezone?: string } | null)?.timezone ?? null;

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await (supabase as any)
        .from("rentals")
        .select("id, start_date, end_date, status, auto_extend_period_unit, auto_extend_interval_count, auto_extend_charge_mode, auto_extend_paused, customers(name), vehicles(reg)")
        .eq("tenant_id", tenant.id)
        .eq("auto_extend_enabled", true)
        .order("end_date", { ascending: true });
      if (error) throw error;
      setRentals(
        ((data ?? []) as Record<string, any>[]).map((r) => {
          const c = Array.isArray(r.customers) ? r.customers[0] : r.customers;
          const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
          const every = Number(r.auto_extend_interval_count ?? 1);
          const unit = String(r.auto_extend_period_unit ?? "Weekly").toLowerCase().replace(/ly$/, "").replace(/^dai$/, "day");
          return {
            id: String(r.id),
            label: `${c?.name ?? "Customer"} · ${v?.reg ?? "vehicle"}`,
            cadence: `every ${every > 1 ? `${every} ${unit}s` : unit} · ${r.auto_extend_charge_mode === "auto_charge" ? "card" : "link"}${r.auto_extend_paused ? " · paused" : ""}`,
            status: String(r.status ?? ""),
          };
        }),
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err));
    } finally {
      setLoading(false);
    }
  };

  const compare = async (rentalId: string) => {
    setResults((p) => ({ ...p, [rentalId]: { state: "loading" } }));
    try {
      const reply = await invokePaymentPlanManage("shadow_compare", { rentalId });
      setResults((p) => ({ ...p, [rentalId]: { state: "done", rows: readShadowRows(reply), notes: readShadowNotes(reply) } }));
    } catch (err) {
      setResults((p) => ({ ...p, [rentalId]: { state: "error", message: err instanceof Error ? err.message : String(err) } }));
    }
  };

  return (
    <Card className="mt-6" data-auto-extend-shadow="">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <GitCompare className="h-4 w-4" />
          Renewal shadow comparison
        </CardTitle>
        <CardDescription className="mt-1.5">
          For each rental still renewed by the old job, what that job charges per period next to what the payment plan would charge for the
          same period. Differences are marked with the reason. Read-only: nothing is moved, charged or saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading || !tenant?.id} data-shadow-load="">
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {rentals ? "Reload renewing rentals" : "Load renewing rentals"}
          </Button>
          {rentals && rentals.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => rentals.forEach((r) => void compare(r.id))} data-shadow-compare-all="">
              Compare all
            </Button>
          )}
        </div>
        {loadError && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {loadError}
          </p>
        )}
        {rentals && rentals.length === 0 && <p className="text-xs text-muted-foreground">No rental of this company is on the old renewal job.</p>}

        {rentals?.map((r) => (
          <RentalComparison key={r.id} rental={r} result={results[r.id]} onCompare={() => void compare(r.id)} currency={currency} timezone={timezone} />
        ))}
      </CardContent>
    </Card>
  );
}

function RentalComparison({
  rental,
  result,
  onCompare,
  currency,
  timezone,
}: {
  rental: ShadowRental;
  result: Comparison | undefined;
  onCompare: () => void;
  currency: string;
  timezone: string | null;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const $ = (c: number | null) => (c === null ? "—" : formatMoney(c, currency));
  const when = (s: ShadowSide) => (s.dueAt ? formatInstant(s.dueAt, timezone) : s.chargeDate ?? "—");
  const rows = result?.state === "done" ? result.rows : [];
  const mismatches = rows.filter((x) => !x.matches).length;

  return (
    <div className="rounded-3xl bg-muted/40 px-4 py-3 ring-1 ring-foreground/5" data-shadow-rental={rental.id}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{rental.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {rental.cadence}
            {rental.status ? ` · ${rental.status}` : ""}
          </p>
        </div>
        {result?.state === "done" && (
          <span className={cn("text-[12px] font-medium", mismatches ? "text-destructive" : "text-success")} data-shadow-summary="">
            {rows.length === 0
              ? "No periods to compare"
              : mismatches
                ? `${plural(mismatches, "period")} ${mismatches === 1 ? "differs" : "differ"}`
                : `All ${plural(rows.length, "period")} match`}
          </span>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onCompare} disabled={result?.state === "loading"} data-shadow-compare="">
          {result?.state === "loading" && <Loader2 className="size-3.5 animate-spin" />}
          Compare
        </Button>
      </div>

      {result?.state === "done" && result.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-muted-foreground" data-shadow-rental-notes="">
          {result.notes.map((n, j) => (
            <li key={j}>{n}</li>
          ))}
        </ul>
      )}

      {result?.state === "error" && (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {result.message}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto no-scrollbar">
          <table className="w-full border-separate border-spacing-0 text-left text-[12px]" data-shadow-table="">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                <th className="pb-2 pr-3">Period</th>
                <th className="pb-2 pr-3">Old job</th>
                <th className="pb-2 pr-3 text-right">Old amount</th>
                <th className="pb-2 pr-3">Plan</th>
                <th className="pb-2 pr-3 text-right">Plan amount</th>
                <th className="pb-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const diff = breakdownDiff(row.oldEngine.breakdown, row.newEngine.breakdown);
                const isOpen = open.has(i);
                return (
                  <Fragment key={i}>
                    <tr
                      className={cn("cursor-pointer align-top", !row.matches && "bg-destructive/[0.07]")}
                      onClick={() =>
                        setOpen((p) => {
                          const n = new Set(p);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                      data-shadow-row={i}
                      data-shadow-match={row.matches ? "true" : "false"}
                    >
                      <td className="border-t border-foreground/5 py-2 pr-3 font-medium">{row.period}</td>
                      <td className="border-t border-foreground/5 py-2 pr-3 text-muted-foreground">{when(row.oldEngine)}</td>
                      <td className="border-t border-foreground/5 py-2 pr-3 text-right tabular-nums">{$(row.oldEngine.amountCents)}</td>
                      <td className="border-t border-foreground/5 py-2 pr-3 text-muted-foreground">{when(row.newEngine)}</td>
                      <td
                        className={cn(
                          "border-t border-foreground/5 py-2 pr-3 text-right tabular-nums",
                          row.oldEngine.amountCents !== row.newEngine.amountCents && "font-semibold text-destructive",
                        )}
                      >
                        {$(row.newEngine.amountCents)}
                      </td>
                      <td className={cn("border-t border-foreground/5 py-2", row.matches ? "text-success" : "text-destructive")}>
                        <span className="inline-flex items-center gap-1">
                          {row.matches ? "Matches" : "Differs"}
                          <ChevronDown className={cn("size-3 transition-transform", isOpen && "rotate-180")} />
                        </span>
                        {!row.matches && row.notes.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-snug" data-shadow-notes="">
                            {row.notes.map((n, j) => (
                              <li key={j}>{n}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} className="pb-3">
                          <Breakdown old={row.oldEngine.breakdown} next={row.newEngine.breakdown} diff={diff} currency={currency} />
                          {row.matches && row.notes.length > 0 && (
                            <p className="mt-1 text-[11px] text-muted-foreground">{row.notes.join(" ")}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A breakdown value: money when the key says cents, otherwise as given. */
function cell(key: string, v: unknown, currency: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && /cents$/i.test(key)) return formatMoney(v, currency);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Breakdown({
  old,
  next,
  diff,
  currency,
}: {
  old: Record<string, unknown> | null | undefined;
  next: Record<string, unknown> | null | undefined;
  diff: Set<string>;
  currency: string;
}) {
  const keys = [...new Set([...Object.keys(old ?? {}), ...Object.keys(next ?? {})])];
  if (keys.length === 0) return <p className="mt-1 text-[11px] text-muted-foreground">No breakdown was returned for this period.</p>;
  return (
    <table className="mt-1 w-full text-[11px]" data-shadow-breakdown="">
      <thead>
        <tr className="text-muted-foreground/70">
          <th className="pr-3 text-left font-medium">Line</th>
          <th className="pr-3 text-right font-medium">Old job</th>
          <th className="text-right font-medium">Plan</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className={cn(diff.has(k) && "font-semibold text-destructive")} data-breakdown-key={k} data-breakdown-differs={diff.has(k) ? "true" : "false"}>
            <td className="pr-3">{k}</td>
            <td className="pr-3 text-right tabular-nums">{cell(k, (old ?? {})[k], currency)}</td>
            <td className="text-right tabular-nums">{cell(k, (next ?? {})[k], currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
