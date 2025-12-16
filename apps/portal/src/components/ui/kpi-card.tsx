import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string | number | React.ReactNode;
  subtitle?: string;
  valueClassName?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
}

export const KPICard = React.forwardRef<HTMLDivElement, KPICardProps>(
  ({ title, value, subtitle, valueClassName, icon, badge, isLoading, className }, ref) => {
    if (isLoading) {
      return (
        <Card ref={ref} className={cn("h-[120px]", className)}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16 mb-2" />
            {subtitle && <Skeleton className="h-3 w-24" />}
          </CardContent>
        </Card>
      );
    }

    return (
      <Card ref={ref} className={cn("h-[120px] hover:shadow-md hover:scale-[1.02] transition-all duration-200 cursor-pointer", className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className={cn("text-2xl font-bold", valueClassName)}>
              {value}
            </div>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    );
  }
);

KPICard.displayName = "KPICard";