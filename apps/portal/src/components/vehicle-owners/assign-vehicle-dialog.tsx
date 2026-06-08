"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAssignVehicleOwner } from "@/hooks/use-owner-vehicles";

interface AssignVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
}

interface UnassignedVehicle {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  year: number | null;
}

export function AssignVehicleDialog({ open, onOpenChange, ownerId }: AssignVehicleDialogProps) {
  const { tenant } = useTenant();
  const assign = useAssignVehicleOwner();
  const [search, setSearch] = useState("");

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["unassigned-vehicles", tenant?.id, open],
    queryFn: async (): Promise<UnassignedVehicle[]> => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("id, reg, make, model, year")
        .eq("tenant_id", tenant!.id)
        .is("owner_id", null)
        .order("reg", { ascending: true });
      if (error) throw error;
      return (data || []) as UnassignedVehicle[];
    },
    enabled: !!tenant?.id && open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) =>
      [v.reg, v.make, v.model].some((f) => (f ?? "").toLowerCase().includes(q))
    );
  }, [vehicles, search]);

  const handleAssign = async (vehicleId: string) => {
    await assign.mutateAsync({ vehicle_id: vehicleId, owner_id: ownerId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Assign Vehicle to Owner</DialogTitle>
          <DialogDescription>
            Pick from your own-fleet vehicles. To re-assign a vehicle that already has an owner, unassign it first from that owner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="vehicle-search">Search</Label>
            <Input id="vehicle-search" placeholder="Reg, make, model..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="max-h-80 overflow-y-auto border rounded-md">
            {isLoading ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-center py-8 text-muted-foreground">
                {vehicles.length === 0 ? "No unassigned vehicles available." : "No vehicles match your search."}
              </p>
            ) : (
              <ul className="divide-y">
                {filtered.map((v) => (
                  <li key={v.id} className="flex items-center justify-between p-3 transition-colors hover:bg-[color:var(--bento-tile-2)]">
                    <div>
                      <div className="font-mono font-semibold tabular-nums">{v.reg}</div>
                      <div className="text-xs text-muted-foreground">
                        {[v.make, v.model, v.year].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => handleAssign(v.id)} disabled={assign.isPending}>
                      Assign
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
