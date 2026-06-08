"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCreditWallet, CreditTransaction } from "@/hooks/use-credit-wallet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  CircleDollarSign,
  Loader2,
  RefreshCw,
  Plus,
  Minus,
  FileSignature,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  Tile,
  KpiTile,
  Eyebrow,
  StatusPill,
  EmptyState,
  KpiTileSkeletonRow,
  Shimmer,
  bentoTable,
} from "@/components/bento";

// ── Helpers ──────────────────────────────────────────────────────────

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMonthLabel(monthStr: string) {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDayLabel(dayStr: string) {
  const d = new Date(dayStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type TimeRange = "7d" | "30d" | "3m" | "6m" | "12m";
type IntegrationFilter = "all" | "esign" | "twilio" | "verification";

const CATEGORY_ICONS: Record<string, any> = {
  esign: FileSignature,
  twilio: MessageSquare,
  sms: MessageSquare,
  verification: ShieldCheck,
};

const TX_TONE: Record<
  string,
  { label: string; tone: "success" | "danger" | "info" | "primary" | "warn" | "neutral" }
> = {
  purchase: { label: "Purchase", tone: "success" },
  usage: { label: "Usage", tone: "danger" },
  refund: { label: "Refund", tone: "info" },
  gift: { label: "Gift", tone: "primary" },
  auto_refill: { label: "Auto-refill", tone: "warn" },
  adjustment: { label: "Adjustment", tone: "neutral" },
};

function TransactionTypeBadge({
  type,
  isTest,
}: {
  type: CreditTransaction["type"];
  isTest: boolean;
}) {
  const c = TX_TONE[type] || { label: type, tone: "neutral" as const };
  return (
    <span className="flex items-center gap-1.5">
      <StatusPill tone={c.tone}>{c.label}</StatusPill>
      {isTest && <StatusPill tone="warn">TEST</StatusPill>}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function CreditsPage() {
  const searchParams = useSearchParams();
  const {
    wallet,
    balance,
    testBalance,
    isLowBalance,
    transactions,
    costs,
    isLoading,
    buyCredits,
    updateAutoRefill,
    refetch,
  } = useCreditWallet();

  const [liveBuyAmount, setLiveBuyAmount] = useState(10);
  const [autoRefillEnabled, setAutoRefillEnabled] = useState(false);
  const [autoRefillThreshold, setAutoRefillThreshold] = useState(10);
  const [autoRefillAmount, setAutoRefillAmount] = useState(50);
  const [timeRange, setTimeRange] = useState<TimeRange>("6m");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");

  useEffect(() => {
    if (wallet) {
      setAutoRefillEnabled(wallet.auto_refill_enabled);
      setAutoRefillThreshold(wallet.auto_refill_threshold);
      setAutoRefillAmount(wallet.auto_refill_amount);
    }
  }, [wallet]);

  useEffect(() => {
    if (searchParams.get("status") === "success") {
      toast.success("Credits purchased successfully!");
      const interval = setInterval(() => refetch(), 2000);
      const timeout = setTimeout(() => clearInterval(interval), 15000);
      return () => { clearInterval(interval); clearTimeout(timeout); };
    }
  }, [searchParams]);

  // Chart data — live usage only, with time range and integration filter
  const chartConfig = useMemo<ChartConfig>(() => ({
    usage: { label: "Credit Usage", color: "hsl(var(--primary))" },
  }), []);

  const chartData = useMemo(() => {
    const now = new Date();
    const usageTransactions = transactions.filter(
      (tx) =>
        tx.type === "usage" &&
        !tx.is_test_mode &&
        (integrationFilter === "all" || tx.category === integrationFilter)
    );

    if (timeRange === "7d" || timeRange === "30d") {
      const days = timeRange === "7d" ? 7 : 30;
      const result: { label: string; usage: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dayStr = d.toISOString().substring(0, 10);
        let count = 0;
        for (const tx of usageTransactions) {
          if (tx.created_at.substring(0, 10) === dayStr) count++;
        }
        result.push({ label: formatDayLabel(dayStr), usage: count });
      }
      return result;
    }

    // Monthly grouping
    const months = timeRange === "3m" ? 3 : timeRange === "6m" ? 6 : 12;
    const result: { label: string; usage: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let count = 0;
      for (const tx of usageTransactions) {
        if (tx.created_at.substring(0, 7) === monthKey) count++;
      }
      result.push({ label: formatMonthLabel(monthKey), usage: count });
    }
    return result;
  }, [transactions, timeRange, integrationFilter]);

  const handleSaveAutoRefill = () => {
    updateAutoRefill.mutate({
      enabled: autoRefillEnabled,
      threshold: autoRefillThreshold,
      amount: autoRefillAmount,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Shimmer className="h-9 w-48" />
        <KpiTileSkeletonRow count={3} />
        <Shimmer className="h-[320px] rounded-tile" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Credits</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Buy and manage credits for platform services
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} className="shrink-0">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => buyCredits.mutate(liveBuyAmount)}
            disabled={buyCredits.isPending}
            className="flex-1 sm:flex-none"
          >
            {buyCredits.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Buy Credits
          </Button>
        </div>
      </div>

      {/* ── Balance Tiles ── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {/* Live Credits — hero lead number */}
        <Tile variant="hero" className="flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <Eyebrow className="text-white/70">Live Credits</Eyebrow>
            {isLowBalance && <StatusPill tone="warn">Low balance</StatusPill>}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-extrabold tabular-nums tracking-tight leading-none text-[clamp(2.4rem,3.2vw,3.2rem)]">
              {balance.toFixed(0)}
            </span>
            <span className="text-sm text-white/70">remaining</span>
          </div>
          <div className="mt-1 border-t border-white/15 pt-4">
            <p className="text-xs font-medium text-white/70 mb-2.5">Amount to buy</p>
            <div className="flex items-center rounded-full border border-white/25 bg-white/10 w-fit">
              <button
                type="button"
                onClick={() => setLiveBuyAmount((v) => Math.max(1, v - 5))}
                className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={1}
                max={10000}
                value={liveBuyAmount}
                onChange={(e) => setLiveBuyAmount(Math.max(1, parseInt(e.target.value) || 1))}
                className="h-9 w-16 border-x border-white/25 bg-transparent text-center text-sm font-mono font-semibold tabular-nums text-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setLiveBuyAmount((v) => Math.min(10000, v + 5))}
                className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Tile>

        {/* Test Credits */}
        <KpiTile
          variant="warn"
          label="Test Credits"
          value={testBalance}
          noCountUp
          format={(v) => (
            <span className="font-mono tabular-nums">{v.toFixed(0)}</span>
          )}
          sub="Free sandbox credits for testing integrations in test mode. Cannot be purchased."
          icon={<CircleDollarSign className="h-4 w-4" />}
        />

        {/* Service Costs */}
        <Tile className="flex flex-col gap-3">
          <div>
            <Eyebrow>Service Costs</Eyebrow>
            <p className="text-xs text-muted-foreground mt-1">Credits per service</p>
          </div>
          <div className="grid gap-2">
            {costs.map((cost) => {
              const Icon = CATEGORY_ICONS[cost.category] || CircleDollarSign;
              return (
                <div
                  key={cost.id}
                  className="flex items-center gap-3 rounded-tile-sm border border-border [background:var(--bento-tile-2)] p-2.5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md [background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{cost.label}</p>
                  </div>
                  <span className="text-sm font-mono font-semibold tabular-nums shrink-0">
                    {cost.cost_credits} cr
                  </span>
                </div>
              );
            })}
            {costs.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No service costs configured
              </p>
            )}
          </div>
        </Tile>
      </div>

      {/* ── Transaction History (full width) ── */}
      <Tile pad="none" className="overflow-hidden">
        <div className="p-5 pb-3">
          <h3 className="text-base font-bold tracking-tight">Transaction History</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            All credit activity including purchases, usage, refunds, and gifts
          </p>
        </div>
        <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative scrollbar-thin">
          <table className="w-full">
            <thead className={`sticky top-0 z-10 ${bentoTable.header}`}>
              <tr>
                <th className="text-left py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Date
                </th>
                <th className="text-left py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Type
                </th>
                <th className="text-left py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Description
                </th>
                <th className="text-left py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Category
                </th>
                <th className="text-right py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Amount
                </th>
                <th className="text-right py-2.5 px-4 text-[10.5px] uppercase tracking-wider font-bold text-[color:var(--bento-text-3)] [background:var(--bento-tile-2)]">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      className="border-0 shadow-none"
                      icon={<CircleDollarSign className="h-5 w-5" />}
                      title="No transactions yet"
                      description="Credit purchases, usage, and refunds will appear here."
                    />
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 px-4 text-sm text-muted-foreground font-mono tabular-nums whitespace-nowrap">
                      {formatDateTime(tx.created_at)}
                    </td>
                    <td className="py-2.5 px-4">
                      <TransactionTypeBadge type={tx.type} isTest={tx.is_test_mode} />
                    </td>
                    <td className="py-2.5 px-4 text-sm text-muted-foreground max-w-[300px] truncate">
                      {tx.description || "—"}
                    </td>
                    <td className="py-2.5 px-4 text-sm text-muted-foreground capitalize">
                      {tx.category || "—"}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-sm font-mono font-medium tabular-nums text-right ${
                        tx.amount > 0
                          ? "text-[color:var(--bento-success)]"
                          : tx.amount < 0
                          ? "text-[color:var(--bento-danger-fg)]"
                          : "text-muted-foreground"
                      }`}
                    >
                      {tx.amount > 0 ? "+" : ""}
                      {tx.amount}
                    </td>
                    <td className="py-2.5 px-4 text-sm font-mono tabular-nums text-right text-muted-foreground">
                      {tx.balance_after}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Tile>

      {/* ── Usage History Chart (live only) ── */}
      <Tile className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight">Usage History</h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Live credit usage over time
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={integrationFilter}
              onValueChange={(v) => setIntegrationFilter(v as IntegrationFilter)}
            >
              <SelectTrigger className="flex-1 sm:flex-none sm:w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                <SelectItem value="esign">E-Sign</SelectItem>
                <SelectItem value="twilio">Twilio</SelectItem>
                <SelectItem value="verification">Verification</SelectItem>
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="flex-1 sm:flex-none sm:w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="3m">3 months</SelectItem>
                <SelectItem value="6m">6 months</SelectItem>
                <SelectItem value="12m">12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-hidden">
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="usage" fill="var(--color-usage)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartContainer>
        </div>
      </Tile>

      {/* ── Auto-Refill Settings ── */}
      <Tile className="max-w-lg space-y-6">
        <div>
          <h3 className="text-base font-bold tracking-tight">Auto-Refill Settings</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatically top up live credits when balance drops below a threshold
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable Auto-Refill</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Charge your saved payment method automatically
            </p>
          </div>
          <Switch checked={autoRefillEnabled} onCheckedChange={setAutoRefillEnabled} />
        </div>

        {autoRefillEnabled && (
          <>
            <div className="space-y-2">
              <Label className="text-sm font-medium">When balance drops below</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={autoRefillThreshold}
                  onChange={(e) => setAutoRefillThreshold(parseInt(e.target.value) || 10)}
                  className="w-24 font-mono tabular-nums"
                />
                <span className="text-sm text-muted-foreground">credits</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Top up amount</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={autoRefillAmount}
                  onChange={(e) => setAutoRefillAmount(parseInt(e.target.value) || 50)}
                  className="w-24 font-mono tabular-nums"
                />
                <span className="text-sm text-muted-foreground">credits</span>
              </div>
            </div>
          </>
        )}

        <Button onClick={handleSaveAutoRefill} disabled={updateAutoRefill.isPending}>
          {updateAutoRefill.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </Tile>
    </div>
  );
}
