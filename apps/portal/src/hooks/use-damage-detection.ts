import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";

export type DamageSeverity = "minor" | "moderate" | "severe";
export type OverallSeverity = "none" | DamageSeverity;

export interface DamageFinding {
  location: string;
  description: string;
  severity: DamageSeverity;
  confidence: number;
  before_photo_index: number | null;
  after_photo_index: number | null;
}

export interface DamageReport {
  id: string;
  rental_id: string;
  tenant_id: string;
  generated_by: string | null;
  summary: string | null;
  findings: DamageFinding[];
  overall_severity: OverallSeverity | null;
  has_new_damage: boolean;
  giving_photo_count: number;
  receiving_photo_count: number;
  model: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export const useDamageReport = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["damage-report", tenant?.id, rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rental_damage_reports")
        .select("*")
        .eq("rental_id", rentalId)
        .maybeSingle();

      if (error) throw error;
      return data as DamageReport | null;
    },
    enabled: !!tenant && !!rentalId,
  });
};

export const useDetectDamage = (rentalId: string | undefined) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      if (!rentalId) throw new Error("Rental ID is required");

      const { data, error } = await supabase.functions.invoke("detect-vehicle-damage", {
        body: { rentalId },
      });

      if (error) {
        const msg = (error as any)?.context?.error || error.message || "Damage detection failed";
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      return data?.report as DamageReport;
    },
    onSuccess: (data) => {
      const findings = data?.findings?.length || 0;
      toast({
        title: "Damage analysis complete",
        description: data?.has_new_damage
          ? `${findings} potential issue${findings === 1 ? "" : "s"} flagged for review`
          : "No new damage detected",
      });
      queryClient.invalidateQueries({ queryKey: ["damage-report", tenant?.id, rentalId] });
    },
    onError: (error: Error) => {
      toast({ title: "Damage analysis failed", description: error.message, variant: "destructive" });
    },
  });
};

export const useReviewDamageReport = (rentalId: string | undefined) => {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { reviewerNotes?: string | null }) => {
      if (!rentalId) throw new Error("Rental ID is required");

      const { data, error } = await (supabase as any)
        .from("rental_damage_reports")
        .update({
          reviewed_by: appUser?.id ?? null,
          reviewed_at: new Date().toISOString(),
          reviewer_notes: payload.reviewerNotes ?? null,
        })
        .eq("rental_id", rentalId)
        .select()
        .single();

      if (error) throw error;
      return data as DamageReport;
    },
    onSuccess: () => {
      toast({ title: "Marked as reviewed" });
      queryClient.invalidateQueries({ queryKey: ["damage-report", tenant?.id, rentalId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};
