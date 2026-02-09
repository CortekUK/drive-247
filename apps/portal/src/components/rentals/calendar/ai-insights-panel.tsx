"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Clock,
  Lightbulb,
  Loader2,
  Zap,
} from "lucide-react";
import {
  useRentalInsights,
  RentalInsight,
} from "@/hooks/use-rental-insights";
import { VehicleTimelineData } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";

interface AIInsightsPanelProps {
  grouped: VehicleTimelineData[];
}

const insightIcons: Record<string, (className?: string) => React.ReactNode> = {
  gap: (cls) => <Clock className={cn("h-3.5 w-3.5", cls)} />,
  busy: (cls) => <TrendingUp className={cn("h-3.5 w-3.5", cls)} />,
  idle: (cls) => <AlertTriangle className={cn("h-3.5 w-3.5", cls)} />,
  recommendation: (cls) => <Lightbulb className={cn("h-3.5 w-3.5", cls)} />,
};

// Severity colors: light mode uses solid readable colors, dark mode uses neon glow
const severityNeon: Record<string, {
  border: string;
  bg: string;
  hover: string;
  glow: string;
  icon: string;
  badge: string;
  text: string;
}> = {
  success: {
    border: "border-emerald-200 dark:border-[rgba(57,255,20,0.3)]",
    bg: "bg-emerald-50 dark:bg-[rgba(57,255,20,0.08)]",
    hover: "hover:bg-emerald-100 dark:hover:bg-[rgba(57,255,20,0.15)]",
    glow: "dark:shadow-[0_0_12px_-3px_rgba(57,255,20,0.4)]",
    icon: "text-emerald-600 dark:text-[#39ff14] dark:drop-shadow-[0_0_5px_rgba(57,255,20,0.6)]",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-[rgba(57,255,20,0.15)] dark:text-[#39ff14]",
    text: "text-emerald-600 dark:text-[#39ff14]",
  },
  warning: {
    border: "border-amber-200 dark:border-[rgba(255,230,0,0.3)]",
    bg: "bg-amber-50 dark:bg-[rgba(255,230,0,0.08)]",
    hover: "hover:bg-amber-100 dark:hover:bg-[rgba(255,230,0,0.15)]",
    glow: "dark:shadow-[0_0_12px_-3px_rgba(255,230,0,0.4)]",
    icon: "text-amber-600 dark:text-[#ffe600] dark:drop-shadow-[0_0_5px_rgba(255,230,0,0.6)]",
    badge: "bg-amber-100 text-amber-700 dark:bg-[rgba(255,230,0,0.15)] dark:text-[#ffe600]",
    text: "text-amber-600 dark:text-[#ffe600]",
  },
  info: {
    border: "border-red-200 dark:border-[rgba(255,49,49,0.3)]",
    bg: "bg-red-50 dark:bg-[rgba(255,49,49,0.08)]",
    hover: "hover:bg-red-100 dark:hover:bg-[rgba(255,49,49,0.15)]",
    glow: "dark:shadow-[0_0_12px_-3px_rgba(255,49,49,0.4)]",
    icon: "text-red-600 dark:text-[#ff3131] dark:drop-shadow-[0_0_5px_rgba(255,49,49,0.6)]",
    badge: "bg-red-100 text-red-700 dark:bg-[rgba(255,49,49,0.15)] dark:text-[#ff3131]",
    text: "text-red-600 dark:text-[#ff3131]",
  },
};

function getSeverityStyle(severity: string) {
  return severityNeon[severity] || severityNeon.warning;
}

function MarqueeInsightChip({
  insight,
  onClick,
}: {
  insight: RentalInsight;
  onClick: () => void;
}) {
  const iconFn = insightIcons[insight.type] || insightIcons.recommendation;
  const s = getSeverityStyle(insight.severity);

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border shrink-0",
        "transition-all cursor-pointer",
        s.border, s.bg, s.hover, s.glow
      )}
    >
      {iconFn(s.icon)}
      <span className="text-xs font-semibold text-foreground whitespace-nowrap">
        {insight.title}
      </span>
      {insight.vehicleRefs && insight.vehicleRefs.length > 0 && (
        <Badge
          variant="secondary"
          className={cn("text-[9px] font-semibold px-2 py-0.5 border-0", s.badge)}
        >
          {insight.vehicleRefs[0]}
          {insight.vehicleRefs.length > 1 && ` +${insight.vehicleRefs.length - 1}`}
        </Badge>
      )}
    </button>
  );
}

