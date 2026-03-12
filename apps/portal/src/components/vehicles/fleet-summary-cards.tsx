import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Vehicle {
  id: string;
  status: string;
  is_disposed: boolean;
  purchase_price?: number;
  plData?: {
    net_profit: number;
  };
}

interface FleetSummaryCardsProps {
  vehicles: Vehicle[];
  currencyCode?: string;
}

export const FleetSummaryCards = ({ vehicles }: FleetSummaryCardsProps) => {
  // Filter out disposed vehicles (is_disposed = true means sold/disposed)
  const activeVehicles = vehicles.filter(v => !v.is_disposed);

  // Count total active vehicles in fleet
  const totalVehicles = activeVehicles.length;

  // Count available vehicles (status = 'Available')
  const availableVehicles = activeVehicles.filter(v => v.status === 'Available').length;

  // Count currently rented vehicles (status = 'Rented')
  const rentedVehicles = activeVehicles.filter(v => v.status === 'Rented').length;

  // Calculate utilization rate (percentage of vehicles currently rented)
  // Formula: (Rented Vehicles / Total Vehicles) * 100
  const utilizationRate = totalVehicles > 0
    ? Math.round((rentedVehicles / totalVehicles) * 100)
    : 0;

  const cards = [
    {
      title: "Total Vehicles",
      value: totalVehicles,
      description: "Active fleet vehicles",
      className: "bg-gradient-to-br from-slate-500/10 to-slate-600/5 border-slate-500/20 hover:border-slate-500/40 hover:shadow-lg",
    },
    {
      title: "Available",
      value: availableVehicles,
      description: "Ready for rental",
      className: "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-lg",
    },
    {
      title: "Currently Rented",
      value: rentedVehicles,
      description: "Out on rental",
      className: "bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20 hover:border-amber-500/40 hover:shadow-lg",
    },
    {
      title: "Utilization Rate",
      value: `${utilizationRate}%`,
      description: "Fleet efficiency",
      className: utilizationRate >= 70
        ? "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-lg"
        : utilizationRate >= 40
        ? "bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20 hover:border-orange-500/40 hover:shadow-lg"
        : "bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20 hover:border-red-500/40 hover:shadow-lg",
      valueClassName: utilizationRate >= 70 ? "text-emerald-600" : utilizationRate >= 40 ? "text-orange-600" : "text-red-600"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        return (
          <Card key={card.title} className={`relative overflow-hidden transition-all duration-300 border-2 ${card.className}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-foreground/80">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold mb-1 ${card.valueClassName || 'text-foreground'}`}>
                {card.value}
              </div>
              <p className="text-xs text-muted-foreground font-medium">
                {card.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
