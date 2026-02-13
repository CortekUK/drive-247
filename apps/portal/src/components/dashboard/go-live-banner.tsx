"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, X } from "lucide-react";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useTenant } from "@/contexts/TenantContext";

export function GoLiveBanner() {
  const { tenant } = useTenant();
  const { justWentLive, isLive } = useSetupStatus();
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash

  const storageKey = tenant?.id ? `setup-hub-live-dismissed-${tenant.id}` : null;

  useEffect(() => {
    if (!storageKey) return;
    setDismissed(localStorage.getItem(storageKey) === "true");
  }, [storageKey]);

  if (!justWentLive || !isLive || dismissed) return null;

  const handleDismiss = () => {
    if (storageKey) localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <Card className="overflow-hidden border-0 shadow-lg">
      <div className="h-1.5 bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500" />
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30">
              <Rocket className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="font-semibold text-base">
                You're Live! <span aria-hidden>🎉</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Your Stripe Connect and Bonzah Insurance are now in live mode.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleDismiss} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
