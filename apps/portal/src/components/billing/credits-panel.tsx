"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCreditWallet, CreditTransaction } from "@/hooks/use-credit-wallet";
// Canary-only sample data, so the Credits surface can be reviewed on a tenant
// whose wallet has never been used. See billing-preview.tsx for why the gate is
// keyed on the tenant SLUG.
import {
  useBillingPreview,
  buildPreviewWallet,
  buildPreviewTransactions,
  PreviewDataPill,
  PreviewDisabledNote,
} from "@/components/billing/billing-preview";
import { usePlatformTos } from "@/hooks/use-platform-tos";
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
  ChevronDown,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  Plus,
  Minus,
} from "lucide-react";
import { toast } from "sonner";

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

function TransactionTypeBadge({ type }: { type: CreditTransaction["type"] }) {
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
      {/* No TEST badge. Test-mode rows are filtered out of this list entirely
          (see the transaction query), so a badge here would only ever label a
          row that should not be on a customer's billing history at all. */}
    </span>
  );
}

// ── Panel ────────────────────────────────────────────────────────────
// Extracted from the former standalone /credits page so it can be embedded as
// a tab inside /subscription ("Billing"). The page-level <h1> and outer
// container/padding stay with whichever page hosts this — see credits/page.tsx
// and subscription/page.tsx.