function InsightDetailDialog({
  insight,
  open,
  onOpenChange,
}: {
  insight: RentalInsight | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!insight) return null;
  const iconFn = insightIcons[insight.type] || insightIcons.recommendation;
  const s = getSeverityStyle(insight.severity);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className={cn(
            "inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border w-fit mb-1",
            s.border, s.bg, s.glow
          )}>
            {iconFn(s.icon)}
            <span className={cn("text-[11px] font-semibold capitalize", s.text)}>
              {insight.type}
            </span>
          </div>
          <DialogTitle className="text-base">
            {insight.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {insight.description}
          </p>
          {insight.vehicleRefs && insight.vehicleRefs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground/70 mb-2">
                Related vehicles
              </p>
              <div className="flex flex-wrap gap-1.5">
                {insight.vehicleRefs.map((ref) => (
                  <Badge
                    key={ref}
                    variant="outline"
                    className={cn("text-xs font-semibold border", s.border, s.badge)}
                  >
                    {ref}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AIInsightsPanel({ grouped }: AIInsightsPanelProps) {
  const { data, isLoading, isFetching, error, refresh } = useRentalInsights(grouped);
  const [selectedInsight, setSelectedInsight] = useState<RentalInsight | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const isPaused = useRef(false);

  const isPending = isLoading || isFetching;

  // Marquee auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data?.insights?.length) return;

    let scrollPos = 0;
    const speed = 0.4;

    const tick = () => {
      if (!isPaused.current && el.scrollWidth > el.clientWidth) {
        scrollPos += speed;
        if (scrollPos >= el.scrollWidth / 2) {
          scrollPos = 0;
        }
        el.scrollLeft = scrollPos;
      }
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [data?.insights]);

  const insights = data?.insights || [];
  const marqueeInsights = insights.length > 0 ? [...insights, ...insights] : [];

  return (
    <>
      <div className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-md border border-accent/30 dark:border-accent/15 bg-gradient-to-r from-accent/10 dark:from-accent/[0.04] via-transparent to-transparent">
        {/* Trax branding */}
        <div className="flex items-center gap-1.5 shrink-0 pr-2.5 border-r border-accent/40 dark:border-accent/25">
          <div className="relative flex items-center justify-center h-6 w-6">
            <div className="absolute inset-0 rounded-full border border-accent/40 bg-accent/10 trax-ring" />
            <Zap className="h-3 w-3 text-accent trax-icon relative z-10" style={{ filter: 'drop-shadow(0 0 5px hsl(var(--accent) / 0.8))' }} />
          </div>
          <span className="text-xs font-extrabold tracking-widest text-accent" style={{ textShadow: '0 0 12px hsl(var(--accent) / 0.5), 0 0 24px hsl(var(--accent) / 0.25)' }}>
            Trax
          </span>
        </div>

        {/* Loading state — first load */}
        {isPending && !data && (
          <div className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 text-cyan-400/70 animate-spin" />
            <span className="text-[11px] text-muted-foreground/60">Trax is analyzing your fleet...</span>
          </div>
        )}

        {/* Loading state — refreshing with existing data */}
        {isPending && data && (
          <div className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 text-cyan-400/70 animate-spin" />
            <span className="text-[11px] text-muted-foreground/60">Refreshing...</span>
          </div>
        )}

        {error && !isPending && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-destructive/70">Failed</span>
            <button
              onClick={refresh}
              className="text-[11px] text-muted-foreground/60 hover:text-foreground/80 underline"
            >
              Retry
            </button>
          </div>
        )}

        {!data && !isPending && !error && grouped.length === 0 && (
          <span className="text-[11px] text-muted-foreground/50">No data to analyze</span>
        )}

        {/* Marquee chips */}
        {marqueeInsights.length > 0 && !isPending && (
          <div
            ref={scrollRef}
            className="flex-1 overflow-hidden"
            onMouseEnter={() => { isPaused.current = true; }}
            onMouseLeave={() => { isPaused.current = false; }}
          >
            <div className="flex items-center gap-2 w-max">
              {marqueeInsights.map((insight, i) => (
                <MarqueeInsightChip
                  key={`${insight.title}-${i}`}
                  insight={insight}
                  onClick={() => setSelectedInsight(insight)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Refresh button */}
        {!isPending && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-accent/80"
            onClick={refresh}
            disabled={isPending || grouped.length === 0}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Detail dialog */}
      <InsightDetailDialog
        insight={selectedInsight}
        open={!!selectedInsight}
        onOpenChange={(open) => {
          if (!open) setSelectedInsight(null);
        }}
      />
    </>
  );
}
