import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FineFilterState } from "@/components/fines/fine-filters";
import { useTenant } from "@/contexts/TenantContext";

export interface EnhancedFine {
  id: string;
  type: string;
  reference_no: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  status: string;
  notes: string | null;
  customer_id: string | null;
  vehicle_id: string;
  created_at: string;
  customers: { 
    name: string; 
    email?: string; 
    phone?: string; 
  } | null;
  vehicles: { 
    reg: string; 
    make: string; 
    model: string; 
  };
  authority_payments: {
    total_amount: number;
  }[];
  // Computed fields
  isOverdue: boolean;
  daysUntilDue: number;
  hasAuthorityPayments: boolean;
  isAuthoritySettled: boolean;
}

interface UseFinesDataParams {
  filters?: FineFilterState;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const useFinesData = ({
  filters = {
    status: [],
    vehicleSearch: '',
    customerSearch: '',
  },
  sortBy = 'due_date',
  sortOrder = 'asc',
  page = 1,
  pageSize = 25
}: UseFinesDataParams = {}) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["fines-enhanced", tenant?.id, filters, sortBy, sortOrder, page, pageSize],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      let query = supabase
        .from("fines")
        .select(`
          *,
          customers!fines_customer_id_fkey(name, email, phone),
          vehicles!fines_vehicle_id_fkey(reg, make, model),
          authority_payments(amount)
        `, { count: 'exact' })
        .eq("tenant_id", tenant.id);

      // Apply filters
      if (filters.status && filters.status.length > 0) {
        query = query.in('status', filters.status);
      }

      // Note: Vehicle and customer search will be applied client-side after fetching
      // because Supabase doesn't support searching on foreign table columns with .or()

      // Date range filters
      if (filters.issueDateFrom) {
        query = query.gte('issue_date', filters.issueDateFrom.toISOString().split('T')[0]);
      }

      if (filters.issueDateTo) {
        query = query.lte('issue_date', filters.issueDateTo.toISOString().split('T')[0]);
      }

      if (filters.dueDateFrom) {
        query = query.gte('due_date', filters.dueDateFrom.toISOString().split('T')[0]);
      }

      if (filters.dueDateTo) {
        query = query.lte('due_date', filters.dueDateTo.toISOString().split('T')[0]);
      }

      // Quick filters
      if (filters.quickFilter === 'due-next-7') {
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        query = query
          .gte('due_date', today.toISOString().split('T')[0])
          .lte('due_date', nextWeek.toISOString().split('T')[0])
          .in('status', ['Open', 'Charged']);
      }

      if (filters.quickFilter === 'overdue') {
        const today = new Date();
        query = query
          .lt('due_date', today.toISOString().split('T')[0])
          .in('status', ['Open', 'Charged']);
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      // Don't apply database pagination if we have a search term
      // because search is done client-side on foreign table columns
      const hasClientSideSearch = filters.search?.trim() || filters.vehicleSearch?.trim() || filters.customerSearch?.trim();

      if (!hasClientSideSearch) {
        // Apply pagination only when no client-side search
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize - 1;
        query = query.range(startIndex, endIndex);
      }

      const { data, error, count } = await query;
      
      if (error) throw error;

      // Enhance the data with computed fields
      const today = new Date();
      let enhancedFines: EnhancedFine[] = (data || []).map(fine => {
        const dueDate = new Date(fine.due_date);
        const isOverdue = dueDate < today && (fine.status === 'Open' || fine.status === 'Charged');
        const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Calculate authority payments
        const totalAuthorityPayments = (fine.authority_payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
        const hasAuthorityPayments = totalAuthorityPayments > 0;
        const isAuthoritySettled = totalAuthorityPayments >= fine.amount;

        return {
          ...fine,
          customers: fine.customers as any,
          vehicles: fine.vehicles as any,
          authority_payments: fine.authority_payments as any,
          isOverdue,
          daysUntilDue,
          hasAuthorityPayments,
          isAuthoritySettled,
        };
      });

      // Apply client-side filters for foreign table columns
      // Unified search - searches across reference, type, vehicle, and customer
      if (filters.search && filters.search.trim()) {
        const search = filters.search.trim().toLowerCase();
        enhancedFines = enhancedFines.filter(fine =>
          fine.reference_no?.toLowerCase().includes(search) ||
          fine.type?.toLowerCase().includes(search) ||
          fine.id?.toLowerCase().includes(search) ||
          fine.vehicles?.reg?.toLowerCase().includes(search) ||
          fine.vehicles?.make?.toLowerCase().includes(search) ||
          fine.vehicles?.model?.toLowerCase().includes(search) ||
          fine.customers?.name?.toLowerCase().includes(search) ||
          fine.customers?.email?.toLowerCase().includes(search) ||
          fine.customers?.phone?.toLowerCase().includes(search)
        );
      }

      // Legacy vehicle search (for backwards compatibility)
      if (filters.vehicleSearch && filters.vehicleSearch.trim()) {
        const search = filters.vehicleSearch.trim().toLowerCase();
        enhancedFines = enhancedFines.filter(fine =>
          fine.vehicles.reg.toLowerCase().includes(search) ||
          fine.vehicles.make.toLowerCase().includes(search) ||
          fine.vehicles.model.toLowerCase().includes(search)
        );
      }

      // Legacy customer search (for backwards compatibility)
      if (filters.customerSearch && filters.customerSearch.trim()) {
        const search = filters.customerSearch.trim().toLowerCase();
        enhancedFines = enhancedFines.filter(fine =>
          fine.customers?.name.toLowerCase().includes(search) ||
          fine.customers?.email?.toLowerCase().includes(search) ||
          fine.customers?.phone?.toLowerCase().includes(search)
        );
      }

      // Update count after client-side filtering
      const filteredCount = enhancedFines.length;

      return {
        fines: enhancedFines,
        totalCount: filteredCount,
        totalPages: Math.ceil(filteredCount / pageSize),
        currentPage: page,
        hasNextPage: page * pageSize < filteredCount,
        hasPreviousPage: page > 1,
      };
    },
    enabled: !!tenant,
  });
};