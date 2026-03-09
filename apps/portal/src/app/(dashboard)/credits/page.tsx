"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
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
import {
  BarChart3,
  CircleDollarSign,
  FlaskConical,
  Loader2,
  RefreshCw,
  Plus,
  Minus,
  FileSignature,
  MessageSquare,
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


const CATEGORY_ICONS: Record<string, any> = {
  esign: FileSignature,
  twilio: MessageSquare,
  sms: MessageSquare,
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

      {/* ── Balance Cards + Transaction History ── */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1fr_1.5fr]">
        {/* Left: Balance Cards */}
        <div className="space-y-6">
          {/* Live Credits */}
          <Card className="overflow-hidden transition-all duration-200 hover:shadow-md border-emerald-500/30 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.08]">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Live Credits</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold tracking-tight ${isLowBalance ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}>
                      {balance.toFixed(0)}
                    </span>
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
                  <FlaskConical className="h-6 w-6 text-yellow-500" />
                </div>
              </div>

              <div className="mt-5 pt-5 border-t">
                <p className="text-xs text-muted-foreground">
                  Free sandbox credits for testing integrations in test mode. Cannot be purchased.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Service Costs — compact cards */}
          <div>
            <h3 className="text-sm font-medium mb-1.5">Service Costs</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Credits per service — test mode uses test credits, live mode uses live credits
            </p>
            <div className="grid gap-2">
              {costs.map((cost) => {
                const Icon = CATEGORY_ICONS[cost.category] || CircleDollarSign;
                return (
                  <div key={cost.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{cost.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{cost.description || "\u2014"}</p>
                    </div>
                    <span className="text-sm font-semibold shrink-0">
                      {cost.cost_credits} {cost.cost_credits === 1 ? "cr" : "cr"}
                    </span>
                  </div>
                );
              })}
              {costs.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No service costs configured</p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Transaction History */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Transaction History</CardTitle>
            <CardDescription>All credit activity including purchases, usage, refunds, and gifts</CardDescription>
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
                        <td className="py-2.5 px-3 text-sm text-muted-foreground whitespace-nowrap">
                          {formatDateTime(tx.created_at)}
                        </td>
                        <td className="py-2.5 px-3">
                          <TransactionTypeBadge type={tx.type} isTest={tx.is_test_mode} />
                        </td>
                        <td className="py-2.5 px-3 text-sm text-muted-foreground max-w-[200px] truncate">
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
      </div>

      {/* Analytics Button */}
      <div className="flex justify-end">
        <Link href="/credits/analytics">
          <Button variant="outline" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
            <BarChart3 className="h-4 w-4 mr-2" />
            View Analytics
          </Button>
        </Link>
      </div>

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
            disabled={updateAutoRefill.isPending}
          >
            {updateAutoRefill.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
