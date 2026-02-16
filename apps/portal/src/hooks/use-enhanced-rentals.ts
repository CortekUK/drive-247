import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateDuration, getRentalStatus } from "@/lib/rental-utils";
import { useTenant } from "@/contexts/TenantContext";

export interface RentalFilters {
  captureStatus?: string;
  search?: string;
  status?: string;
  customerType?: string;
  paymentMode?: string;
  duration?: string;
  durationMin?: number;
  durationMax?: number;
  initialPayment?: string;
  startDateFrom?: Date;
  startDateTo?: Date;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  bonzahStatus?: string;
  extensionRequested?: boolean;
  cancellationRequested?: boolean;
}

export interface EnhancedRental {
  id: string;
  rental_number: string;
  start_date: string;
  end_date: string | null;
  rental_period_type?: string;
  monthly_amount: number;
  protection_cost: number;
  total_amount: number;
  status: string;
  computed_status: string;
  approval_status?: string;
  payment_status?: string;
  duration_months: number;
  initial_payment: number | null;
  payment_mode?: string;
  created_at?: string;
  is_extended?: boolean;
  previous_end_date?: string | null;
  cancellation_requested?: boolean;
  bonzah_status?: string | null;
  customer: {
    id: string;
    name: string;
    customer_type: string;
  };
  vehicle: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

export interface RentalStats {
  total: number;
  active: number;
  closed: number;
  pending: number;
  avgDuration: number;
}

const ITEMS_PER_PAGE = 25;

export const useEnhancedRentals = (filters: RentalFilters = {}) => {
  const { tenant } = useTenant();
  const {
    search = "",
    status = "all",
    customerType = "all",
    paymentMode = "all",
    duration = "all",
    durationMin,
    durationMax,
    initialPayment = "all",
    startDateFrom,
    startDateTo,
    sortBy = "start_date",
    sortOrder = "desc",
    page = 1,
    pageSize = ITEMS_PER_PAGE,
    captureStatus,
    bonzahStatus,
    extensionRequested,
    cancellationRequested
  } = filters;

  // Create a stable query key by serializing Date objects to strings
  const stableQueryKey = [
    "enhanced-rentals",
    tenant?.id,
    search,
    status,
    customerType,
    paymentMode,
    duration,
    durationMin,
    durationMax,
    initialPayment,
    startDateFrom?.toISOString(),
    startDateTo?.toISOString(),
    sortBy,
    sortOrder,
    page,
    pageSize,
    captureStatus,
    bonzahStatus,
    extensionRequested,
    cancellationRequested
  ];

  return useQuery({
    queryKey: stableQueryKey,
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      let query = supabase
        .from("rentals")
        .select(`
          id,
          rental_number,
          start_date,
          end_date,
          monthly_amount,
          status,
          approval_status,
          payment_status,
          payment_mode,
          created_at,
          is_extended,
          previous_end_date,
          cancellation_requested,
          customers!rentals_customer_id_fkey(id, name, customer_type),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model)
        `, { count: 'exact' })
        .eq("tenant_id", tenant.id) as any;

      // Note: Customer type filter moved to client-side to work with regular joins

      // Apply date range filters
      if (startDateFrom) {
        query = query.gte("start_date", startDateFrom.toISOString().split('T')[0]);
      }
      if (startDateTo) {
        query = query.lte("start_date", startDateTo.toISOString().split('T')[0]);
      }

      // Apply sorting
      const ascending = sortOrder === "asc";
      if (sortBy === "rental_number") {
        query = query.order("rental_number", { ascending });
      } else if (sortBy === "monthly_amount") {
        query = query.order("monthly_amount", { ascending });
      } else if (sortBy === "end_date") {
        query = query.order("end_date", { ascending, nullsFirst: !ascending });
      } else {
        query = query.order(sortBy as any, { ascending });
      }

      const { data: rentalsData, error } = await query;

      if (error) throw error;

      // Get initial payments and bonzah policies for these rentals
      const rentalIds = rentalsData?.map((r: any) => r.id) || [];

      const [{ data: initialPayments }, { data: bonzahPolicies }] = await Promise.all([
        supabase
          .from("payments")
          .select("rental_id, amount, capture_status")
          .eq("tenant_id", tenant.id)
          .in("rental_id", rentalIds)
          .eq("payment_type", "InitialFee"),
        supabase
          .from("bonzah_insurance_policies")
          .select("rental_id, status")
          .eq("tenant_id", tenant.id)
          .in("rental_id", rentalIds),
      ]);

      const initialPaymentMap = new Map(
        initialPayments?.map(p => [p.rental_id, { amount: p.amount, capture_status: p.capture_status }]) || []
      );

      const bonzahPolicyMap = new Map(
        bonzahPolicies?.map((p: any) => [p.rental_id, p.status]) || []
      );

      // Transform and filter data - skip rentals with missing customer or vehicle
      const enhancedRentals: EnhancedRental[] = (rentalsData || [])
        .filter((rental: any) => rental.customers && rental.vehicles)
        .map((rental: any) => {
          const periodType = 'Monthly';
          const durationMonths = calculateDuration(rental.start_date, rental.end_date, periodType);
          const computedStatus = getRentalStatus(rental.start_date, rental.end_date, rental.status);
          const initialPaymentData = initialPaymentMap.get(rental.id);
          const initialPaymentAmount = initialPaymentData?.amount || null;
          const paymentCaptureStatus = initialPaymentData?.capture_status || null;
          const totalAmount = rental.monthly_amount;
          const protectionCost = 0; // Protection cost not stored separately in current schema

          return {
            id: rental.id,
            rental_number: rental.rental_number,
            start_date: rental.start_date,
            end_date: rental.end_date,
            rental_period_type: periodType,
            monthly_amount: rental.monthly_amount,
            protection_cost: protectionCost,
            total_amount: totalAmount,
            status: rental.status,
            computed_status: computedStatus,
            approval_status: rental.approval_status,
            payment_status: rental.payment_status,
            duration_months: durationMonths,
            initial_payment: initialPaymentAmount,
            payment_capture_status: paymentCaptureStatus,
            created_at: rental.created_at,
            payment_mode: rental.payment_mode,
            is_extended: rental.is_extended,
            previous_end_date: rental.previous_end_date,
            cancellation_requested: rental.cancellation_requested,
            bonzah_status: bonzahPolicyMap.get(rental.id) || null,
            customer: rental.customers as any,
            vehicle: rental.vehicles as any,
          };
        })
        .filter((rental: EnhancedRental) => {
          // Apply customer type filter (moved from DB level for regular joins)
          if (customerType !== "all") {
            if (rental.customer?.customer_type !== customerType) return false;
          }

          // Apply payment mode filter
          if (paymentMode !== "all") {
            if (rental.payment_mode !== paymentMode) return false;
          }

          // Apply search filter (client-side for related fields)
          if (search) {
            const searchLower = search.toLowerCase();
            const matchesRentalNumber = rental.rental_number?.toLowerCase().includes(searchLower);
            const matchesCustomer = rental.customer?.name?.toLowerCase().includes(searchLower);
            const matchesVehicle = rental.vehicle?.reg?.toLowerCase().includes(searchLower);
            if (!matchesRentalNumber && !matchesCustomer && !matchesVehicle) return false;
          }

          // Apply status filter (handle both 'active' and 'Active' formats)
          if (status !== "all") {
            const normalizedFilter = status.toLowerCase();
            const normalizedStatus = rental.computed_status.toLowerCase();
            if (normalizedFilter !== normalizedStatus) return false;
          }

          // Apply duration filter (custom range takes precedence)
          if (durationMin !== undefined || durationMax !== undefined) {
            const months = rental.duration_months;
            if (durationMin !== undefined && months < durationMin) return false;
            if (durationMax !== undefined && months > durationMax) return false;
          } else if (duration !== "all") {
            const months = rental.duration_months;
            if (duration === "≤3 mo" && months > 3) return false;
            if (duration === "3–6 mo" && (months <= 3 || months > 6)) return false;
            if (duration === "6–12 mo" && (months <= 6 || months > 12)) return false;
            if (duration === "12–18 mo" && (months <= 12 || months > 18)) return false;
            if (duration === "18–24 mo" && (months <= 18 || months > 24)) return false;
            if (duration === ">24 mo" && months <= 24) return false;
          }

          // Apply initial payment filter
          if (initialPayment !== "all") {
            if (initialPayment === "set" && !rental.initial_payment) return false;
            if (initialPayment === "missing" && rental.initial_payment) return false;
          }

          // Apply capture status filter
          if (captureStatus) {
            if (captureStatus === "requires_capture" && (rental as any).payment_capture_status !== "requires_capture") {
              return false;
            }
          }

          // Apply Bonzah status filter
          if (bonzahStatus) {
            if (bonzahStatus === 'ins_quoted') {
              if (rental.bonzah_status !== 'quoted' && rental.bonzah_status !== 'insufficient_balance') return false;
            } else {
              if (rental.bonzah_status !== bonzahStatus) return false;
            }
          }

          // Apply extension requested filter
          if (extensionRequested) {
            if (!rental.is_extended) return false;
          }

          // Apply cancellation requested filter
          if (cancellationRequested) {
            if (!rental.cancellation_requested) return false;
          }

          return true;
        });

      // Paginate filtered results
      const startIndex = (page - 1) * pageSize;
      const paginatedRentals = enhancedRentals.slice(startIndex, startIndex + pageSize);

      // Calculate stats from ALL filtered data (not just current page)
      const stats: RentalStats = {
        total: enhancedRentals.length,
        active: enhancedRentals.filter(r => r.computed_status === "Active").length,
        closed: enhancedRentals.filter(r => r.computed_status === "Completed").length,
        pending: enhancedRentals.filter(r => r.computed_status === "Pending").length,
        avgDuration: enhancedRentals.length > 0
          ? Math.round(enhancedRentals.reduce((sum, r) => sum + r.duration_months, 0) / enhancedRentals.length)
          : 0
      };

      return {
        rentals: paginatedRentals,
        stats,
        totalCount: enhancedRentals.length,
        totalPages: Math.ceil(enhancedRentals.length / pageSize)
      };
    },
    enabled: !!tenant,
    staleTime: 30000, // Consider data fresh for 30 seconds to prevent excessive refetches
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
};
