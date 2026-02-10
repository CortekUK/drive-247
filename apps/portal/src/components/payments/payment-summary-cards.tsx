import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, TrendingUp, Calendar, Hash } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

export const PaymentSummaryCards = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  const { data: summaryData } = useQuery({
    queryKey: ["payment-summary", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const today = new Date().toISOString().split('T')[0];
      const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      // Today's payments - filtered by tenant
      const { data: todayPayments, error: todayError } = await supabase
        .from("payments")
        .select("amount")
        .eq("tenant_id", tenant.id)
        .eq("payment_date", today);

      if (todayError) throw todayError;

      // This month's payments - filtered by tenant
      const { data: monthPayments, error: monthError } = await supabase
        .from("payments")
        .select("amount")
        .eq("tenant_id", tenant.id)
        .gte("payment_date", firstOfMonth);

      if (monthError) throw monthError;

      const todaysTotal = todayPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const monthsTotal = monthPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      const paymentCount = monthPayments.length;

      return {
        todaysTotal,
        monthsTotal,
        paymentCount
      };
    },
    enabled: !!tenant,
  });

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today's Payments</CardTitle>
          <CreditCard className="h-4 w-4 text-success" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(summaryData?.todaysTotal || 0, currencyCode)}</div>
        </CardContent>
      </Card>

      <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">This Month</CardTitle>
          <TrendingUp className="h-4 w-4 text-success" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(summaryData?.monthsTotal || 0, currencyCode)}</div>
        </CardContent>
      </Card>

      <Card className="bg-card hover:bg-accent/50 border shadow-sm transition-all duration-200 cursor-pointer hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Payment Count</CardTitle>
          <Hash className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summaryData?.paymentCount || 0}</div>
          <p className="text-xs text-muted-foreground">This Month</p>
        </CardContent>
      </Card>
    </div>
  );
};