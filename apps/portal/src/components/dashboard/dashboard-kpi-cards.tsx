"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Calendar,
  PoundSterling,
  Users,
  Bell,
  Info,
  ExternalLink,
  DollarSign,
  Car
} from "lucide-react";
import { DashboardKPIs } from "@/hooks/use-dashboard-kpis";

interface DashboardKPICardsProps {
  data?: DashboardKPIs;
  isLoading: boolean;
  error?: Error | null;
}

const formatCurrency = (amount: number) => `$${amount.toLocaleString()}`;

const KPICard = ({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  variant = "default",
  onClick,
  tooltip,
  badge,
  isEmpty = false,
  emptyMessage
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<any>;
  variant?: "default" | "success" | "warning" | "danger";
  onClick?: () => void;
  tooltip?: string;
  badge?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
}) => {
  const variants = {
    default: "bg-card hover:bg-accent/50 border shadow-sm",
    success: "bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40",
    warning: "bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20 hover:border-warning/40",
    danger: "bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/20 hover:border-destructive/40"
  };

  const iconVariants = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning", 
    danger: "text-destructive"
  };

  const content = (
    <Card 
      className={`${variants[variant]} transition-all duration-200 ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {tooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {badge && (
            <Badge variant="secondary" className="h-4 text-xs px-1">
              {badge}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Icon className={`h-4 w-4 ${iconVariants[variant]}`} />
          {onClick && <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty && emptyMessage ? (
          <div className="text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return content;
};

const LoadingSkeleton = () => (
  <Card className="bg-card border shadow-sm">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-4 rounded" />
    </CardHeader>
    <CardContent>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </CardContent>
  </Card>
);

export const DashboardKPICards = ({ data, isLoading, error }: DashboardKPICardsProps) => {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <LoadingSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="col-span-full bg-destructive/5 border-destructive/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">Failed to load dashboard data</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
      {/* Outstanding Payments - Overdue + Due Today */}
      <KPICard
        title="Outstanding Payments"
        value={data.overdue.count + data.dueToday.count}
        subtitle={
          data.overdue.count + data.dueToday.count > 0
            ? `${formatCurrency((data.overdue.amount || 0) + (data.dueToday.amount || 0))} • ${data.overdue.count} overdue, ${data.dueToday.count} due today`
            : undefined
        }
        icon={AlertTriangle}
        variant={data.overdue.count > 0 ? "danger" : data.dueToday.count > 0 ? "warning" : "default"}
        tooltip="Payments overdue or due today"
        onClick={() => router.push('/payments?filter=outstanding')}
        isEmpty={data.overdue.count === 0 && data.dueToday.count === 0}
        emptyMessage="All payments current"
      />

      {/* Fleet Utilization */}
      <KPICard
        title="Fleet Utilization"
        value={`${data.fleetUtilization?.percentage || 0}%`}
        subtitle={`${data.fleetUtilization?.rented || 0} of ${data.fleetUtilization?.total || 0} vehicles rented`}
        icon={Car}
        variant={
          (data.fleetUtilization?.percentage || 0) >= 70 ? "success" :
          (data.fleetUtilization?.percentage || 0) >= 40 ? "warning" :
          "default"
        }
        tooltip="Percentage of active fleet currently rented"
        onClick={() => router.push('/vehicles?status=Rented')}
      />

      {/* Active Rentals */}
      <KPICard
        title="Active Rentals"
        value={data.activeRentals.count}
        subtitle="Currently active rentals"
        icon={Users}
        variant="success"
        onClick={() => router.push('/rentals?status=Active')}
        isEmpty={data.activeRentals.count === 0}
        emptyMessage="No active rentals"
      />

      {/* Open Fines */}
      <KPICard
        title="Open Fines"
        value={data.finesOpen.count}
        subtitle={data.finesOpen.count > 0 ? formatCurrency(data.finesOpen.amount) : undefined}
        icon={AlertTriangle}
        variant={data.finesOpen.count > 0 ? "warning" : "default"}
        badge={data.finesOpen.dueSoonCount > 0 ? `${data.finesOpen.dueSoonCount} due soon` : undefined}
        onClick={() => router.push('/fines?status=open')}
        isEmpty={data.finesOpen.count === 0}
        emptyMessage="No open fines"
      />

      {/* Monthly Revenue */}
      <KPICard
        title="Monthly Revenue"
        value={formatCurrency(data.monthlyRevenue?.amount || 0)}
        subtitle="Selected period"
        icon={DollarSign}
        variant="success"
        onClick={() => router.push('/pl-dashboard')}
        tooltip="Total revenue for the selected date range"
      />
    </div>
  );
};