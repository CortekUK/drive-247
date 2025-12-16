import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Gauge, Wrench } from "lucide-react";

interface Vehicle {
  last_service_date?: string;
  last_service_mileage?: number;
}

interface LastServiceCardProps {
  vehicle: Vehicle;
}

export function LastServiceCard({ vehicle }: LastServiceCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatMileage = (mileage: number) => {
    return mileage.toLocaleString();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Last Service
        </CardTitle>
        {vehicle.last_service_date && (
          <Badge variant="outline" className="text-xs">
            Recent
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {vehicle.last_service_date ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{formatDate(vehicle.last_service_date)}</span>
            </div>
            {vehicle.last_service_mileage && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Gauge className="h-4 w-4" />
                <span>{formatMileage(vehicle.last_service_mileage)} miles</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            <p>Not set</p>
            <p className="text-xs mt-1">No service records found</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}