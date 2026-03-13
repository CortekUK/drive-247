"use client";

import { Badge } from "@/components/ui/badge";
import { Timer, Zap, AlertTriangle } from "lucide-react";

interface PlatformStatusBannerProps {
  mode: "trial" | "live" | "expired" | "no_subscription";
  trialDaysRemaining: number;
  wentLiveAt: string | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function PlatformStatusBanner({
  mode,
  trialDaysRemaining,
  wentLiveAt,
}: PlatformStatusBannerProps) {
  if (mode === "no_subscription" || mode === "trial") return null;

  // Hide "You're Live" banner after 7 days
  if (mode === "live" && wentLiveAt) {
    const elapsed = Date.now() - new Date(wentLiveAt).getTime();
    if (elapsed > SEVEN_DAYS_MS) return null;
  }

  return (
    <div
      className={`flex items-center justify-between rounded-xl px-4 py-3 ${
        mode === "live"
          ? "bg-green-500/10"
          : mode === "expired"
            ? "bg-red-500/10"
            : "bg-indigo-500/10"
      }`}
    >
      <div className="flex items-center gap-3">
        {mode === "live" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/15">
            <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
        ) : mode === "expired" ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/15">
            <Timer className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
        )}

        <div>
          {mode === "live" && (
            <>
              <p className="text-sm font-semibold">
                You're Live
              </p>
              <p className="text-xs text-muted-foreground">
                Your platform is operational and accepting bookings
              </p>
            </>
          )}
          {mode === "trial" && (
            <>
              <p className="text-sm font-semibold">
                Trial Mode{" "}
                <span className="text-indigo-600 dark:text-indigo-400">
                  · {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""}{" "}
                  remaining
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Explore the platform and set up your integrations. Everything
                runs in test mode during your trial.
              </p>
            </>
          )}
          {mode === "expired" && (
            <>
              <p className="text-sm font-semibold">
                Subscription Expired
              </p>
              <p className="text-xs text-muted-foreground">
                Renew your subscription to continue operations
              </p>
            </>
          )}
        </div>
      </div>

      <Badge
        variant="secondary"
        className={`shrink-0 text-[10px] font-bold ${
          mode === "live"
            ? "bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/15"
            : mode === "expired"
              ? "bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/15"
              : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/15"
        }`}
      >
        {mode === "live" ? "LIVE" : mode === "expired" ? "EXPIRED" : "TRIAL"}
      </Badge>
    </div>
  );
}
