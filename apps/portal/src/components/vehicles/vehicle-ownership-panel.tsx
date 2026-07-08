"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { useAssignVehicleOwner } from "@/hooks/use-owner-vehicles";
import { formatCurrency } from "@/lib/format-utils";
import {
  COMMISSION_TYPE_OPTIONS,
  FLAT_FEE_PERIOD_OPTIONS,
  flatFeePeriodSuffix,
  type CommissionType,
  type FlatFeePeriod,
} from "@/types/vehicle-owners";

interface VehicleOwnershipFields {
  owner_id: string | null;
  ownership_assigned_at: string | null;
  commission_type_override: CommissionType | null;
  commission_value_override: number | null;
  flat_fee_period_override: FlatFeePeriod | null;
}

interface VehicleOwnershipPanelProps {
  vehicleId: string;
}

export function VehicleOwnershipPanel({ vehicleId }: VehicleOwnershipPanelProps) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const { data: owners = [] } = useVehicleOwners({ includeInactive: false });
  const assign = useAssignVehicleOwner();

  const { data: vehicle, isLoading, refetch } = useQuery({
    queryKey: ["vehicle-ownership", tenant?.id, vehicleId],
    queryFn: async (): Promise<VehicleOwnershipFields | null> => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("owner_id, ownership_assigned_at, commission_type_override, commission_value_override, flat_fee_period_override")
        .eq("id", vehicleId)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as VehicleOwnershipFields) ?? null;
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  const [editing, setEditing] = useState(false);
  const [ownerId, setOwnerId] = useState<string>("__own__");
  const [overrideOn, setOverrideOn] = useState(false);
  const [commissionType, setCommissionType] = useState<CommissionType>("percentage");
  const [commissionValue, setCommissionValue] = useState<string>("0");
  const [flatFeePeriod, setFlatFeePeriod] = useState<FlatFeePeriod>("per_month");
  const [error, setError] = useState<string | null>(null);

  // Sync local form with loaded data when entering edit mode
  useEffect(() => {
    if (!editing || !vehicle) return;
    setOwnerId(vehicle.owner_id ?? "__own__");
    if (vehicle.commission_type_override) {
      setOverrideOn(true);
      setCommissionType(vehicle.commission_type_override);
      setCommissionValue(String(vehicle.commission_value_override ?? 0));
      setFlatFeePeriod(vehicle.flat_fee_period_override ?? "per_month");
    } else {
      setOverrideOn(false);
      setCommissionType("percentage");
      setCommissionValue("0");
      setFlatFeePeriod("per_month");
    }
    setError(null);
  }, [editing, vehicle]);

  const currentOwner = owners.find((o) => o.id === vehicle?.owner_id);

  const handleSave = async () => {
    setError(null);
    const targetOwner = ownerId === "__own__" ? null : ownerId;
    const valueNum = Number(commissionValue);
    if (overrideOn) {
      if (Number.isNaN(valueNum) || valueNum < 0) {
        setError("Override commission must be a positive number.");
        return;
      }
      if (commissionType === "percentage" && valueNum > 100) {
        setError("Percentage cannot exceed 100%.");
        return;
      }
    }
    try {
      await assign.mutateAsync({
        vehicle_id: vehicleId,
        owner_id: targetOwner,
        commission_type_override: targetOwner && overrideOn ? commissionType : null,
        commission_value_override: targetOwner && overrideOn ? valueNum : null,
        flat_fee_period_override: targetOwner && overrideOn && commissionType === "flat_fee" ? flatFeePeriod : null,
      });
      setEditing(false);
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Ownership</CardTitle>
        {!editing && !isLoading && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-[#737373]">Loading...</div>
        ) : !editing ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-[#737373]">Owner</div>
              {vehicle?.owner_id ? (
                <Link href={`/vehicle-owners/${vehicle.owner_id}`} className="text-[#6366f1] hover:underline inline-flex items-center gap-1">
                  {currentOwner?.full_name ?? "Unknown owner"} <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <Badge variant="outline" className="border-gray-300 text-[#737373]">Own fleet</Badge>
              )}
            </div>
            <div>
              <div className="text-xs text-[#737373]">Assigned</div>
              <div>{vehicle?.ownership_assigned_at ? format(new Date(vehicle.ownership_assigned_at), "yyyy-MM-dd") : "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-[#737373]">Commission</div>
              <div>
                {vehicle?.commission_type_override
                  ? vehicle.commission_type_override === "percentage"
                    ? `${vehicle.commission_value_override}% (override)`
                    : `${formatCurrency(Number(vehicle.commission_value_override ?? 0), currency)} / ${flatFeePeriodSuffix(vehicle.flat_fee_period_override)} (override)`
                  : currentOwner
                    ? `Inheriting owner default: ${
                        currentOwner.commission_type === "percentage"
                          ? `${currentOwner.commission_value}%`
                          : `${formatCurrency(currentOwner.commission_value, currency)} / ${flatFeePeriodSuffix(currentOwner.flat_fee_period)}`
                      }`
                    : "—"}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__own__">Own fleet (no third-party owner)</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ownerId !== "__own__" && (
              <>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label htmlFor="override-toggle">Override owner default commission?</Label>
                    <p className="text-xs text-[#737373] mt-1">Use a different rate for this specific vehicle.</p>
                  </div>
                  <Switch id="override-toggle" checked={overrideOn} onCheckedChange={setOverrideOn} />
                </div>

                {overrideOn && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Commission Type</Label>
                      <Select value={commissionType} onValueChange={(v) => setCommissionType(v as CommissionType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COMMISSION_TYPE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{commissionType === "percentage" ? "Percentage (%)" : "Flat Amount"}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        max={commissionType === "percentage" ? 100 : undefined}
                        value={commissionValue}
                        onChange={(e) => setCommissionValue(e.target.value)}
                      />
                    </div>
                    {commissionType === "flat_fee" && (
                      <div className="col-span-2">
                        <Label>Flat Fee Period</Label>
                        <Select value={flatFeePeriod} onValueChange={(v) => setFlatFeePeriod(v as FlatFeePeriod)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FLAT_FEE_PERIOD_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={assign.isPending}>Cancel</Button>
              <Button onClick={handleSave} disabled={assign.isPending}>
                {assign.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
