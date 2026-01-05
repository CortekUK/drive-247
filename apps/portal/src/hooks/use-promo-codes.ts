import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";

export interface PromoCode {
  id: string;
  title: string;
  description: string;
  promo_code: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  minimum_spend: number | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  image_url: string | null;
  tenant_id: string | null;
  created_at: string | null;
}

export interface PromoCodeInput {
  title: string;
  description: string;
  promo_code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  minimum_spend?: number;
  start_date: string;
  end_date: string;
  is_active?: boolean;
}

export const usePromoCodes = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch all promo codes for the tenant
  const {
    data: promoCodes = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["promo-codes", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as PromoCode[];
    },
    enabled: !!tenant?.id,
  });

  // Create a new promo code
  const createPromoCode = useMutation({
    mutationFn: async (input: PromoCodeInput) => {
      if (!tenant?.id) throw new Error("No tenant context");

      // Check if promo code already exists
      const { data: existing } = await supabase
        .from("promotions")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("promo_code", input.promo_code.toUpperCase())
        .single();

      if (existing) {
        throw new Error("A promo code with this code already exists");
      }

      const { data, error } = await supabase
        .from("promotions")
        .insert({
          tenant_id: tenant.id,
          title: input.title,
          description: input.description,
          promo_code: input.promo_code.toUpperCase(),
          discount_type: input.discount_type,
          discount_value: input.discount_value,
          minimum_spend: input.minimum_spend || 0,
          start_date: input.start_date,
          end_date: input.end_date,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast({
        title: "Promo Code Created",
        description: "The promo code has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create promo code",
        variant: "destructive",
      });
    },
  });

  // Update an existing promo code
  const updatePromoCode = useMutation({
    mutationFn: async ({ id, ...input }: PromoCodeInput & { id: string }) => {
      if (!tenant?.id) throw new Error("No tenant context");

      // Check if promo code already exists (excluding current one)
      if (input.promo_code) {
        const { data: existing } = await supabase
          .from("promotions")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("promo_code", input.promo_code.toUpperCase())
          .neq("id", id)
          .single();

        if (existing) {
          throw new Error("A promo code with this code already exists");
        }
      }

      const { data, error } = await supabase
        .from("promotions")
        .update({
          title: input.title,
          description: input.description,
          promo_code: input.promo_code?.toUpperCase(),
          discount_type: input.discount_type,
          discount_value: input.discount_value,
          minimum_spend: input.minimum_spend || 0,
          start_date: input.start_date,
          end_date: input.end_date,
          is_active: input.is_active,
        })
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast({
        title: "Promo Code Updated",
        description: "The promo code has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update promo code",
        variant: "destructive",
      });
    },
  });

  // Delete a promo code
  const deletePromoCode = useMutation({
    mutationFn: async (id: string) => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { error } = await supabase
        .from("promotions")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenant.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast({
        title: "Promo Code Deleted",
        description: "The promo code has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete promo code",
        variant: "destructive",
      });
    },
  });

  // Toggle promo code active status
  const togglePromoCodeStatus = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("promotions")
        .update({ is_active })
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["promo-codes"] });
      toast({
        title: data.is_active ? "Promo Code Activated" : "Promo Code Deactivated",
        description: `The promo code has been ${data.is_active ? 'activated' : 'deactivated'}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update promo code status",
        variant: "destructive",
      });
    },
  });

  return {
    promoCodes,
    isLoading,
    error,
    createPromoCode,
    updatePromoCode,
    deletePromoCode,
    togglePromoCodeStatus,
  };
};
