import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerReview {
  id: string;
  rental_id: string;
  rating: number | null;
  comment: string | null;
  tags: string[];
  is_skipped: boolean;
  created_at: string;
  reviewer: { name: string } | null;
  rental: {
    rental_number: string;
    start_date: string;
    end_date: string | null;
    vehicle: { reg: string; make: string; model: string } | null;
  } | null;
}

export const useCustomerReviews = (customerId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-reviews", tenant?.id, customerId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rental_reviews")
        .select(`
          id,
          rental_id,
          rating,
          comment,
          tags,
          is_skipped,
          created_at,
          app_users!rental_reviews_reviewer_id_fkey(name),
          rentals!rental_reviews_rental_id_fkey(
            rental_number,
            start_date,
            end_date,
            vehicles!rentals_vehicle_id_fkey(reg, make, model)
          )
        `)
        .eq("customer_id", customerId)
        .eq("tenant_id", tenant!.id)
        .eq("is_skipped", false)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((r: any) => ({
        id: r.id,
        rental_id: r.rental_id,
        rating: r.rating,
        comment: r.comment,
        tags: r.tags || [],
        is_skipped: r.is_skipped,
        created_at: r.created_at,
        reviewer: r.app_users ? { name: r.app_users.name } : null,
        rental: r.rentals
          ? {
              rental_number: r.rentals.rental_number,
              start_date: r.rentals.start_date,
              end_date: r.rentals.end_date,
              vehicle: r.rentals.vehicles || null,
            }
          : null,
      })) as CustomerReview[];
    },
    enabled: !!tenant && !!customerId,
  });
};
