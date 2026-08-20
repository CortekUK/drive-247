import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Vehicle {
  id: string;
  status: string;
  is_disposed: boolean;
  is_paused?: boolean;
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

  // Count available vehicles (status = 'Available'). A paused vehicle is off
  // the road, so it must not be counted as ready to rent — that is exactly the
  // "it still show available" the operator sees.
  const availableVehicles = activeVehicles.filter(v => v.status === 'Available' && !v.is_paused).length;

  // Count paused vehicles (taken off the road by the operator)
  const pausedVehicles = activeVehicles.filter(v => v.is_paused).length;

  // Count currently rented vehicles (status = 'Rented'). Paused ones are
  // excluded here too — they are removed from the denominator below, so leaving
  // them in the numerator lets utilisation render above 100%.
  const rentedVehicles = activeVehicles.filter(v => v.status === 'Rented' && !v.is_paused).length;

  // Calculate utilization rate (percentage of vehicles currently rented)
  // Formula: (Rented Vehicles / Total Vehicles) * 100
  // Paused vehicles are excluded from the denominator: an off-road car is not
  // idle capacity, and leaving it in makes a fleet look less efficient the
  // longer a repair takes.
  const rentableVehicles = totalVehicles - pausedVehicles;
  const utilizationRate = rentableVehicles > 0
    ? Math.round((rentedVehicles / rentableVehicles) * 100)
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
      title: "Paused",
      value: pausedVehicles,
      description: "Off the road",
      className: "bg-gradient-to-br from-slate-400/10 to-slate-500/5 border-slate-400/30 hover:border-slate-400/50 hover:shadow-lg",
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
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        return (
          <Card key={card.title} className={`relative overflow-hidden transition-all duration-300 border-2 ${card.className}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 sm:pb-3 p-3 sm:p-6">
              <CardTitle className="text-xs sm:text-sm font-medium text-foreground/80 leading-tight">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              <div className={`text-2xl sm:text-3xl font-bold mb-1 ${card.valueClassName || 'text-foreground'}`}>
                {card.value}
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground font-medium leading-tight">
                {card.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
