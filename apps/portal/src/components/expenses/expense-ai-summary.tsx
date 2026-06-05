"use client";

import { formatDistanceToNow } from "date-fns";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useExpenseSummary, type SummaryScope } from "@/hooks/use-expense-summary";

interface Props {
  scope: SummaryScope;
  current: { count: number; total: number };
  /** Generation costs an API call — gate behind edit permission. */
  canGenerate: boolean;
}

export function ExpenseAiSummary({ scope, current, canGenerate }: Props) {
  const { summary, generatedAt, hasSummary, isStale, isLoading, generate, isGenerating } =
    useExpenseSummary(scope, current);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-medium text-foreground">AI Summary</h3>
          {isStale && (
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
            {hasSummary ? "Regenerate" : "Generate"}
          </Button>
        )}
      </div>

      <div className="flex-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hasSummary ? (
          <p className="text-sm leading-relaxed text-foreground/90">{summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {current.count === 0
              ? "Add some expenses, then generate an AI summary of this tab."
              : "No summary yet — click Generate to create a quick AI overview of this tab."}
          </p>
        )}
      </div>

      {generatedAt && hasSummary && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Generated {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
          {isStale && " · data has changed since"}
        </p>
      )}
    </div>
  );
}
