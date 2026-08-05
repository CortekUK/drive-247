import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { formatInTimeZone } from "date-fns-tz";
import {
  RECEIVED_PAYMENT_COLUMNS,
  isMoneyReceived,
  sumReceived,
} from "@/lib/payment-status";

// Mirrors the helper in use-payments-data.ts so the cards and the table agree.
const formatDateForDB = (date: Date): string =>
  formatInTimeZone(date, "America/New_York", "yyyy-MM-dd");

export const PaymentSummaryCards = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';

  const { data: summaryData } = useQuery({
    queryKey: ["payment-summary", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      // Use the same timezone the payments table itself queries in, or the cards
      // and the list underneath them disagree about which day/month a payment is in.
      const now = new Date();
      const today = formatDateForDB(now);
      // Derive the month from the NY calendar directly. Doing
      // formatDateForDB(startOfMonth(now)) instead takes the BROWSER's local
      // midnight and renders that instant in New York, which lands on the
      // previous month's last day for UTC/UTC+ viewers and drags an extra day in.
      const firstOfMonth = `${formatInTimeZone(now, "America/New_York", "yyyy-MM")}-01`;

      // Today's payments - filtered by tenant
      const { data: todayPayments, error: todayError } = await supabase
        .from("payments")
        .select(RECEIVED_PAYMENT_COLUMNS)
        .eq("tenant_id", tenant.id)
        .eq("payment_date", today);

      if (todayError) throw todayError;

      // This month's payments - filtered by tenant
      const { data: monthPayments, error: monthError } = await supabase
        .from("payments")
        .select(RECEIVED_PAYMENT_COLUMNS)
        .eq("tenant_id", tenant.id)
        .gte("payment_date", firstOfMonth);

      if (monthError) throw monthError;

      // Voided/reversed rows keep their full `amount`, and pending checkout links
      // and uncaptured holds carry a real amount too — none of that is money
      // received, so it must not reach these totals. See lib/payment-status.ts.
      const todaysTotal = sumReceived(todayPayments as any[]);
      const monthsTotal = sumReceived(monthPayments as any[]);
      const paymentCount = ((monthPayments as any[]) || []).filter(isMoneyReceived).length;

      return {
        todaysTotal,
        monthsTotal,
        paymentCount
      };
    },
    enabled: !!tenant,
  });

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
      <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium leading-tight">Today's Payments</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-lg sm:text-2xl font-bold break-all">{formatCurrency(summaryData?.todaysTotal || 0, currencyCode)}</div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium leading-tight">This Month</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-lg sm:text-2xl font-bold break-all">{formatCurrency(summaryData?.monthsTotal || 0, currencyCode)}</div>
        </CardContent>
      </Card>

      <Card className="bg-card hover:bg-accent/50 border shadow-sm transition-all duration-200 cursor-pointer hover:shadow-md col-span-2 md:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6">
          <CardTitle className="text-xs sm:text-sm font-medium leading-tight">Payment Count</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="text-xl sm:text-2xl font-bold">{summaryData?.paymentCount || 0}</div>
          <p className="text-[11px] sm:text-xs text-muted-foreground">This Month</p>
        </CardContent>
      </Card>
    </div>
  );
};