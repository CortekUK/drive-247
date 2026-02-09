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
  paid_amount: number; // Calculated from payments
  computed_status: 'paid' | 'partial' | 'pending' | 'overdue'; // Computed status
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

      // Fetch invoices
      let query = supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          due_date,
          rental_id,
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

      const { data: invoices, error } = await query;

      if (error) {
        console.error('Error fetching customer invoices:', error);
        throw error;
      }

      if (!invoices || invoices.length === 0) {
        return [];
      }

      // Get all rental IDs to fetch payments
      const rentalIds = [...new Set(invoices.map(i => i.rental_id).filter(Boolean))];

      // Fetch payments for these rentals
      // Only count payments that are actually captured (not pre-authorizations)
      const { data: payments } = await supabase
        .from('payments')
        .select('rental_id, amount, status, capture_status')
        .in('rental_id', rentalIds)
        .eq('status', 'Applied');

      // Calculate paid amounts per rental
      // Only count payments that are captured (not pre-authorizations still pending capture)
      const paidByRental = new Map<string, number>();
      (payments || []).forEach((p: any) => {
        if (p.rental_id) {
          // Only count if capture_status is 'captured' or null (for older payments without pre-auth)
          // Skip payments with 'requires_capture' or other non-captured statuses
          const isCaptured = !p.capture_status || p.capture_status === 'captured';
          if (isCaptured) {
            paidByRental.set(p.rental_id, (paidByRental.get(p.rental_id) || 0) + p.amount);
          }
        }
      });

      // Compute status for each invoice
      const today = new Date();
      const enrichedInvoices = invoices.map(invoice => {
        const paidAmount = invoice.rental_id ? (paidByRental.get(invoice.rental_id) || 0) : 0;
        const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;

        let computedStatus: 'paid' | 'partial' | 'pending' | 'overdue';
        if (paidAmount >= invoice.total_amount) {
          computedStatus = 'paid';
        } else if (paidAmount > 0) {
          computedStatus = 'partial';
        } else if (dueDate && dueDate < today) {
          computedStatus = 'overdue';
        } else {
          computedStatus = 'pending';
        }

        return {
          ...invoice,
          paid_amount: paidAmount,
          computed_status: computedStatus,
        };
      });

      return enrichedInvoices as CustomerInvoice[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

// Get invoice stats
export function useInvoiceStats() {
  const { data: invoices, ...rest } = useCustomerInvoices();

  const stats = (() => {
    if (!invoices) return null;

    const paidInvoices = invoices.filter(i => i.computed_status === 'paid');
    const pendingInvoices = invoices.filter(i => i.computed_status === 'pending' || i.computed_status === 'partial');
    const overdueInvoices = invoices.filter(i => i.computed_status === 'overdue');

    const totalPaid = invoices.reduce((sum, i) => sum + i.paid_amount, 0);
    const totalDue = invoices.reduce((sum, i) => {
      const remaining = i.total_amount - i.paid_amount;
      return sum + (remaining > 0 ? remaining : 0);
    }, 0);

    return {
      totalInvoices: invoices.length,
      paidCount: paidInvoices.length,
      pendingCount: pendingInvoices.length,
      overdueCount: overdueInvoices.length,
      totalPaid,
      totalDue,
    };
  })();

  return { data: stats, ...rest };
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