export function CreditsPanel() {
  const searchParams = useSearchParams();
  const {
    wallet: realWallet,
    balance: realBalance,
    isLowBalance,
    transactions: realTransactions,
    isLoading,
    buyCredits,
    updateAutoRefill,
    refetch,
  } = useCreditWallet();

  // ── Preview mode (canary tenant only) ──────────────────────────────────────
  //
  // A wallet that has never been topped up renders three zeroes, an empty
  // ledger and a flat chart, which tells a reviewer nothing about the design.
  // On the canary, and ONLY while the wallet is genuinely untouched, swap in
  // sample figures. Any real balance, any real test balance or a single real
  // transaction switches this straight back off — truth wins, always.
  //
  // `isLoading` counts as "has real data" so nothing is ever fabricated over a
  // query that simply has not answered yet.
  const hasRealCreditData =
    isLoading ||
    (!!realWallet &&
      /* `test_balance` still counts as REAL data even though it is no longer
         shown: a tenant holding only sandbox credits has a real wallet, and
         treating them as empty would swap it for the sample preview. */
      (realBalance > 0 || (realWallet.test_balance ?? 0) > 0 || realTransactions.length > 0)) ||
    realTransactions.length > 0;
  const previewActive = useBillingPreview(hasRealCreditData);

  const previewWallet = useMemo(
    () => (previewActive ? buildPreviewWallet() : null),
    [previewActive],
  );
  const previewTransactions = useMemo(
    () => (previewActive ? buildPreviewTransactions() : []),
    [previewActive],
  );

  const wallet = previewActive ? previewWallet : realWallet;
  const balance = previewActive ? previewWallet!.balance : realBalance;
  const transactions = previewActive ? previewTransactions : realTransactions;

  // Mirrors CREDIT_CONFIG.MIN_PURCHASE_CREDITS in the edge function: the
  // credits account settles in AED and Stripe rejects Checkout totals under
  // ~200 fils, so a sub-$1 purchase can never succeed.
  const MIN_PURCHASE_CREDITS = 5;
  const [liveBuyAmount, setLiveBuyAmount] = useState(10);
  const [autoRefillEnabled, setAutoRefillEnabled] = useState(false);
  const [autoRefillThreshold, setAutoRefillThreshold] = useState(10);
  const [autoRefillAmount, setAutoRefillAmount] = useState(50);
  const [timeRange, setTimeRange] = useState<TimeRange>("6m");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");

  /**
   * The platform-ToS CHECKBOX is gone from this screen, by decision.
   *
   * It used to sit above Buy Credits and disable it until ticked. Buying
   * credits is a small, repeated, in-product top-up, and putting a legal
   * acceptance in front of it made a two-click action into a four-click one
   * every time somebody ran low.
   *
   * What is NOT gone: acceptance is still asked for, and still recorded, on the
   * SUBSCRIBE path — `pricing-card.tsx` renders the same `TermsConsent`, and
   * that is the moment a tenant actually enters a commercial relationship. The
   * hook stays imported here so the acceptance state can still be reported
   * upward with the purchase when it is already on record.
   *
   * The consequence, stated plainly: a tenant created straight through the
   * admin dialog — who never meets the subscribe flow — can now buy credits
   * without an acceptance row. That was the case this checkbox was added for.
   * Removing it was asked for explicitly; the subscribe path still covers
   * everyone who signs up through the product.
   */
  const { needsAcceptance } = usePlatformTos();

  const handleBuyCredits = () => {
    // The button is disabled in preview; this is the second lock, because the
    // next line opens a real Stripe payment that really charges a card.
    if (previewActive) return;
    if (buyCredits.isPending) return;
    buyCredits.mutate({
      credits: liveBuyAmount,
      /* Still reported when it is already on record, so the purchase carries
         the same acceptance evidence it always did where one exists. */
      termsAccepted: needsAcceptance ? undefined : true,
    });
  };

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
    // Writes through an edge function to the real wallet row. Preview must not
    // persist anything, so this is inert while it is on.
    if (previewActive) return;
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
    <div className="space-y-5">
      {/* ── Header ──
          No Refresh button. The page already has one in its own header, and two
          refresh controls on one screen is a debug console, not a billing page.
          This panel is also embedded there, so the page-level one already
          refetches what this shows. */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Credits pay for e-signatures, verifications and messages.
        </p>
        {previewActive && <PreviewDataPill />}
      </div>
      {previewActive && <PreviewDisabledNote />}

      {/* ── One wide card: balance, amount, buy ────────────────────────────
          These were a narrow card floating in a two-column grid whose right
          half was empty, with the Buy button in the section header a full
          card-width away from the quantity it acts on. They are one row of one
          card now, because they are one action: this is what I have, this is
          how many I want, buy them. */}
      <Card className="overflow-hidden border-emerald-500/25 bg-emerald-500/[0.05] dark:bg-emerald-500/[0.07]">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between">
          {/* Balance */}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Live credits
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-bold leading-none tracking-tight text-emerald-700 dark:text-emerald-300">
                {balance.toFixed(0)}
              </span>
              <span className="text-sm text-emerald-700/60 dark:text-emerald-400/60">remaining</span>
            </div>
          </div>

          {/* Amount + buy, side by side and aligned on their baselines so the
              stepper and the button read as one control. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Amount to buy</p>
              <div className="flex w-fit items-center rounded-lg border bg-background">
                <button
                  type="button"
                  aria-label="Fewer credits"
                  onClick={() => setLiveBuyAmount((v) => Math.max(MIN_PURCHASE_CREDITS, v - 5))}
                  className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={MIN_PURCHASE_CREDITS}
                  max={10000}
                  value={liveBuyAmount}
                  onChange={(e) =>
                    setLiveBuyAmount(Math.max(MIN_PURCHASE_CREDITS, parseInt(e.target.value) || MIN_PURCHASE_CREDITS))
                  }
                  className="h-9 w-16 border-x bg-transparent text-center text-sm font-semibold focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label="More credits"
                  onClick={() => setLiveBuyAmount((v) => Math.min(10000, v + 5))}
                  className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <Button
              onClick={handleBuyCredits}
              disabled={buyCredits.isPending || previewActive}
              className="h-9 gap-2"
            >
              {buyCredits.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Buy {liveBuyAmount} credits
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* The "Service Costs" card stood here — a price list of credits per
           service (e-sign, license verification, Twilio). Removed from Billing
           by request: this page answers what you have and how to buy more, and
           a rate card is reference material that made the section wider and
           longer without helping either question.

           The RATES are untouched where they matter: the credit ledger still
           charges them, `credit_costs` is unchanged, and each usage row inside
           "Usage & settings" still shows what that particular action cost. What
           is gone is the standalone price list — nothing else on this page read
           it, so the query and its icon map went with it rather than being left
           behind as decoration. */}

      {/* ── Everything below is SECONDARY, and folded away ──────────────────
          Transaction history, the usage chart and auto-refill are useful and
          none of them is what somebody opens Billing to find. Left expanded
          they ran to three full-width cards and a chart, pushing Invoices &
          Receipts off the bottom of the screen and making the page feel like an
          analytics dashboard that happens to mention a plan.

          Folded, not deleted: every control still works, one click away, and
          the summary line says what is in there so the click is informed. */}
      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Usage &amp; settings</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Transaction history, usage over time, and auto&#8209;refill
            </p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-border/60 p-5">
      {/* ── Transaction History (full width) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Transaction History</CardTitle>
          <CardDescription>All credit activity including purchases, usage, refunds, and gifts</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b bg-primary/5">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Date</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Description</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-primary">Category</th>
                  <th className="text-right py-2.5 px-4 text-xs font-semibold text-primary">Amount</th>
                  <th className="text-right py-2.5 px-4 text-xs font-semibold text-primary">Balance</th>
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
                      <td className="py-2.5 px-4 text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(tx.created_at)}
                      </td>
                      <td className="py-2.5 px-4">
                        <TransactionTypeBadge type={tx.type} />
                      </td>
                      <td className="py-2.5 px-4 text-sm text-muted-foreground max-w-[300px] truncate">
                        {tx.description || "—"}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-muted-foreground capitalize">
                        {tx.category || "—"}
                      </td>
                      <td className={`py-2.5 px-4 text-sm font-medium text-right ${
                        tx.amount > 0 ? "text-green-500" : tx.amount < 0 ? "text-red-500" : "text-muted-foreground"
                      }`}>
                        {tx.amount > 0 ? "+" : ""}{tx.amount}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-right text-muted-foreground">
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

      {/* ── Usage History Chart (live only) ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Usage History</CardTitle>
              <CardDescription className="text-xs sm:text-sm">Live credit usage over time</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={integrationFilter} onValueChange={(v) => setIntegrationFilter(v as IntegrationFilter)}>
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
        </CardHeader>
        <CardContent className="overflow-hidden">
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={32} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="usage" fill="var(--color-usage)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* ── Auto-Refill Settings ── */}
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
                  <span className="text-sm text-muted-foreground">credits</span>
                </div>
              </div>
            </>
          )}

          <Button
            onClick={handleSaveAutoRefill}
            disabled={updateAutoRefill.isPending || previewActive}
            title={previewActive ? "Not available while previewing sample data" : undefined}
          >
            {updateAutoRefill.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
          {previewActive && (
            <p className="text-xs text-muted-foreground">
              Disabled while previewing — nothing here is saved.
            </p>
          )}
        </CardContent>
      </Card>
        </div>
      </details>
    </div>
  );
}
