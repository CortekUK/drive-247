import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down";
  variant?: "default" | "success" | "warning" | "danger";
}

const StatCard = ({ title, value, change, trend, variant = "default" }: StatCardProps) => {
  const variants = {
    default: "bg-card shadow-card card-hover rounded-lg",
    success: "bg-gradient-success text-success-foreground shadow-hover card-hover rounded-lg",
    warning: "bg-gradient-warning text-warning-foreground shadow-hover card-hover rounded-lg", 
    danger: "bg-gradient-to-br from-destructive to-destructive/80 text-destructive-foreground shadow-hover card-hover rounded-lg"
  };

  const getTrendIcon = () => {
    if (!trend) return null;
    return trend === "up" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />;
  };

  const getTrendColor = () => {
    if (!trend) return "text-muted-foreground";
    return trend === "up" ? "text-green-600" : "text-red-600";
  };

  return (
    <Card className={variants[variant]}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {change && (
          <p className={`text-xs ${getTrendColor()} flex items-center gap-1 mt-1`}>
            {getTrendIcon()}
            {change}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export const DashboardStats = () => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  const { data: vehicleCount } = useQuery({
    queryKey: ["vehicle-count", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { count } = await query;
      return count || 0;
    },
    enabled: !!tenant,
  });

  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("rentals")
        .select("*", { count: "exact", head: true })
        .eq("status", "Active");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { count } = await query;
      return count || 0;
    },
    enabled: !!tenant,
  });

  const { data: monthlyRevenue } = useQuery({
    queryKey: ["monthly-revenue", tenant?.id],
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);

      let query = supabase
        .from("pnl_entries")
        .select("amount")
        .eq("side", "Revenue")
        .gte("entry_date", format(startOfMonth, "yyyy-MM-dd"));

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data } = await query;

      const total = data?.reduce((sum, entry) => sum + Number(entry.amount), 0) || 0;
      return total;
    },
    enabled: !!tenant,
  });

  const { data: openFines } = useQuery({
    queryKey: ["open-fines", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("fines")
        .select("*", { count: "exact", head: true })
        .not("status", "in", ["Paid", "Appeal Successful", "Waived"]);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { count } = await query;

      return count || 0;
    },
    enabled: !!tenant,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Total Fleet"
        value={vehicleCount?.toString() || "0"}
      />
      <StatCard
        title="Active Rentals"
        value={activeRentals?.toString() || "0"}
        variant="success"
      />
      <StatCard
        title="Monthly Revenue"
        value={formatCurrency(monthlyRevenue || 0, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        variant="success"
      />
      <StatCard
        title="Open Fines"
        value={openFines?.toString() || "0"}
        variant="warning"
      />
    </div>
  );
};