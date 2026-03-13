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
        <Card ref={ref} className={cn("h-[130px]", className)}>
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
      <Card
        ref={ref}
        className={cn(
          "h-[130px] group hover:border-primary/25 hover:glow-purple-sm transition-all duration-300",
          className,
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {icon && (
            <div className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary/70 transition-colors">
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className={cn("text-2xl font-bold tracking-tight", valueClassName)}>
              {value}
            </div>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    );
  }
);

KPICard.displayName = "KPICard";
