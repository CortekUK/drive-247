"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export const FleetOverview = () => {
  const { tenant } = useTenant();
  const router = useRouter();

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["vehicles", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos(photo_url, display_order)
        `)
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as unknown as Vehicle[];
    },
    enabled: !!tenant,
  });

  const { data: vehiclePL } = useQuery({
    queryKey: ["vehicle-pl", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("view_pl_by_vehicle")
        .select("*");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

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
    enabled: !!tenant,
  });

  const getVehiclePhoto = (vehicle: Vehicle) => {
    return vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0
      ? [...vehicle.vehicle_photos].sort((a, b) => a.display_order - b.display_order)[0]?.photo_url
      : vehicle.photo_url;
  };

  const getOperationalCosts = (pl?: VehiclePL) => {
    if (!pl) return 0;
    return Number(pl.cost_service) + Number(pl.cost_fines) + Number(pl.cost_other) + Number(pl.cost_finance);
  };

  const getOperationalProfit = (pl?: VehiclePL) => {
    if (!pl) return 0;
    return Number(pl.total_revenue) - getOperationalCosts(pl);
  };

  const getTotalPL = (vehicle: Vehicle, pl?: VehiclePL) => {
    return pl ? Number(pl.net_profit) : -(vehicle.purchase_price || 0);
  };

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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Photo</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Acquisition</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Op. Costs</TableHead>
                  <TableHead className="text-right">Op. Profit</TableHead>
                  <TableHead className="text-right">Total P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => {
                  const pl = vehiclePL?.[vehicle.id];
                  const opCosts = getOperationalCosts(pl);
                  const opProfit = getOperationalProfit(pl);
                  const totalPL = getTotalPL(vehicle, pl);

                  return (
                    <TableRow
                      key={vehicle.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/vehicles/${vehicle.id}`)}
                    >
                      <TableCell>
                        <VehiclePhotoThumbnail
                          photoUrl={getVehiclePhoto(vehicle)}
                          vehicleReg={vehicle.reg}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{vehicle.reg}</div>
                          <div className="text-sm text-muted-foreground">
                            {vehicle.make} {vehicle.model}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={vehicle.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        ${(vehicle.purchase_price || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">
                        ${(pl?.total_revenue || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        ${opCosts.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {opProfit >= 0 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-600" />
                          )}
                          <span className={opProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                            ${Math.abs(opProfit).toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 font-semibold">
                          {totalPL >= 0 ? (
                            <TrendingUp className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-600" />
                          )}
                          <span className={totalPL >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                            ${Math.abs(totalPL).toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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