import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface CustomerRental {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  monthly_amount: number;
  rental_period_type: string;
  payment_status: string;
  approval_status: string;
  pickup_location: string | null;
  return_location: string | null;
  created_at: string;
  vehicles: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
    colour: string | null;
    photo_url: string | null;
    vehicle_photos: { photo_url: string }[];
  } | null;
}

export function useCustomerRentals(status: 'current' | 'past') {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-rentals', customerUser?.customer_id, status],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      const today = new Date().toISOString().split('T')[0];

      let query = supabase
        .from('rentals')
        .select(`
          id,
          start_date,
          end_date,
          status,
          monthly_amount,
          rental_period_type,
          payment_status,
          approval_status,
          pickup_location,
          return_location,
          created_at,
          vehicles (
            id,
            reg,
            make,
            model,
            colour,
            photo_url,
            vehicle_photos (photo_url)
          )
        `)
        .eq('customer_id', customerUser.customer_id);

      if (status === 'current') {
        // Current: end_date >= today AND status is Active/Pending/Reserved
        query = query
          .gte('end_date', today)
          .in('status', ['Active', 'Pending', 'Reserved']);
      } else {
        // Past: end_date < today OR status is Completed/Cancelled/Ended
        query = query.or(`end_date.lt.${today},status.in.(Completed,Cancelled,Ended)`);
      }

      const { data, error } = await query.order('start_date', { ascending: status === 'current' });

      if (error) {
        console.error('Error fetching customer rentals:', error);
        throw error;
      }

      return (data || []) as CustomerRental[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

// Hook to get rental stats
export function useCustomerRentalStats() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-rental-stats', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return null;

      const today = new Date().toISOString().split('T')[0];

      // Get all rentals for stats
      const { data, error } = await supabase
        .from('rentals')
        .select('id, status, end_date, monthly_amount')
        .eq('customer_id', customerUser.customer_id);

      if (error) {
        console.error('Error fetching rental stats:', error);
        throw error;
      }

      const rentals = data || [];

      const currentRentals = rentals.filter(
        (r) => r.end_date >= today && ['Active', 'Pending', 'Reserved'].includes(r.status)
      );

      const pastRentals = rentals.filter(
        (r) => r.end_date < today || ['Completed', 'Cancelled', 'Ended'].includes(r.status)
      );

      const totalSpent = rentals
        .filter((r) => r.status !== 'Cancelled')
        .reduce((sum, r) => sum + (r.monthly_amount || 0), 0);

      return {
        totalRentals: rentals.length,
        currentRentals: currentRentals.length,
        pastRentals: pastRentals.length,
        totalSpent,
      };
    },
    enabled: !!customerUser?.customer_id,
  });
}
