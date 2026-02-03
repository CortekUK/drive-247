import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PaymentFilters } from "@/components/payments/payment-filters";
import { useTenant } from "@/contexts/TenantContext";
import { formatInTimeZone } from "date-fns-tz";

// Helper to format date in America/New_York timezone for database queries
const formatDateForDB = (date: Date): string => {
  return formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
};

export interface PaymentRow {
  id: string;
  amount: number;
  payment_date: string;
  method: string | null;
  payment_type: string;
  status: string;
  remaining_amount: number;
  verification_status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  is_manual_mode: boolean;
  // Fields needed for reverse payment check
  stripe_payment_intent_id: string | null;
  refund_status: string | null;
  refund_reason: string | null;

  customers: {
    id: string;
    name: string;
  };
  vehicles: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
  } | null;
  rentals: {
    id: string;
    rental_number: string | null;
  } | null;
}

interface UsePaymentsDataOptions {
  filters: PaymentFilters;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const usePaymentsData = ({
  filters,
  sortBy,
  sortOrder,
  page,
  pageSize
}: UsePaymentsDataOptions) => {
  const { tenant } = useTenant();

  // Create a stable query key by serializing Date objects to strings
  const stableQueryKey = [
    "payments-data",
    tenant?.id,
    filters.customerSearch,
    filters.vehicleSearch,
    filters.method,
    filters.verificationStatus,
    filters.dateFrom?.toISOString(),
    filters.dateTo?.toISOString(),
    filters.quickFilter,
    sortBy,
    sortOrder,
    page,
    pageSize
  ];

  return useQuery({
    queryKey: stableQueryKey,
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      // If vehicle search is provided, first get matching vehicle IDs
      let vehicleIds: string[] | null = null;
      if (filters.vehicleSearch) {
        const searchTerm = filters.vehicleSearch.toLowerCase();
        let vehicleSearchQuery = supabase
          .from("vehicles")
          .select("id, reg, make, model");

        if (tenant?.id) {
          vehicleSearchQuery = vehicleSearchQuery.eq("tenant_id", tenant.id);
        }

        const { data: matchingVehicles } = await vehicleSearchQuery;

        if (matchingVehicles) {
          vehicleIds = matchingVehicles
            .filter(v =>
              v.reg?.toLowerCase().includes(searchTerm) ||
              v.make?.toLowerCase().includes(searchTerm) ||
              v.model?.toLowerCase().includes(searchTerm)
            )
            .map(v => v.id);
        }
      }

      let query = supabase
        .from("payments")
        .select(`
          *,
          customers!payments_customer_id_fkey(id, name),
          vehicles!payments_vehicle_id_fkey(id, reg, make, model),
          rentals!payments_rental_id_fkey(id, rental_number)
        `, { count: 'exact' })
        .eq("tenant_id", tenant.id);

      // Apply filters
      if (filters.customerSearch) {
        query = query.ilike("customers.name", `%${filters.customerSearch}%`);
      }

      // Apply vehicle filter using IDs from pre-query
      if (vehicleIds !== null) {
        if (vehicleIds.length === 0) {
          // No matching vehicles found, return empty result
          return {
            payments: [] as PaymentRow[],
            totalCount: 0,
            totalPages: 0
          };
        }
        query = query.in("vehicle_id", vehicleIds);
      }

      if (filters.method && filters.method !== 'all') {
        query = query.eq("method", filters.method);
      }

      if (filters.verificationStatus && filters.verificationStatus !== 'all') {
        query = query.eq("verification_status", filters.verificationStatus);
      }

      if (filters.dateFrom) {
        query = query.gte("payment_date", formatDateForDB(filters.dateFrom));
      }

      if (filters.dateTo) {
        query = query.lte("payment_date", formatDateForDB(filters.dateTo));
      }

      // Apply sorting
      const sortColumn = sortBy === 'customer' ? 'customers.name' :
                        sortBy === 'vehicle' ? 'vehicles.reg' :
                        sortBy;

      query = query.order(sortColumn, { ascending: sortOrder === 'asc' });

      // Add secondary sort by created_at to ensure newest payments appear first when dates are equal
      if (sortColumn !== 'created_at') {
        query = query.order('created_at', { ascending: false });
      }

      // Apply pagination
      const start = (page - 1) * pageSize;
      const end = start + pageSize - 1;
      query = query.range(start, end);

      const { data, error, count } = await query;

      if (error) throw error;

      // Filter out payments with missing customer
      const filteredPayments = (data || []).filter(payment => payment.customers);

      return {
        payments: filteredPayments as PaymentRow[],
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      };
    },
    enabled: !!tenant,
    staleTime: 30000, // Consider data fresh for 30 seconds
    refetchOnWindowFocus: false,
  });
};

// Export CSV function
export const exportPaymentsCSV = async (filters: PaymentFilters, tenantId?: string) => {
  // If vehicle search is provided, first get matching vehicle IDs
  let vehicleIds: string[] | null = null;
  if (filters.vehicleSearch) {
    const searchTerm = filters.vehicleSearch.toLowerCase();
    let vehicleSearchQuery = supabase
      .from("vehicles")
      .select("id, reg, make, model");

    if (tenantId) {
      vehicleSearchQuery = vehicleSearchQuery.eq("tenant_id", tenantId);
    }

    const { data: matchingVehicles } = await vehicleSearchQuery;

    if (matchingVehicles) {
      vehicleIds = matchingVehicles
        .filter(v =>
          v.reg?.toLowerCase().includes(searchTerm) ||
          v.make?.toLowerCase().includes(searchTerm) ||
          v.model?.toLowerCase().includes(searchTerm)
        )
        .map(v => v.id);
    }
  }

  let query = supabase
    .from("payments")
    .select(`
      payment_date,
      customers!payments_customer_id_fkey(name),
      vehicles!payments_vehicle_id_fkey(reg),
      rentals!payments_rental_id_fkey(rental_number),
      payment_type,
      method,
      amount,
      status,
      remaining_amount,
      vehicle_id
    `);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  // Apply same filters as the main query
  if (filters.customerSearch) {
    query = query.ilike("customers.name", `%${filters.customerSearch}%`);
  }

  // Apply vehicle filter using IDs from pre-query
  if (vehicleIds !== null) {
    if (vehicleIds.length === 0) {
      // No matching vehicles found, return early
      return;
    }
    query = query.in("vehicle_id", vehicleIds);
  }

  if (filters.method && filters.method !== 'all') {
    query = query.eq("method", filters.method);
  }

  if (filters.dateFrom) {
    query = query.gte("payment_date", formatDateForDB(filters.dateFrom));
  }

  if (filters.dateTo) {
    query = query.lte("payment_date", formatDateForDB(filters.dateTo));
  }

  query = query.order("payment_date", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  // Convert to CSV
  const headers = ['Date', 'Customer', 'Vehicle', 'Rental Ref', 'Type', 'Method', 'Amount', 'Applied', 'Credit Remaining'];

  const getPaymentTypeDisplay = (paymentType: string): string => {
    switch (paymentType) {
      case 'InitialFee':
        return 'Initial Fee';
      case 'Payment':
        return 'Customer Payment';
      default:
        return paymentType;
    }
  };

  const rows = data.map(payment => [
    payment.payment_date,
    payment.customers?.name || '',
    payment.vehicles?.reg || '',
    payment.rentals?.rental_number || '',
    getPaymentTypeDisplay(payment.payment_type),
    payment.method || '',
    payment.amount.toFixed(2),
    (payment.amount - (payment.remaining_amount || 0)).toFixed(2),
    (payment.remaining_amount || 0).toFixed(2)
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `payments-export-${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
