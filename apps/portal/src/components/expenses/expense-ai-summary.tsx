"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  Check,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useExpenseSummary, type SummaryScope } from "@/hooks/use-expense-summary";

interface Highlight {
  label: string;
  amount?: number;
  text?: string;
  sub?: string;
  trend?: "up" | "down" | "flat";
}
interface RichSummary {
  headline: string;
  narrative: string;
  insights: string[];
  highlights: Highlight[];
}

interface Props {
  scope: SummaryScope;
  current: { count: number; total: number };
  currencyCode: string;
  /** Generation costs an API call — gate behind edit permission. */
  canGenerate: boolean;
}

const STEPS = [
  "Gathering this tab's expenses",
  "Analysing categories",
  "Breaking down month over month",
  "Spotting trends",
  "Writing your summary",
];

/** Cosmetic stepper shown while the summary generates, for a more authentic feel. */
function GeneratingSteps() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-2.5">
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div
            key={label}
            className={cn(
              "flex items-center gap-2.5 text-sm transition-all duration-300",
              done && "text-muted-foreground",
              active && "text-foreground",
              !done && !active && "text-muted-foreground/40"
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {done ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={cn(active && "animate-pulse")}>
              {label}
              {active && "…"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function parseSummary(raw: string): RichSummary | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === "object" && (o.narrative || o.highlights)) {
      return {
        headline: typeof o.headline === "string" ? o.headline : "",
        narrative: typeof o.narrative === "string" ? o.narrative : "",
        insights: Array.isArray(o.insights) ? o.insights : [],
        highlights: Array.isArray(o.highlights) ? o.highlights : [],
      };
    }
  } catch {
    /* not JSON */
  }
  // Backward-compat: older summaries were plain text.
  return { headline: "", narrative: raw, insights: [], highlights: [] };
}

export function ExpenseAiSummary({ scope, current, currencyCode, canGenerate }: Props) {
  const { summary, generatedAt, hasSummary, isStale, isLoading, generate, isGenerating } =
    useExpenseSummary(scope, current);

  const rich = useMemo(() => (hasSummary ? parseSummary(summary) : null), [summary, hasSummary]);

  return (
    <div className="flex h-[400px] flex-col rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-medium text-foreground">AI Summary</h3>
          {isStale && !isGenerating && (
            <Badge variant="outline" className="text-[10px] font-normal text-amber-600">
              Outdated
            </Badge>
          )}
        </div>
        {canGenerate && (
          <Button
            size="sm"
            variant={hasSummary ? "outline" : "default"}
            onClick={() => generate()}
            disabled={isGenerating || current.count === 0}
          >
            {isGenerating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isGenerating ? "Analysing" : hasSummary ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>

      <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
        {isGenerating ? (
          <GeneratingSteps />
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rich ? (
          <div className="space-y-3.5">
            {rich.headline && (
              <p className="text-[15px] font-semibold leading-snug text-foreground">
                {rich.headline}
              </p>
            )}

            {rich.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {rich.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
                  >
                    <p className="text-[11px] text-muted-foreground">{h.label}</p>
                    <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
                      {h.amount != null ? formatCurrency(h.amount, currencyCode) : h.text}
                      {h.trend === "up" && (
                        <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      {h.trend === "down" && (
                        <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                    </p>
                    {h.sub && (
                      <p className="truncate text-[10px] text-muted-foreground/80">{h.sub}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {rich.narrative && (
              <p className="text-sm leading-relaxed text-foreground/75">{rich.narrative}</p>
            )}

            {rich.insights.length > 0 && (
              <ul className="space-y-1.5 border-t border-border/50 pt-3">
                {rich.insights.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {current.count === 0
              ? "Add some expenses, then generate an AI summary of this tab."
              : "No summary yet — click Generate to create a rich AI overview of this tab."}
          </p>
        )}
      </div>

      {generatedAt && hasSummary && !isGenerating && (
        <p className="mt-3 shrink-0 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          Generated {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
          {isStale && " · data has changed since"}
        </p>
      )}
    </div>
  );
}
