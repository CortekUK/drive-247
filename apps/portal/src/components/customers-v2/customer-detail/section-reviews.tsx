"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Reviews — what staff recorded after each rental, and the summary written from
 * them.
 *
 * The summary carries the count and average it was written from, so it can say
 * itself when it is behind. There is no "keep current" button: leaving it alone
 * IS keeping it.
 * ────────────────────────────────────────────────────────────────────────── */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { reviewAverage } from "./derive";
import { EmptyHint, Panel, Pill, ProducedFrom, Section, Stat, fmtDate, listCls } from "./kit";
import type { Drift } from "./kit";
import type { SectionProps } from "./sections";

/**
 * Rewrites the paragraph from the full set of reviews.
 *
 * There is no "keep the current one" write to make: the summary's staleness is
 * measured against `total_reviews`, which the edge function refreshes when it
 * regenerates. Leaving it alone IS keeping it, so the second button simply does
 * not exist here — an action that does nothing is worse than no action.
 */
function useRegenerateSummary(customerId: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("generate-review-summary", {
        body: { customerId, tenantId: tenant!.id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-review-summary"] });
      toast({ title: "Summary rewritten", description: "Written from every review on file." });
    },
    onError: (e: any) =>
      toast({ title: "Could not rewrite the summary", description: e.message, variant: "destructive" }),
  });
}

export function SectionReviews({ c, onJump, canEdit, drift }: SectionProps & { drift: Drift[] }) {
  const regenerate = useRegenerateSummary(c.id);
  const avg = reviewAverage(c);
  const stale = drift.length > 0;
  const completed = c.rentals.filter((r) => r.status === "Completed").length;

  return (
    <Panel
      title="Reviews"
      description="What staff thought of this customer. Internal — never shown to them, and never on the booking site."
    >
      <ProducedFrom sources={[{ key: "rentals", label: "Rentals" }]} onJump={onJump} />

      {stale && (
        <OutOfDate
          drift={drift}
          onRegenerate={() => regenerate.mutate()}
          disabled={!canEdit || regenerate.isPending}
        />
      )}

      {c.reviews.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Average" value={`${avg.toFixed(1)} / 10`} hint={`${c.reviews.length} reviews`} />
          <Stat
            label="Lowest"
            value={`${Math.min(...c.reviews.map((r) => r.rating))} / 10`}
            hint="Worst single handover"
          />
          <Stat
            label="Rentals reviewed"
            value={`${new Set(c.reviews.map((r) => r.rentalRef)).size} of ${completed}`}
            hint="Completed rentals with a review"
          />
        </div>
      )}

      {c.summary && (
        <Section
          title="What staff have said"
          description={`Written from ${c.summary.basedOn} review${
            c.summary.basedOn === 1 ? "" : "s"
          } on ${fmtDate(c.summary.generatedAt)}.`}
          right={<Pill tone={stale ? "warning" : "primary"}>{stale ? "Out of date" : "AI summary"}</Pill>}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">{c.summary.text}</p>
        </Section>
      )}

      {c.reviews.length === 0 ? (
        <EmptyHint>
          No one has rated this customer yet. A review is written against a rental as it closes, so the
          first one starts the average.
        </EmptyHint>
      ) : (
        <Section title="All reviews">
          <div className={listCls}>
            {c.reviews.map((r) => (
              <div key={r.id} className="flex gap-4 px-5 py-4">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-2xl font-heading text-sm font-semibold",
                    r.rating >= 8
                      ? "bg-success-light text-success"
                      : r.rating >= 5
                        ? "bg-primary-light text-primary"
                        : "bg-warning-light text-warning"
                  )}
                >
                  {r.rating}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed">{r.comment || "No comment left."}</p>
                  {r.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.tags.map((t) => (
                        <Pill key={t} tone="neutral">
                          {t}
                        </Pill>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.by} · {fmtDate(r.at)} · {r.rentalRef}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </Panel>
  );
}

/** The reviews banner. One way out, because there is only one real action. */
function OutOfDate({
  drift,
  onRegenerate,
  disabled,
}: {
  drift: Drift[];
  onRegenerate: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-4xl bg-warning-light/70 p-6 shadow-md ring-1 ring-warning/30">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold">
            The summary was written before the newest review landed
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Leaving it alone is a fair answer — the wording staff have already read stays as it is.
          </p>

          <div className="mt-4 divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-card/80 ring-1 ring-foreground/5">
            {drift.map((d) => (
              <div key={d.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3">
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">Written from</span>
                  <span className="block truncate font-medium line-through decoration-muted-foreground/50">
                    {d.was}
                  </span>
                </span>
                <span className="text-muted-foreground/60">→</span>
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">{d.label} now</span>
                  <span className="block truncate font-semibold text-foreground">{d.now}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <Button onClick={onRegenerate} disabled={disabled}>
              Rewrite the summary
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
