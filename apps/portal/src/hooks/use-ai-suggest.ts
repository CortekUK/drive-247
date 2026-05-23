/**
 * useAISuggest — Spec Section 11.2.
 * Calls ai-suggest-next-action and surfaces the result to the right column.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AISuggestion {
  action: string;
  confidence: number;
  draftMessage?: string;
  reasoning?: string;
  source?: "ai" | "fallback" | "cache";
}

export function useAISuggest(leadId: string | undefined, lastActivityAt?: string) {
  return useQuery({
    queryKey: ["ai-suggest", leadId, lastActivityAt],
    queryFn: async (): Promise<AISuggestion | null> => {
      if (!leadId) return null;
      const { data, error } = await supabase.functions.invoke<AISuggestion>("ai-suggest-next-action", {
        body: { leadId },
      });
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!leadId,
    staleTime: 5 * 60_000,
  });
}
