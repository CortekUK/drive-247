import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Users, Car, PoundSterling, AlertTriangle, Shield } from "lucide-react";
import { format, addDays, isAfter, isBefore, isToday } from "date-fns";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  trend?: "up" | "down";
  icon: React.ComponentType<any>;
  variant?: "default" | "success" | "warning" | "danger";
}

const StatCard = ({ title, value, change, trend, icon: Icon, variant = "default" }: StatCardProps) => {
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
        <Icon className="h-4 w-4 text-primary opacity-80" />
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
  const { data: vehicleCount } = useQuery({
    queryKey: ["vehicle-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  // Fetch insurance compliance stats
  const { data: insuranceStats } = useQuery({
    queryKey: ["insurance-stats"],
    queryFn: async () => {
      const { data: policies, error } = await supabase
        .from("insurance_policies")
        .select("status, expiry_date")
        .eq("status", "Active");

      if (error) throw error;

      const today = new Date();
      const expiringSoon = policies?.filter(p => {
        const daysUntil = Math.ceil((new Date(p.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil <= 30 && daysUntil >= 0;
      }).length || 0;

      const expired = policies?.filter(p => {
        return new Date(p.expiry_date) < today;
      }).length || 0;

      return {
        total: policies?.length || 0,
        expiringSoon,
        expired
      };
    },
  });

  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals"],
    queryFn: async () => {
      const { count } = await supabase
        .from("rentals")
        .select("*", { count: "exact", head: true })
        .eq("status", "Active");
      return count || 0;
    },
  });

  const { data: monthlyRevenue } = useQuery({
    queryKey: ["monthly-revenue"],
    queryFn: async () => {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      
      const { data } = await supabase
        .from("pnl_entries")
        .select("amount")
        .eq("side", "Revenue")
        .gte("entry_date", format(startOfMonth, "yyyy-MM-dd"));
      
      const total = data?.reduce((sum, entry) => sum + Number(entry.amount), 0) || 0;
      return total;
    },
  });

  const { data: overduePayments } = useQuery({
    queryKey: ["overdue-payments"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      const { count } = await supabase
        .from("ledger_entries")
        .select("*", { count: "exact", head: true })
        .eq("type", "Charge")
        .gt("remaining_amount", 0)
        .lt("due_date", today);
      
      return count || 0;
    },
  });

  const { data: openFines } = useQuery({
    queryKey: ["open-fines"],
    queryFn: async () => {
      const { count } = await supabase
        .from("fines")
        .select("*", { count: "exact", head: true })
        .not("status", "in", ["Paid", "Appeal Successful", "Waived"]);
      
      return count || 0;
    },
  });

  // MOT & TAX tracking queries
  const { data: motOverdue } = useQuery({
    queryKey: ["mot-overdue"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .not("mot_due_date", "is", null)
        .lt("mot_due_date", today);
      
      return count || 0;
    },
  });

  const { data: motDueSoon } = useQuery({
    queryKey: ["mot-due-soon"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const futureDate = format(addDays(new Date(), 30), "yyyy-MM-dd");
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .not("mot_due_date", "is", null)
        .gte("mot_due_date", today)
        .lte("mot_due_date", futureDate);
      
      return count || 0;
    },
  });

  const { data: taxOverdue } = useQuery({
    queryKey: ["tax-overdue"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .not("tax_due_date", "is", null)
        .lt("tax_due_date", today);
      
      return count || 0;
    },
  });

  const { data: taxDueSoon } = useQuery({
    queryKey: ["tax-due-soon"],
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const futureDate = format(addDays(new Date(), 30), "yyyy-MM-dd");
      const { count } = await supabase
        .from("vehicles")
        .select("*", { count: "exact", head: true })
        .not("tax_due_date", "is", null)
        .gte("tax_due_date", today)
        .lte("tax_due_date", futureDate);
      
      return count || 0;
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-6">
      <StatCard
        title="Total Fleet"
        value={vehicleCount?.toString() || "0"}
        icon={Car}
      />
      <StatCard
        title="Active Rentals"
        value={activeRentals?.toString() || "0"}
        icon={Users}
        variant="success"
      />
      <StatCard
        title="Monthly Revenue"
        value={`$${monthlyRevenue?.toLocaleString() || "0"}`}
        icon={PoundSterling}
        variant="success"
      />
      <StatCard
        title="Open Fines"
        value={openFines?.toString() || "0"}
        icon={AlertTriangle}
        variant="warning"
      />
      <StatCard
        title="Overdue Payments"
        value={overduePayments?.toString() || "0"}
        icon={AlertTriangle}
        variant="danger"
      />
      <StatCard
        title="Insurance Status"
        value={`${insuranceStats?.expired || 0} / ${insuranceStats?.expiringSoon || 0}`}
        change="Expired / Expiring (30 days)"
        icon={Shield}
        variant={insuranceStats?.expired && insuranceStats.expired > 0 ? "danger" : insuranceStats?.expiringSoon && insuranceStats.expiringSoon > 0 ? "warning" : "default"}
      />
      <StatCard
        title="MOT Status"
        value={`${motOverdue || 0} / ${motDueSoon || 0}`}
        change="Overdue / Due (30 days)"
        icon={AlertTriangle}
        variant={motOverdue && motOverdue > 0 ? "danger" : motDueSoon && motDueSoon > 0 ? "warning" : "default"}
      />
      <StatCard
        title="TAX Status"
        value={`${taxOverdue || 0} / ${taxDueSoon || 0}`}
        change="Overdue / Due (30 days)"
        icon={AlertTriangle}
        variant={taxOverdue && taxOverdue > 0 ? "danger" : taxDueSoon && taxDueSoon > 0 ? "warning" : "default"}
      />
    </div>
  );
};