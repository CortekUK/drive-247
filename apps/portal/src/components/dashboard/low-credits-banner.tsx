"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { useTenant } from "@/contexts/TenantContext";

export function LowCreditsBanner() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { wallet, balance, isLowBalance, isLoading } = useCreditWallet();
  const [dismissed, setDismissed] = useState(true);

  const storageKey = tenant?.id ? `low-credits-dismissed-${tenant.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    setDismissed(localStorage.getItem(storageKey) === "true");
  }, [storageKey]);

  if (isLoading || !isLowBalance || dismissed) return null;

  const threshold = wallet?.low_balance_threshold ?? 10;

  const handleDismiss = () => {
    if (storageKey) localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <Card className="overflow-hidden border-0 shadow-lg">
      <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500" />
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="font-semibold text-base">
                Low credit balance
              </p>
              <p className="text-sm text-muted-foreground">
                You have <span className="font-medium text-foreground">{balance}</span>{" "}
                credit{balance === 1 ? "" : "s"} remaining (threshold: {threshold}).
                Top up to keep e-sign, SMS, and license checks running.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => router.push("/credits")}>
              Buy credits
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              aria-label="Dismiss low credits banner"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
