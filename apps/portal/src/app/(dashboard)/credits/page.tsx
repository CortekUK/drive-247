"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCreditWallet, CreditTransaction } from "@/hooks/use-credit-wallet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  CircleDollarSign,
  FlaskConical,
  Loader2,
  RefreshCw,
  Plus,
  Minus,
  FileSignature,
  MessageSquare,
  ScanText,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────────────

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMonthLabel(monthStr: string) {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

const CATEGORY_ICONS: Record<string, any> = {
  esign: FileSignature,
  sms: MessageSquare,
  ocr: ScanText,
  verification: ShieldCheck,
};

function TransactionTypeBadge({ type, isTest }: { type: CreditTransaction["type"]; isTest: boolean }) {
  const config: Record<string, { label: string; class: string }> = {
    purchase: { label: "Purchase", class: "text-green-500" },
    usage: { label: "Usage", class: "text-red-500" },
    refund: { label: "Refund", class: "text-blue-500" },
    gift: { label: "Gift", class: "text-purple-500" },
    auto_refill: { label: "Auto-refill", class: "text-amber-500" },
    adjustment: { label: "Adjustment", class: "text-muted-foreground" },
  };
  const c = config[type] || { label: type, class: "text-muted-foreground" };

  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-sm ${c.class}`}>{c.label}</span>
      {isTest && (
        <Badge
          variant="outline"
          className="border-orange-500/50 text-orange-500 text-[10px] px-1.5 py-0"
        >
          TEST
        </Badge>
      )}
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
  const [testBuyAmount, setTestBuyAmount] = useState(10);
  const [autoRefillEnabled, setAutoRefillEnabled] = useState(false);
  const [autoRefillThreshold, setAutoRefillThreshold] = useState(10);
  const [autoRefillAmount, setAutoRefillAmount] = useState(50);

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

  // Chart data — last 6 months of credit usage
  const chartConfig = useMemo<ChartConfig>(() => ({
    live: { label: "Live Usage", color: "hsl(var(--primary))" },
    test: { label: "Test Usage", color: "#f59e0b" },
  }), []);

  const chartData = useMemo(() => {
    const months = getLastNMonths(6);
    return months.map((month) => {
      let liveCount = 0;
      let testCount = 0;
      for (const tx of transactions) {
        if (tx.type !== "usage") continue;
        const txMonth = tx.created_at.substring(0, 7);
        if (txMonth !== month) continue;
        if (tx.is_test_mode) testCount++;
        else liveCount++;
      }
      return { month: formatMonthLabel(month), live: liveCount, test: testCount };
    });
  }, [transactions]);

  const handleSaveAutoRefill = () => {
    updateAutoRefill.mutate({
      enabled: autoRefillEnabled,
      threshold: autoRefillThreshold,
      amount: autoRefillAmount,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 pt-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
          <Skeleton className="h-[200px] rounded-xl" />
          <Skeleton className="h-[200px] rounded-xl" />
        </div>
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Credits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Buy and manage credits for platform services
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* ── Credit Cards ── */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        {/* Live Credits */}
        <Card className="overflow-hidden transition-all duration-200 hover:shadow-md border-emerald-500/30 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08]">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Live Credits</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">{balance.toFixed(0)}</span>
                  <span className="text-sm text-emerald-600/60 dark:text-emerald-400/60">remaining</span>
                </div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <CircleDollarSign className="h-6 w-6 text-emerald-500" />
              </div>
            </div>

            <div className="mt-5 pt-5 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-3">Buy live credits</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-lg border bg-background">
                  <button
                    type="button"
                    onClick={() => setLiveBuyAmount((v) => Math.max(1, v - 5))}
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={liveBuyAmount}
                    onChange={(e) => setLiveBuyAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-9 w-16 border-x bg-transparent text-center text-sm font-semibold focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setLiveBuyAmount((v) => Math.min(10000, v + 5))}
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">=&nbsp;${liveBuyAmount}</span>
                <Button
                  size="sm"
                  onClick={() => buyCredits.mutate(liveBuyAmount)}
                  disabled={buyCredits.isPending}
                  className="ml-auto"
                >
                  {buyCredits.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Buy Now"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Test Credits */}
        <Card className="overflow-hidden transition-all duration-200 hover:shadow-md border-yellow-500/30 bg-yellow-500/[0.06] dark:bg-yellow-500/[0.08]">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-yellow-600 dark:text-yellow-400">Test Credits</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight text-yellow-700 dark:text-yellow-300">{testBalance.toFixed(0)}</span>
                  <span className="text-sm text-yellow-600/60 dark:text-yellow-400/60">remaining</span>
                </div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/15">
                <CircleDollarSign className="h-6 w-6 text-yellow-500" />
              </div>
            </div>

            <div className="mt-5 pt-5 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-3">Buy test credits</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-lg border bg-background">
                  <button
                    type="button"
                    onClick={() => setTestBuyAmount((v) => Math.max(1, v - 5))}
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={testBuyAmount}
                    onChange={(e) => setTestBuyAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-9 w-16 border-x bg-transparent text-center text-sm font-semibold focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setTestBuyAmount((v) => Math.min(10000, v + 5))}
                    className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">=&nbsp;${testBuyAmount}</span>
                <Button
                  size="sm"
                  onClick={() => buyCredits.mutate(testBuyAmount)}
                  disabled={buyCredits.isPending}
                  className="ml-auto"
                >
                  {buyCredits.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Buy Now"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Usage History Chart ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Usage History</CardTitle>
          <CardDescription>Monthly credit usage over the last 6 months</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="live" stackId="usage" fill="var(--color-live)" radius={[0, 0, 0, 0]} maxBarSize={48} />
              <Bar dataKey="test" stackId="usage" fill="var(--color-test)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* ── Tabs ── */}
      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="auto-refill">Auto-Refill</TabsTrigger>
          <TabsTrigger value="costs">Service Costs</TabsTrigger>
        </TabsList>

        {/* ── Transactions ── */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Transaction History</CardTitle>
              <CardDescription>Recent credit activity across live and test modes</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-primary/5">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">Date</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">Type</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">Description</th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">Category</th>
                      <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">Amount</th>
                      <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                          No transactions yet
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.id} className="border-b last:border-0">
                          <td className="py-2.5 px-3 text-sm text-muted-foreground">
                            {formatDateTime(tx.created_at)}
                          </td>
                          <td className="py-2.5 px-3">
                            <TransactionTypeBadge type={tx.type} isTest={tx.is_test_mode} />
                          </td>
                          <td className="py-2.5 px-3 text-sm text-muted-foreground max-w-[300px] truncate">
                            {tx.description || "\u2014"}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-muted-foreground capitalize">
                            {tx.category || "\u2014"}
                          </td>
                          <td className={`py-2.5 px-3 text-sm font-medium text-right ${
                            tx.amount > 0 ? "text-green-500" : tx.amount < 0 ? "text-red-500" : "text-muted-foreground"
                          }`}>
                            {tx.amount > 0 ? "+" : ""}{tx.amount}
                          </td>
                          <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                            {tx.balance_after}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Auto-Refill ── */}
        <TabsContent value="auto-refill">
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Auto-Refill Settings</CardTitle>
              <CardDescription>
                Automatically top up live credits when balance drops below a threshold
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Enable Auto-Refill</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Charge your saved payment method automatically
                  </p>
                </div>
                <Switch
                  checked={autoRefillEnabled}
                  onCheckedChange={setAutoRefillEnabled}
                />
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
                        className="w-24"
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
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">
                        credits (${autoRefillAmount})
                      </span>
                    </div>
                  </div>
                </>
              )}

              <Button
                onClick={handleSaveAutoRefill}
                disabled={updateAutoRefill.isPending}
              >
                {updateAutoRefill.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Service Costs ── */}
        <TabsContent value="costs">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Service Costs</CardTitle>
              <CardDescription>
                Credits charged per service usage — test mode services use test credits, live mode uses live credits
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-primary/5">
                      <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Service</th>
                      <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Description</th>
                      <th className="text-right py-2.5 px-4 text-xs font-semibold text-primary">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((cost) => {
                      const Icon = CATEGORY_ICONS[cost.category] || CircleDollarSign;
                      return (
                        <tr key={cost.id} className="border-b last:border-0">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                                <Icon className="h-3.5 w-3.5 text-primary" />
                              </div>
                              <span className="text-sm font-medium">{cost.label}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-muted-foreground">
                            {cost.description || "\u2014"}
                          </td>
                          <td className="py-3 px-4 text-sm text-right font-medium">
                            {cost.cost_credits} {cost.cost_credits === 1 ? "credit" : "credits"}
                          </td>
                        </tr>
                      );
                    })}
                    {costs.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-sm text-muted-foreground">
                          No service costs configured
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
