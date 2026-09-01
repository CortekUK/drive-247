import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";

export interface RentalReview {
  id: string;
  rental_id: string;
  customer_id: string;
  tenant_id: string;
  reviewer_id: string;
  rating: number | null;
  comment: string | null;
  tags: string[];
  is_skipped: boolean;
  created_at: string;
  updated_at: string;
}

export const useRentalReview = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-review", tenant?.id, rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rental_reviews")
        .select("*")
        .eq("rental_id", rentalId)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();

      if (error) throw error;
      return data as RentalReview | null;
    },
    enabled: !!tenant && !!rentalId,
  });
};

interface SubmitReviewPayload {
  rentalId: string;
  customerId: string;
  rating: number;
  comment?: string;
  tags?: string[];
  existingReviewId?: string;
}

export const useSubmitRentalReview = () => {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: SubmitReviewPayload) => {
      const reviewData = {
        rental_id: payload.rentalId,
        customer_id: payload.customerId,
        tenant_id: tenant!.id,
        reviewer_id: appUser!.id,
        rating: payload.rating,
        comment: payload.comment || null,
        tags: payload.tags || [],
        is_skipped: false,
      };

      let result;
      if (payload.existingReviewId) {
        const { data, error } = await (supabase as any)
          .from("rental_reviews")
          .update(reviewData)
          .eq("id", payload.existingReviewId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await (supabase as any)
          .from("rental_reviews")
          .insert(reviewData)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      // Fire-and-forget: generate AI summary
      supabase.functions.invoke("generate-review-summary", {
        body: { customerId: payload.customerId, tenantId: tenant!.id },
      }).catch((err) => console.error("Failed to generate review summary:", err));

      return result;
    },
    onSuccess: (_data, variables) => {
      toast({ title: "Review Submitted", description: "Your review has been saved." });
      queryClient.invalidateQueries({ queryKey: ["rental-review"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-review-summary"] });
      queryClient.invalidateQueries({ queryKey: ["customer-reviews"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useSkipRentalReview = () => {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { rentalId: string; customerId: string; existingReviewId?: string }) => {
      const reviewData = {
        rental_id: payload.rentalId,
        customer_id: payload.customerId,
        tenant_id: tenant!.id,
        reviewer_id: appUser!.id,
        rating: null,
        comment: null,
        tags: [],
        is_skipped: true,
      };

      if (payload.existingReviewId) {
        const { data, error } = await (supabase as any)
          .from("rental_reviews")
          .update(reviewData)
          .eq("id", payload.existingReviewId)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await (supabase as any)
          .from("rental_reviews")
          .insert(reviewData)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      toast({ title: "Review Skipped", description: "You can add a review later." });
      queryClient.invalidateQueries({ queryKey: ["rental-review"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-review-summary"] });
      queryClient.invalidateQueries({ queryKey: ["customer-reviews"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};
