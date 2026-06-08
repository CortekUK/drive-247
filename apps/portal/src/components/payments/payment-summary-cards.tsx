import { useQuery } from "@tanstack/react-query";
import { CalendarRange, CalendarDays, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { KpiTile, KpiTileSkeletonRow } from "@/components/bento";

export const PaymentSummaryCards = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';

  const { data: summaryData, isLoading } = useQuery({
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

  if (isLoading) {
    return <KpiTileSkeletonRow count={3} />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <KpiTile
        label="Today's Payments"
        value={summaryData?.todaysTotal || 0}
        format={(v) => formatCurrency(v, currencyCode)}
        icon={<CalendarDays className="h-4 w-4" />}
        sub="Collected today"
      />
      <KpiTile
        label="This Month"
        value={summaryData?.monthsTotal || 0}
        format={(v) => formatCurrency(v, currencyCode)}
        variant="feature"
        icon={<CalendarRange className="h-4 w-4" />}
        sub="Total collected this month"
      />
      <KpiTile
        label="Payment Count"
        value={summaryData?.paymentCount || 0}
        icon={<Hash className="h-4 w-4" />}
        sub="This month"
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
};
