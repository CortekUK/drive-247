import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export type SummaryScope = "overall" | "business" | "vehicle";

interface ExpenseSummaryRow {
  summary: string;
  source_count: number;
  source_total: number;
  generated_at: string;
}

/**
 * Cached AI summary for one expense tab. The read pulls the persisted summary;
 * `generate()` calls the edge function to (re)create it. `isStale` compares the
 * cached source fingerprint against the tab's current totals.
 */
export function useExpenseSummary(
  scope: SummaryScope,
  current: { count: number; total: number }
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["expense-summary", tenant?.id, scope],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expense_ai_summaries")
        .select("summary, source_count, source_total, generated_at")
        .eq("tenant_id", tenant!.id)
        .eq("scope", scope)
        .maybeSingle();
      if (error) throw error;
      return (data as ExpenseSummaryRow | null) ?? null;
    },
    enabled: !!tenant,
  });

  const cached = query.data;

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-expense-summary", {
        body: { scope, tenantId: tenant?.id },
      });
      if (error) throw error;
      return data as ExpenseSummaryRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expense-summary", tenant?.id, scope] });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't generate summary",
        description: e?.message,
        variant: "destructive",
      }),
  });

  const hasSummary = !!cached?.summary;
  const isStale =
    hasSummary &&
    (cached!.source_count !== current.count ||
      Math.abs(Number(cached!.source_total) - current.total) > 0.5);

  return {
    summary: cached?.summary ?? "",
    generatedAt: cached?.generated_at ?? null,
    hasSummary,
    isStale,
    isLoading: query.isLoading,
    generate: generate.mutate,
    isGenerating: generate.isPending,
  };
}
