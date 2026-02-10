import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, CheckCircle, KeyRound, DollarSign, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

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

export const FleetSummaryCards = ({ vehicles, currencyCode = 'GBP' }: FleetSummaryCardsProps) => {
  // Filter out disposed vehicles (is_disposed = true means sold/disposed)
  const activeVehicles = vehicles.filter(v => !v.is_disposed);

  // Count total active vehicles in fleet
  const totalVehicles = activeVehicles.length;

  // Count available vehicles (status = 'Available')
  const availableVehicles = activeVehicles.filter(v => v.status === 'Available').length;

  // Count currently rented vehicles (status = 'Rented')
  const rentedVehicles = activeVehicles.filter(v => v.status === 'Rented').length;

  // Calculate total fleet value (sum of purchase prices for all active vehicles)
  const fleetValue = activeVehicles.reduce((sum, v) => {
    const price = Number(v.purchase_price) || 0;
    return sum + price;
  }, 0);

  // Calculate utilization rate (percentage of vehicles currently rented)
  // Formula: (Rented Vehicles / Total Vehicles) * 100
  const utilizationRate = totalVehicles > 0
    ? Math.round((rentedVehicles / totalVehicles) * 100)
    : 0;

  const cards = [
    {
      title: "Total Vehicles",
      value: totalVehicles,
      icon: Car,
      description: "Active fleet vehicles",
      className: "bg-gradient-to-br from-slate-500/10 to-slate-600/5 border-slate-500/20 hover:border-slate-500/40 hover:shadow-lg",
      iconClassName: "text-slate-400",
      iconBgClassName: "bg-slate-500/10"
    },
    {
      title: "Available",
      value: availableVehicles,
      icon: CheckCircle,
      description: "Ready for rental",
      className: "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-lg",
      iconClassName: "text-emerald-500",
      iconBgClassName: "bg-emerald-500/10"
    },
    {
      title: "Currently Rented",
      value: rentedVehicles,
      icon: KeyRound,
      description: "Out on rental",
      className: "bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20 hover:border-amber-500/40 hover:shadow-lg",
      iconClassName: "text-amber-500",
      iconBgClassName: "bg-amber-500/10"
    },
    {
      title: "Fleet Value",
      value: formatCurrency(fleetValue, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      icon: DollarSign,
      description: "Total purchase value",
      className: "bg-gradient-to-br from-yellow-600/10 to-yellow-700/5 border-yellow-600/20 hover:border-yellow-600/40 hover:shadow-lg",
      iconClassName: "text-yellow-600",
      iconBgClassName: "bg-yellow-600/10"
    },
    {
      title: "Utilization Rate",
      value: `${utilizationRate}%`,
      icon: TrendingUp,
      description: "Fleet efficiency",
      className: utilizationRate >= 70
        ? "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-lg"
        : utilizationRate >= 40
        ? "bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20 hover:border-orange-500/40 hover:shadow-lg"
        : "bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20 hover:border-red-500/40 hover:shadow-lg",
      iconClassName: utilizationRate >= 70 ? "text-emerald-500" : utilizationRate >= 40 ? "text-orange-500" : "text-red-500",
      iconBgClassName: utilizationRate >= 70 ? "bg-emerald-500/10" : utilizationRate >= 40 ? "bg-orange-500/10" : "bg-red-500/10",
      valueClassName: utilizationRate >= 70 ? "text-emerald-600" : utilizationRate >= 40 ? "text-orange-600" : "text-red-600"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <Card key={card.title} className={`relative overflow-hidden transition-all duration-300 border-2 ${card.className}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-foreground/80">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${card.iconBgClassName}`}>
                <Icon className={`h-5 w-5 ${card.iconClassName || 'text-primary'}`} />
              </div>
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
