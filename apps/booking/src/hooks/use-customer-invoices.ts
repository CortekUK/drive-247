import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface CustomerInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  rental_fee: number | null;
  protection_fee: number | null;
  service_fee: number | null;
  security_deposit: number | null;
  tax_amount: number | null;
  subtotal: number;
  total_amount: number;
  status: string | null;
  notes: string | null;
  vehicles: {
    reg: string;
    make: string | null;
    model: string | null;
  } | null;
  rentals: {
    rental_number: string | null;
    start_date: string;
    end_date: string;
  } | null;
}

export function useCustomerInvoices(limit?: number) {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-invoices', customerUser?.customer_id, limit],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      let query = supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          due_date,
          rental_fee,
          protection_fee,
          service_fee,
          security_deposit,
          tax_amount,
          subtotal,
          total_amount,
          status,
          notes,
          vehicles:vehicle_id (
            reg,
            make,
            model
          ),
          rentals:rental_id (
            rental_number,
            start_date,
            end_date
          )
        `)
        .eq('customer_id', customerUser.customer_id)
        .order('invoice_date', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching customer invoices:', error);
        throw error;
      }

      return (data || []) as CustomerInvoice[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

export function useInvoiceById(invoiceId: string | undefined) {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-invoice', invoiceId],
    queryFn: async () => {
      if (!customerUser?.customer_id || !invoiceId) return null;

      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          due_date,
          rental_fee,
          protection_fee,
          service_fee,
          security_deposit,
          tax_amount,
          subtotal,
          total_amount,
          status,
          notes,
          vehicles:vehicle_id (
            reg,
            make,
            model
          ),
          rentals:rental_id (
            rental_number,
            start_date,
            end_date
          )
        `)
        .eq('id', invoiceId)
        .eq('customer_id', customerUser.customer_id)
        .single();

      if (error) {
        console.error('Error fetching invoice:', error);
        throw error;
      }

      return data as CustomerInvoice;
    },
    enabled: !!customerUser?.customer_id && !!invoiceId,
  });
}
