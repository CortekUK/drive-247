import { Car, CheckCircle2, KeyRound, Gauge } from "lucide-react";
import { KpiTile } from "@/components/bento";

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

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiTile
        label="Total Vehicles"
        value={totalVehicles}
        sub="Active fleet vehicles"
        icon={<Car className="h-4 w-4" />}
      />
      <KpiTile
        label="Available"
        value={availableVehicles}
        sub="Ready for rental"
        icon={<CheckCircle2 className="h-4 w-4" />}
      />
      <KpiTile
        variant="feature"
        label="Currently Rented"
        value={rentedVehicles}
        sub="Out on rental"
        icon={<KeyRound className="h-4 w-4" />}
      />
      <KpiTile
        variant={utilizationRate >= 40 ? "default" : "warn"}
        label="Utilization Rate"
        value={utilizationRate}
        format={(v) => `${v}%`}
        sub="Fleet efficiency"
        icon={<Gauge className="h-4 w-4" />}
      />
    </div>
  );
};
