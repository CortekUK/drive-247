"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Car, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAttachInsuranceVerification } from "@/hooks/use-insurance-verifications";

interface RentalOption {
  id: string;
  rental_number: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  customer_name: string | null;
  vehicle_reg: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
}

export function AttachVerificationDialog({
  open,
  onOpenChange,
  verificationId,
  currentRentalId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verificationId: string | null;
  currentRentalId: string | null;
}) {
  const { tenant } = useTenant();
  const [query, setQuery] = useState("");
  const attach = useAttachInsuranceVerification();

  const { data: rentals = [], isLoading } = useQuery({
    queryKey: ["rentals-for-attach", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(
          `id, rental_number, status, start_date, end_date,
           customers!rentals_customer_id_fkey ( name ),
           vehicles!rentals_vehicle_id_fkey ( reg, make, model )`,
        )
        .eq("tenant_id", tenant!.id)
        .in("status", ["Active", "Pending"])
        .order("start_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        rental_number: r.rental_number,
        status: r.status,
        start_date: r.start_date,
        end_date: r.end_date,
        customer_name: r.customers?.name ?? null,
        vehicle_reg: r.vehicles?.reg ?? null,
        vehicle_make: r.vehicles?.make ?? null,
        vehicle_model: r.vehicles?.model ?? null,
      })) as RentalOption[];
    },
    enabled: !!tenant && open,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rentals;
    return rentals.filter((r) =>
      [
        r.rental_number,
        r.customer_name,
        r.vehicle_reg,
        r.vehicle_make,
        r.vehicle_model,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rentals, query]);

  const handleAttach = async (rentalId: string | null) => {
    if (!verificationId) return;
    try {
      await attach.mutateAsync({ verificationId, rentalId });
      toast.success(rentalId ? "Attached to rental" : "Detached from rental");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach verification to rental</DialogTitle>
          <DialogDescription>
            Pick an active or pending rental to attach this verification to. It
            will appear on the rental's detail page.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by booking ref, customer, vehicle…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-auto rounded-md border">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading rentals…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No active or pending rentals match.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((r) => {
                const isCurrent = r.id === currentRentalId;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium truncate">
                        {r.rental_number || r.id.slice(0, 8)}
                        <span
                          className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${
                            r.status === "Active"
                              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {r.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.customer_name ?? "Unknown customer"} ·{" "}
                        <Car className="inline h-3 w-3" />{" "}
                        {r.vehicle_reg}{" "}
                        {r.vehicle_make ? `(${r.vehicle_make} ${r.vehicle_model ?? ""})` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isCurrent ? "secondary" : "default"}
                      disabled={attach.isPending}
                      onClick={() => handleAttach(r.id)}
                    >
                      {isCurrent ? "Attached" : "Attach"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {currentRentalId ? (
            <Button
              variant="ghost"
              onClick={() => handleAttach(null)}
              disabled={attach.isPending}
              className="text-red-600 hover:text-red-700"
            >
              <Link2Off className="h-4 w-4 mr-2" />
              Detach from rental
            </Button>
          ) : (
            <div />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
