"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Timer, ArrowRight } from "lucide-react";
import { useSetupStatus } from "@/hooks/use-setup-status";

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center bg-muted/50 rounded-lg px-3 py-2 min-w-[60px]">
      <span className="text-2xl font-bold tabular-nums">{String(value).padStart(2, "0")}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

export function SetupHub() {
  const router = useRouter();
  const { setupItems, progressPercent, allComplete, isTrialing, trialEnd } = useSetupStatus();
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    if (!trialEnd) return;

    const update = () => {
      const now = Date.now();
      const end = new Date(trialEnd).getTime();
      const diff = Math.max(0, end - now);
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [trialEnd]);

  if (!isTrialing) return null;

  return (
    <Card className="overflow-hidden border-0 shadow-lg">
      <div className="h-1.5 bg-gradient-to-r from-primary via-blue-500 to-purple-500" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">Setup Hub</CardTitle>
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">
              <Timer className="h-3 w-3 mr-1" />
              Test Mode
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Countdown */}
        <div>
          <p className="text-sm text-muted-foreground mb-2">Setup window ends in</p>
          <div className="flex gap-2">
            <CountdownUnit value={timeLeft.days} label="Days" />
            <CountdownUnit value={timeLeft.hours} label="Hours" />
            <CountdownUnit value={timeLeft.minutes} label="Min" />
            <CountdownUnit value={timeLeft.seconds} label="Sec" />
          </div>
        </div>

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium">Integration Progress</span>
            <span className="text-sm text-muted-foreground">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Checklist */}
        <div className="space-y-2">
          {setupItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-3">
                {item.isComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
              {!item.isComplete && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(item.settingsPath)}
                >
                  Set up
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Summary */}
        <p className="text-xs text-muted-foreground">
          {allComplete
            ? "All integrations configured! They'll automatically switch to live mode when your setup window ends."
            : "Complete your integrations above. Both Stripe Connect and Bonzah are in test mode during setup and will auto-switch to live mode when the timer ends."}
        </p>
      </CardContent>
    </Card>
  );
}
