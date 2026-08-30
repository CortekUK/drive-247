/**
 * /reports/vehicle-profitability — Spec §11.
 *
 * Operator-facing dashboard showing per-vehicle revenue, expenses, profit
 * and ROI over a chosen period. Driven entirely by Drive247's internal
 * `pnl_entries` ledger — no Xero/Zoho connection required.
 *
 * Gated to Growth+ tier via useFeatureAccess('finance_sync') so it shows
 * up alongside the rest of the Finance Sync surface.
 */
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft, TrendingUp, TrendingDown, Activity, Loader2, Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useFeatureAccess } from "@/hooks/use-feature-access";
import {
  useVehicleProfitability,
  type ProfitabilityPeriod,
  type ProfitabilityVehicleRow,
} from "@/hooks/use-vehicle-profitability";

const fmtMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

type SortKey = "profit" | "revenue" | "utilisation" | "roi";

export default function VehicleProfitabilityPage() {
  const [period, setPeriod] = useState<ProfitabilityPeriod>("365");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [drawerRow, setDrawerRow] = useState<ProfitabilityVehicleRow | null>(null);
  const [showDisposed, setShowDisposed] = useState(false);

  const access = useFeatureAccess("finance_sync");
  const query = useVehicleProfitability(period);

  const sortedVehicles = useMemo(() => {
    const rows = (query.data?.vehicles ?? []).filter((v) => {
      if (!showDisposed && v.is_disposed) return false;
      if (search.length > 0) {
        const q = search.toLowerCase();
        return (
          (v.reg ?? "").toLowerCase().includes(q) ||
          (v.make ?? "").toLowerCase().includes(q) ||
          (v.model ?? "").toLowerCase().includes(q) ||
          (v.category ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = 0, bv = 0;
      switch (sortKey) {
        case "profit":      av = a.profit; bv = b.profit; break;
        case "revenue":     av = a.revenue; bv = b.revenue; break;
        case "utilisation": av = a.utilisation_percent; bv = b.utilisation_percent; break;
        case "roi":         av = a.roi_percent ?? -1; bv = b.roi_percent ?? -1; break;
      }
      return (av - bv) * dir;
    });
  }, [query.data, search, showDisposed, sortKey, sortDir]);

  if (access.isLoading) {
    return <main className="p-6"><Skeleton className="h-96 w-full rounded-lg" /></main>;
  }
  if (!access.canAccess) {
    return (
      <main className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <Activity className="h-5 w-5 text-indigo-600" />
            </div>
            <h2 className="mt-4 text-base font-medium">Vehicle Profitability requires the {access.requiredTierLabel} tier</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              You&apos;re on {access.planName ?? "the Basic tier"}. Upgrade to unlock per-vehicle revenue, expense + ROI tracking.
            </p>
            <Link href="/settings?tab=subscription" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              View plans →
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  const currency = query.data?.currency ?? "USD";
  const kpis = query.data?.kpis;

  return (
    <main className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link href="/reports" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Reports
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-medium tracking-tight">Vehicle Profitability</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-vehicle revenue, expenses, profit and ROI over the selected period.
              Driven by Drive247&apos;s internal ledger.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={typeof period === "object" ? "custom" : period} onValueChange={(v) => setPeriod(v as ProfitabilityPeriod)}>
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 3 months</SelectItem>
                <SelectItem value="180">Last 6 months</SelectItem>
                <SelectItem value="365">Last 12 months</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs">{currency}</Badge>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      {query.isLoading ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
        </div>
      ) : query.isError ? (
        <Card className="mb-6 border-red-200 bg-red-50/40">
          <CardContent className="py-4 text-xs text-red-800">
            Failed to load profitability: {(query.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Revenue" value={kpis ? fmtMoney(kpis.revenue, currency) : "—"} tone="positive" />
          <KpiCard label="Expenses" value={kpis ? fmtMoney(kpis.expenses, currency) : "—"} tone="negative" />
          <KpiCard label="Net Profit" value={kpis ? fmtMoney(kpis.net_profit, currency) : "—"}
            tone={(kpis?.net_profit ?? 0) >= 0 ? "positive" : "negative"} />
          <KpiCard label="Avg ROI" value={kpis?.avg_roi_percent !== null && kpis?.avg_roi_percent !== undefined ? `${kpis.avg_roi_percent}%` : "—"}
            tone={(kpis?.avg_roi_percent ?? 0) >= 0 ? "positive" : "negative"} />
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search reg, make, model…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-7 text-xs" />
        </div>
        <label className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <input type="checkbox" checked={showDisposed} onChange={(e) => setShowDisposed(e.target.checked)} className="h-3 w-3" />
          Include disposed
        </label>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : sortedVehicles.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {(query.data?.vehicles ?? []).length === 0
                ? "No vehicle data for this period. Try a wider date range."
                : "No vehicles match these filters."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              <li className="grid grid-cols-[1.5fr_120px_120px_120px_100px_100px] items-center gap-3 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Vehicle</span>
                <SortableHead label="Revenue" sortKey="revenue" currentKey={sortKey} dir={sortDir} onToggle={(k) => { setSortKey(k); setSortDir(sortKey === k && sortDir === "desc" ? "asc" : "desc"); }} />
                <span className="text-right">Expenses</span>
                <SortableHead label="Profit" sortKey="profit" currentKey={sortKey} dir={sortDir} onToggle={(k) => { setSortKey(k); setSortDir(sortKey === k && sortDir === "desc" ? "asc" : "desc"); }} />
                <SortableHead label="Util %" sortKey="utilisation" currentKey={sortKey} dir={sortDir} onToggle={(k) => { setSortKey(k); setSortDir(sortKey === k && sortDir === "desc" ? "asc" : "desc"); }} />
                <SortableHead label="ROI %" sortKey="roi" currentKey={sortKey} dir={sortDir} onToggle={(k) => { setSortKey(k); setSortDir(sortKey === k && sortDir === "desc" ? "asc" : "desc"); }} />
              </li>
              {sortedVehicles.map((v) => (
                <li
                  key={v.vehicle_id}
                  onClick={() => setDrawerRow(v)}
                  className="grid cursor-pointer grid-cols-[1.5fr_120px_120px_120px_100px_100px] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {[v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}
                      {v.is_disposed && <Badge variant="outline" className="ml-2 bg-zinc-50 text-zinc-600 text-[9px]">disposed</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {v.reg ?? "—"}{v.category ? ` · ${v.category}` : ""}
                    </div>
                  </div>
                  <span className="text-right text-xs tabular-nums">{fmtMoney(v.revenue, currency)}</span>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">{fmtMoney(v.expenses, currency)}</span>
                  <span className={`text-right text-xs font-medium tabular-nums ${v.profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {fmtMoney(v.profit, currency)}
                  </span>
                  <span className="text-right text-xs tabular-nums">{v.utilisation_percent.toFixed(1)}%</span>
                  <span className={`text-right text-xs tabular-nums ${v.roi_percent === null ? "text-muted-foreground" : v.roi_percent >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {v.roi_percent === null ? "—" : `${v.roi_percent.toFixed(1)}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Period {query.data?.period_start} → {query.data?.period_end}. Utilisation = days on rental ÷ period days.
      </p>

      {/* Detail drawer */}
      <ProfitabilityDetailDrawer row={drawerRow} currency={currency} onClose={() => setDrawerRow(null)} />
    </main>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  const colour = tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "";
  const Icon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : Activity;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-medium tabular-nums ${colour}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function SortableHead({
  label, sortKey, currentKey, dir, onToggle,
}: { label: string; sortKey: SortKey; currentKey: SortKey; dir: "asc" | "desc"; onToggle: (k: SortKey) => void }) {
  const isActive = sortKey === currentKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={`text-right text-[10px] font-medium uppercase tracking-wider ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label} {isActive ? (dir === "desc" ? "↓" : "↑") : ""}
    </button>
  );
}

function ProfitabilityDetailDrawer({
  row, currency, onClose,
}: { row: ProfitabilityVehicleRow | null; currency: string; onClose: () => void }) {
  if (!row) return null;
  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-base">
            {[row.make, row.model].filter(Boolean).join(" ") || "Vehicle"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {row.reg ?? "—"}{row.category ? ` · ${row.category}` : ""}{row.is_disposed ? " · disposed" : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <KpiCard label="Revenue" value={fmtMoney(row.revenue, currency)} tone="positive" />
            <KpiCard label="Expenses" value={fmtMoney(row.expenses, currency)} tone="negative" />
            <KpiCard label="Profit" value={fmtMoney(row.profit, currency)} tone={row.profit >= 0 ? "positive" : "negative"} />
            <KpiCard label="ROI" value={row.roi_percent === null ? "—" : `${row.roi_percent.toFixed(1)}%`} tone={(row.roi_percent ?? 0) >= 0 ? "positive" : "negative"} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs">Utilisation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-medium tabular-nums">{row.utilisation_percent.toFixed(1)}%</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Of all days in the selected period, this vehicle was on a rental this share of the time.
              </p>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Per-event-type breakdown + monthly trend lands in a follow-on iteration. For now this drawer
            shows the headline numbers from the selected period.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
