import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface CustomerRentalInstallmentPlan {
  id: string;
  plan_type: string;
  status: string;
  total_installable_amount: number;
  upfront_amount: number;
  installment_amount: number;
  number_of_installments: number;
  paid_installments: number | null;
  total_paid: number | null;
  next_due_date: string | null;
  scheduled_installments: {
    id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    status: string;
  }[];
}

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
  has_installment_plan: boolean | null;
  is_extended: boolean | null;
  previous_end_date: string | null;
  cancellation_requested: boolean | null;
  cancellation_reason: string | null;
  renewed_from_rental_id: string | null;
  extension_checkout_url: string | null;
  delivery_method: string | null;
  delivery_address: string | null;
  delivery_fee: number | null;
  document_status: string | null;
  docusign_envelope_id: string | null;
  signed_document_id: string | null;
  vehicles: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
    colour: string | null;
    photo_url: string | null;
    vehicle_photos: { photo_url: string }[];
  } | null;
  installment_plans: CustomerRentalInstallmentPlan[] | null;
}

export function useCustomerRentals(filter: 'all' | 'active' | 'current' | 'past' = 'all') {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-rentals', customerUser?.customer_id, filter],
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
          has_installment_plan,
          is_extended,
          previous_end_date,
          cancellation_requested,
          cancellation_reason,
          renewed_from_rental_id,
          extension_checkout_url,
          delivery_method,
          delivery_address,
          delivery_fee,
          document_status,
          docusign_envelope_id,
          signed_document_id,
          vehicles (
            id,
            reg,
            make,
            model,
            colour,
            photo_url,
            vehicle_photos (photo_url)
          ),
          installment_plans!installment_plans_rental_id_fkey (
            id,
            plan_type,
            status,
            total_installable_amount,
            upfront_amount,
            installment_amount,
            number_of_installments,
            paid_installments,
            total_paid,
            next_due_date,
            scheduled_installments (
              id,
              installment_number,
              amount,
              due_date,
              status
            )
          )
        `)
        .eq('customer_id', customerUser.customer_id);

      if (filter === 'active') {
        // Active: only rentals with status 'Active'
        query = query.eq('status', 'Active');
      } else if (filter === 'current') {
        // Current: end_date >= today AND status is Active/Pending/Reserved
        query = query
          .gte('end_date', today)
          .in('status', ['Active', 'Pending', 'Reserved']);
      } else if (filter === 'past') {
        // Past: end_date < today OR status is Completed/Cancelled/Ended
        query = query.or(`end_date.lt.${today},status.in.(Completed,Cancelled,Ended)`);
      }
      // 'all' - no additional filters

      const { data, error } = await query.order('start_date', { ascending: false });

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
