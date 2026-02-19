"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, RefreshCw, Settings } from "lucide-react";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { useBonzahAlertConfig } from "@/hooks/use-bonzah-alert-config";

export function BonzahBalanceWidget() {
  const router = useRouter();
  const { balanceNumber, isBonzahConnected, refetch, isFetching } = useBonzahBalance();
  const { config } = useBonzahAlertConfig();

  if (!isBonzahConnected) return null;

  const threshold = config?.enabled ? config.threshold : null;
  const isLow = threshold != null && balanceNumber != null && balanceNumber < threshold;

  const formattedBalance =
    balanceNumber != null
      ? `$${balanceNumber.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "---";

  return (
    <Card className={`overflow-hidden border ${isLow ? "border-red-300 dark:border-red-800" : "border-amber-200 dark:border-amber-800"}`}>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center justify-center h-10 w-10 rounded-full ${
                isLow
                  ? "bg-red-100 dark:bg-red-900/30"
                  : "bg-amber-100 dark:bg-amber-900/30"
              }`}
            >
              <Wallet
                className={`h-5 w-5 ${
                  isLow
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">
                Bonzah Balance
              </p>
              <div className="flex items-center gap-2">
                <p
                  className={`text-xl font-bold ${
                    isLow
                      ? "text-red-700 dark:text-red-300"
                      : "text-amber-900 dark:text-amber-200"
                  }`}
                >
                  {formattedBalance}
                </p>
                {isLow && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    LOW
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 w-8 text-muted-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/settings?tab=integrations")}
              className="h-8 w-8 text-muted-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
