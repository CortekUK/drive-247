"use client";

import { StatusPill } from "@/components/bento";
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

  const tone =
    mode === "live" ? "success" : mode === "expired" ? "danger" : "primary";

  const chipBg =
    mode === "live"
      ? "bg-bento-success-weak"
      : mode === "expired"
        ? "bg-bento-danger-weak"
        : "bg-bento-primary-weak";

  const iconColor =
    mode === "live"
      ? "text-bento-success"
      : mode === "expired"
        ? "text-bento-danger-fg"
        : "text-bento-primary-weak-fg";

  return (
    <div className="flex items-center justify-between rounded-tile border border-border bg-bento-tile px-4 py-3 shadow-bento">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full ${chipBg}`}
        >
          {mode === "live" ? (
            <Zap className={`h-4 w-4 ${iconColor}`} />
          ) : mode === "expired" ? (
            <AlertTriangle className={`h-4 w-4 ${iconColor}`} />
          ) : (
            <Timer className={`h-4 w-4 ${iconColor}`} />
          )}
        </div>

        <div>
          {mode === "live" && (
            <>
              <p className="text-sm font-bold tracking-tight text-foreground">
                You're Live
              </p>
              <p className="text-xs text-bento-text-2">
                Your platform is operational and accepting bookings
              </p>
            </>
          )}
          {mode === "expired" && (
            <>
              <p className="text-sm font-bold tracking-tight text-foreground">
                Subscription Expired
              </p>
              <p className="text-xs text-bento-text-2">
                Renew your subscription to continue operations
              </p>
            </>
          )}
        </div>
      </div>

      <StatusPill tone={tone} dot>
        {mode === "live" ? "Live" : mode === "expired" ? "Expired" : "Trial"}
      </StatusPill>
    </div>
  );
}
