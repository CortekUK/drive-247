import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, DollarSign, Car, User, Settings } from "lucide-react";
import { useRecentActivity } from "@/hooks/use-recent-activity";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { Skeleton } from "@/components/ui/skeleton";

const ActivityIcon = ({ type }: { type: string }) => {
  const icons = {
    payment: DollarSign,
    rental: User,
    vehicle: Car,
    system: Settings
  };
  
  const Icon = icons[type as keyof typeof icons];
  return <Icon className="h-4 w-4" />;
};

const StatusBadge = ({ status }: { status: string }) => {
  const variants = {
    success: "badge-status bg-success-light text-success border-success",
    pending: "badge-status bg-warning-light text-warning border-warning",
    warning: "badge-status bg-destructive-light text-destructive border-destructive"
  };

  // Capitalize first letter
  const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  return (
    <Badge variant="outline" className={variants[status as keyof typeof variants]}>
      {capitalizedStatus}
    </Badge>
  );
};

export const RecentActivity = () => {
  const { data: activities = [], isLoading } = useRecentActivity();
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  return (
    <Card className="shadow-card rounded-lg overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4 p-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <div className="text-right">
                  <Skeleton className="h-5 w-16 mb-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
            <p className="text-xs text-muted-foreground mt-1">Activity will appear here as you use the system</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-2">
            <div className="space-y-3">
              {activities.map((activity) => (
              <div key={activity.id} className="flex items-start gap-2 p-2.5 rounded-lg hover:bg-muted/50 transition-all duration-200 overflow-hidden">
                <div className="p-2 bg-gradient-subtle rounded-full flex-shrink-0">
                  <ActivityIcon type={activity.type} />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden pr-1">
                  <p className="text-sm font-medium line-clamp-2 break-all">{activity.description}</p>
                  <div className="flex items-center gap-1.5 mt-1 overflow-hidden">
                    {activity.customer && (
                      <span className="text-xs text-muted-foreground truncate block max-w-full">{activity.customer}</span>
                    )}
                    {activity.amount && (
                      <span className="text-xs font-semibold text-success whitespace-nowrap flex-shrink-0">{formatCurrency(Number(activity.amount), currencyCode)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <StatusBadge status={activity.status} />
                  <p className="text-xs text-muted-foreground whitespace-nowrap">{activity.time}</p>
                </div>
              </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};