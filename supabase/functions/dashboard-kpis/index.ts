import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory cache for dashboard data
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();

const CACHE_TTL = 60 * 1000; // 60 seconds

function getCacheKey(from?: string, to?: string): string {
  return `dashboard:${from || 'no-from'}:${to || 'no-to'}`;
}

function isCacheValid(entry: { timestamp: number; ttl: number }): boolean {
  return Date.now() - entry.timestamp < entry.ttl;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const timezone = url.searchParams.get('tz') || 'Europe/London';

    // Validate date parameters
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return new Response(
        JSON.stringify({ error: 'Invalid from date format. Expected YYYY-MM-DD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return new Response(
        JSON.stringify({ error: 'Invalid to date format. Expected YYYY-MM-DD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check cache first
    const cacheKey = getCacheKey(from, to);
    const cached = cache.get(cacheKey);
    if (cached && isCacheValid(cached)) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get current date in specified timezone
    const now = new Date();
    const today = now.toLocaleDateString('sv-SE', { timeZone: timezone });
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });

    // Parallel execution of all queries
    const [
      overdueResult,
      dueTodayResult,
      activeRentalsResult,
      finesOpenResult,
      monthlyRevenueResult,
      fleetUtilizationResult
    ] = await Promise.allSettled([
      // Overdue Payments
      supabase
        .from('ledger_entries')
        .select('remaining_amount')
        .eq('type', 'Charge')
        .eq('category', 'Rental')
        .gt('remaining_amount', 0)
        .lt('due_date', today),

      // Due Today
      supabase
        .from('ledger_entries')
        .select('remaining_amount')
        .eq('type', 'Charge')
        .eq('category', 'Rental')
        .gt('remaining_amount', 0)
        .eq('due_date', today),

      // Active Rentals
      supabase
        .from('rentals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Active'),

      // Open Fines with due soon count
      supabase
        .from('fines')
        .select('amount, due_date, status')
        .in('status', ['Open', 'Appealed', 'Charged']),

      // Monthly Revenue (if date range provided)
      from && to ? supabase
        .from('pnl_entries')
        .select('amount')
        .eq('side', 'Revenue')
        .gte('entry_date', from)
        .lte('entry_date', to) : Promise.resolve({ data: [] }),

      // Fleet Utilization
      supabase
        .from('vehicles')
        .select('status, is_disposed')
        .eq('is_disposed', false)
    ]);

    // Process results with error handling
    const processResult = (result: PromiseSettledResult<any>, defaultValue: any) => {
      if (result.status === 'fulfilled' && !result.value.error) {
        return result.value;
      }
      console.error('Query failed:', result.status === 'rejected' ? result.reason : result.value.error);
      return defaultValue;
    };

    // Calculate overdue payments
    const overdueData = processResult(overdueResult, { data: [] });
    const overdueCount = overdueData.data?.length || 0;
    const overdueAmount = overdueData.data?.reduce((sum: number, entry: any) => sum + Number(entry.remaining_amount || 0), 0) || 0;

    // Calculate due today
    const dueTodayData = processResult(dueTodayResult, { data: [] });
    const dueTodayCount = dueTodayData.data?.length || 0;
    const dueTodayAmount = dueTodayData.data?.reduce((sum: number, entry: any) => sum + Number(entry.remaining_amount || 0), 0) || 0;

    // Active rentals count
    const activeRentalsData = processResult(activeRentalsResult, { count: 0 });
    const activeRentalsCount = activeRentalsData.count || 0;

    // Open fines
    const finesData = processResult(finesOpenResult, { data: [] });
    const finesCount = finesData.data?.length || 0;
    const finesAmount = finesData.data?.reduce((sum: number, fine: any) => sum + Number(fine.amount || 0), 0) || 0;

    // Calculate fines due soon with timezone-aware date comparison
    const sevenDaysFromNowDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNowStr = sevenDaysFromNowDate.toLocaleDateString('sv-SE', { timeZone: timezone });
    const finesDueSoonCount = finesData.data?.filter((fine: any) => {
      if (!fine.due_date) return false;
      // Compare date strings instead of Date objects for timezone consistency
      return fine.due_date >= today && fine.due_date <= sevenDaysFromNowStr;
    }).length || 0;

    // Monthly Revenue
    const monthlyRevenueData = processResult(monthlyRevenueResult, { data: [] });
    const monthlyRevenueAmount = monthlyRevenueData.data?.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0) || 0;

    // Fleet Utilization
    const fleetUtilizationData = processResult(fleetUtilizationResult, { data: [] });
    const fleetVehicles = fleetUtilizationData.data || [];
    const totalVehicles = fleetVehicles.length;
    const rentedVehicles = fleetVehicles.filter((v: any) => v.status === 'Rented').length;
    const availableVehicles = fleetVehicles.filter((v: any) => v.status === 'Available').length;
    const utilizationPercentage = totalVehicles > 0 ? Math.round((rentedVehicles / totalVehicles) * 100) : 0;

    const kpis = {
      overdue: { count: overdueCount, amount: overdueAmount },
      dueToday: { count: dueTodayCount, amount: dueTodayAmount },
      activeRentals: { count: activeRentalsCount },
      finesOpen: { count: finesCount, amount: finesAmount, dueSoonCount: finesDueSoonCount },
      monthlyRevenue: { amount: monthlyRevenueAmount },
      fleetUtilization: {
        total: totalVehicles,
        rented: rentedVehicles,
        available: availableVehicles,
        percentage: utilizationPercentage
      },
      generatedAt: now.toISOString(),
      timezone
    };

    // Cache the result
    cache.set(cacheKey, {
      data: kpis,
      timestamp: Date.now(),
      ttl: CACHE_TTL
    });

    // Clean up old cache entries
    for (const [key, entry] of cache.entries()) {
      if (!isCacheValid(entry)) {
        cache.delete(key);
      }
    }

    return new Response(JSON.stringify(kpis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Dashboard KPIs error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});