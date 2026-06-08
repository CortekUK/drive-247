"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tile } from "@/components/bento";
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
    <Tile variant="warn" pad="compact">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-bento-tile/60">
            <AlertTriangle className="h-5 w-5 text-bento-warn-accent" />
          </div>
          <div>
            <p className="font-bold tracking-tight text-base text-bento-warn-fg">
              Low credit balance
            </p>
            <p className="text-sm text-bento-warn-fg/80">
              You have{" "}
              <span className="font-mono tabular-nums font-semibold text-bento-warn-accent">
                {balance}
              </span>{" "}
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
            className="text-bento-warn-fg hover:bg-bento-tile/40"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Tile>
  );
}
