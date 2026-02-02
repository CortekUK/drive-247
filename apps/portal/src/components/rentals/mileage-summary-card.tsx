import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, TrendingUp, TrendingDown, Minus, Car } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";

interface MileageSummaryCardProps {
  rentalId: string;
  vehicleId: string;
}

interface KeyHandover {
  id: string;
  handover_type: "giving" | "receiving";
  mileage: number | null;
  handed_at: string | null;
}

interface Vehicle {
  id: string;
  allowed_mileage: number | null;
  current_mileage: number | null;
}

export function MileageSummaryCard({ rentalId, vehicleId }: MileageSummaryCardProps) {
  const { tenant } = useTenant();

  // Fetch key handovers for this rental
  const { data: handovers } = useQuery({
    queryKey: ["key-handovers-mileage", rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .select("id, handover_type, mileage, handed_at")
        .eq("rental_id", rentalId);

      if (error) throw error;
      return data as KeyHandover[];
    },
    enabled: !!rentalId,
  });

  // Fetch vehicle details for allowed_mileage and current_mileage
  const { data: vehicle } = useQuery({
    queryKey: ["vehicle-mileage", vehicleId],
    queryFn: async () => {
      let query = supabase
        .from("vehicles")
        .select("id, allowed_mileage, current_mileage")
        .eq("id", vehicleId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.single();
      if (error) throw error;
      return data as Vehicle;
    },
    enabled: !!vehicleId,
  });

  const givingHandover = handovers?.find((h) => h.handover_type === "giving");
  const receivingHandover = handovers?.find((h) => h.handover_type === "receiving");

  const pickupMileage = givingHandover?.mileage;
  const returnMileage = receivingHandover?.mileage;
  const milesDriven = pickupMileage && returnMileage ? returnMileage - pickupMileage : null;
  const allowedMileage = vehicle?.allowed_mileage;
  const currentVehicleMileage = vehicle?.current_mileage;

  // Calculate over/under allowance
  const mileageDifference = milesDriven && allowedMileage ? milesDriven - allowedMileage : null;

  // Don't show the card if no mileage data exists
  if (!pickupMileage && !returnMileage && !currentVehicleMileage) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Gauge className="h-5 w-5 text-primary" />
          Mileage Summary
        </CardTitle>
        <CardDescription>
          Odometer readings and mileage tracking for this rental
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Pickup Mileage */}
          <div className="space-y-1 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">At Pickup</p>
            <p className="text-xl font-semibold">
              {pickupMileage ? `${pickupMileage.toLocaleString()} mi` : "—"}
            </p>
          </div>

          {/* Return Mileage */}
          <div className="space-y-1 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">At Return</p>
            <p className="text-xl font-semibold">
              {returnMileage ? `${returnMileage.toLocaleString()} mi` : "—"}
            </p>
          </div>

          {/* Miles Driven */}
          <div className="space-y-1 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Miles Driven</p>
            <p className="text-xl font-semibold text-primary">
              {milesDriven !== null ? `${milesDriven.toLocaleString()} mi` : "—"}
            </p>
          </div>

          {/* Over/Under Allowance */}
          <div className="space-y-1 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              vs Allowance {allowedMileage ? `(${allowedMileage.toLocaleString()})` : ""}
            </p>
            {mileageDifference !== null ? (
              <div className="flex items-center gap-2">
                {mileageDifference > 0 ? (
                  <>
                    <TrendingUp className="h-4 w-4 text-destructive" />
                    <span className="text-xl font-semibold text-destructive">
                      +{mileageDifference.toLocaleString()} mi
                    </span>
                    <Badge variant="destructive" className="text-xs">Over</Badge>
                  </>
                ) : mileageDifference < 0 ? (
                  <>
                    <TrendingDown className="h-4 w-4 text-green-600" />
                    <span className="text-xl font-semibold text-green-600">
                      {mileageDifference.toLocaleString()} mi
                    </span>
                    <Badge className="bg-green-100 text-green-700 text-xs">Under</Badge>
                  </>
                ) : (
                  <>
                    <Minus className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xl font-semibold">Exact</span>
                  </>
                )}
              </div>
            ) : allowedMileage ? (
              <p className="text-xl font-semibold text-muted-foreground">—</p>
            ) : (
              <p className="text-sm text-muted-foreground">Unlimited</p>
            )}
          </div>
        </div>

        {/* Vehicle Current Mileage */}
        {currentVehicleMileage && (
          <div className="mt-4 pt-4 border-t flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Car className="h-4 w-4" />
              <span>Vehicle's Current Odometer</span>
            </div>
            <span className="font-semibold">{currentVehicleMileage.toLocaleString()} miles</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
