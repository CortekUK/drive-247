import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface PendingBooking {
  id: string;
  rental_id: string;
  customer_id: string;
  vehicle_id: string;
  amount: number;
  payment_date: string;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  capture_status: string;
  preauth_expires_at: string | null;
  created_at: string;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    identity_verification_status: string | null;
  };
  rental: {
    id: string;
    start_date: string;
    end_date: string;
    rental_period_type: string;
    status: string;
  };
  vehicle: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
    colour: string | null;
  };
}

export const usePendingBookings = () => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["pending-bookings", tenant?.id],
    queryFn: async (): Promise<PendingBooking[]> => {
      console.log("Fetching pending bookings...");

      let query = supabase
        .from("payments")
        .select(
          `
          id,
          rental_id,
          customer_id,
          vehicle_id,
          amount,
          payment_date,
          stripe_payment_intent_id,
          stripe_checkout_session_id,
          capture_status,
          preauth_expires_at,
          created_at,
          customer:customers(
            id,
            name,
            email,
            phone,
            identity_verification_status
          ),
          rental:rentals(
            id,
            start_date,
            end_date,
            rental_period_type,
            status
          ),
          vehicle:vehicles(
            id,
            reg,
            make,
            model,
            colour
          )
        `
        )
        .eq("booking_source", "website")
        .eq("capture_status", "requires_capture");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching pending bookings:", error);
        throw error;
      }

      console.log("Pending bookings fetched:", data?.length || 0);
      return (data as unknown as PendingBooking[]) || [];
    },
    enabled: !!tenant,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
};

export const usePendingBookingsCount = () => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["pending-bookings-count", tenant?.id],
    queryFn: async (): Promise<number> => {
      let query = supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("booking_source", "website")
        .eq("capture_status", "requires_capture");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { count, error } = await query;

      if (error) {
        // Only log if there's an actual error message
        if (error.message || error.code) {
          console.error("Error fetching pending bookings count:", error.message || error);
        }
        return 0;
      }

      return count || 0;
    },
    enabled: !!tenant,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
};
