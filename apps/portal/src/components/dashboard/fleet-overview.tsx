"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Car, TrendingUp, TrendingDown } from "lucide-react";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  colour: string;
  status: string;
  purchase_price: number;
  photo_url?: string;
  vehicle_photos?: any[];
}

interface VehiclePL {
  vehicle_id: string;
  total_revenue: number;
  total_costs: number;
  net_profit: number;
  cost_acquisition: number;
  cost_service: number;
  cost_fines: number;
  cost_other: number;
  cost_finance: number;
}

const StatusBadge = ({ status }: { status: string }) => {
  const variants = {
    Available: "badge-status bg-success-light text-success border-success",
    Rented: "badge-status bg-primary-light text-primary border-primary",
    Sold: "badge-status bg-muted text-muted-foreground border-border",
    Disposed: "badge-status bg-muted text-muted-foreground border-border"
  };
  
  return (
    <Badge variant="outline" className={variants[status as keyof typeof variants] || variants.Available}>
      {status}
    </Badge>
  );
};

const VehicleCard = ({ vehicle, pl }: { vehicle: Vehicle; pl?: VehiclePL }) => {
  const router = useRouter();

  // Calculate operational profit (revenue minus operational costs, excluding acquisition)
  const operationalCosts = pl ? (Number(pl.cost_service) + Number(pl.cost_fines) + Number(pl.cost_other) + Number(pl.cost_finance)) : 0;
  const operationalProfit = pl ? Number(pl.total_revenue) - operationalCosts : 0;
  const isOperationalProfit = operationalProfit > 0;

  // Total P&L is already calculated in the view as net_profit
  const totalPL = pl ? Number(pl.net_profit) : -(vehicle.purchase_price || 0);
  const isTotalProfit = totalPL > 0;

  const handleClick = () => {
    router.push(`/vehicles/${vehicle.id}`);
  };

  // Get the first photo from vehicle_photos array, sorted by display_order, fallback to photo_url
  const primaryPhoto = vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0
    ? [...vehicle.vehicle_photos].sort((a, b) => a.display_order - b.display_order)[0]?.photo_url
    : vehicle.photo_url;

  return (
    <Card className="card-hover shadow-card transition-all duration-300 hover:scale-102 cursor-pointer" onClick={handleClick}>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-[2]">
            <VehiclePhotoThumbnail
              photoUrl={primaryPhoto}
              vehicleReg={vehicle.reg}
              size="sm"
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm sm:text-base font-semibold truncate sm:truncate-none" title={vehicle.reg}>
                {vehicle.reg || 'No Registration'}
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm truncate" title={`${vehicle.make} ${vehicle.model}`}>
                {vehicle.make} {vehicle.model}
              </CardDescription>
            </div>
          </div>
          <div className="shrink-0">
            <StatusBadge status={vehicle.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs sm:text-sm">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Acquisition</span>
          <span className="font-medium">${(vehicle.purchase_price || 0).toLocaleString()}</span>
        </div>
        {pl ? (
          <>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Revenue</span>
              <span className="font-medium text-emerald-600">${Number(pl.total_revenue).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Op. Costs</span>
              <span className="font-medium text-orange-600">${operationalCosts.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Op. Profit</span>
              <div className="flex items-center gap-1">
                {isOperationalProfit ? (
                  <TrendingUp className="h-3 w-3 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-600" />
                )}
                <span className={`font-medium ${isOperationalProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                  ${Math.abs(operationalProfit).toLocaleString()}
                </span>
              </div>
            </div>
            <hr className="border-border/50" />
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-medium">Total P&L</span>
              <div className="flex items-center gap-1">
                {isTotalProfit ? (
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
                <span className={`font-semibold ${isTotalProfit ? 'text-emerald-600' : 'text-red-600'}`}>
                  ${Math.abs(totalPL).toLocaleString()}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-2">
            <span className="text-muted-foreground text-xs">No P&L data available</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const FleetOverview = () => {
  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos(photo_url, display_order)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Vehicle[];
    },
  });

  const { data: vehiclePL } = useQuery({
    queryKey: ["vehicle-pl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("view_pl_by_vehicle")
        .select("*");
      
      if (error) throw error;
      
      // Convert to lookup by vehicle_id
      const plByVehicle: Record<string, VehiclePL> = {};
      
      data?.forEach((entry) => {
        plByVehicle[entry.vehicle_id] = {
          vehicle_id: entry.vehicle_id,
          total_revenue: Number(entry.total_revenue || 0),
          total_costs: Number(entry.total_costs || 0),
          net_profit: Number(entry.net_profit || 0),
          cost_acquisition: Number(entry.cost_acquisition || 0),
          cost_service: Number(entry.cost_service || 0),
          cost_fines: Number(entry.cost_fines || 0),
          cost_other: Number(entry.cost_other || 0),
          cost_finance: Number(entry.cost_finance || 0),
        };
      });
      
      return plByVehicle;
    },
  });

  if (isLoading) {
    return <div>Loading vehicles...</div>;
  }

  return (
    <Card className="shadow-card rounded-lg">
      <CardHeader>
        <div>
          <CardTitle className="text-xl font-semibold">Fleet Overview</CardTitle>
          <CardDescription>Monitor vehicle performance and P&L</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {vehicles && vehicles.length > 0 ? (
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((vehicle) => (
              <VehicleCard 
                key={vehicle.id} 
                vehicle={vehicle} 
                pl={vehiclePL?.[vehicle.id]}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Car className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No vehicles in fleet</h3>
            <p className="text-muted-foreground mb-4">Add your first vehicle to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};