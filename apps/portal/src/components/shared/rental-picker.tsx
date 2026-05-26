"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Car, Loader2, User } from "lucide-react";
import { parseLocalDate } from "@/lib/date-utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

export interface PickerRental {
  id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  customer_id: string;
  customers: { id: string; name: string; email?: string | null; phone?: string | null };
  vehicles: { id: string; reg: string; make: string; model: string };
}

interface RentalPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Insurance mode: only Active/Confirmed with future end_date, no PAYG. Agreement mode: also includes last 90d Completed. */
  mode: "insurance" | "agreement";
  onSelect: (rental: PickerRental) => void;
  title?: string;
  description?: string;
}

export function RentalPicker({
  open,
  onOpenChange,
  mode,
  onSelect,
  title,
  description,
}: RentalPickerProps) {
  const { tenant } = useTenant();
  const [search, setSearch] = useState("");

  const { data: rentals = [], isLoading } = useQuery({
    queryKey: ["rental-picker", tenant?.id],
    queryFn: async (): Promise<PickerRental[]> => {
      if (!tenant) return [];

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          start_date,
          end_date,
          status,
          customer_id,
          customers!rentals_customer_id_fkey(id, name, email, phone),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model)
        `)
        .eq("tenant_id", tenant.id)
        .order("start_date", { ascending: false })
        .limit(500);

      if (error) throw error;

      return (data || [])
        .filter((r: any) => r.customers && r.vehicles)
        .map((r: any) => ({
          id: r.id,
          start_date: r.start_date,
          end_date: r.end_date,
          status: r.status,
          customer_id: r.customer_id,
          customers: r.customers,
          vehicles: r.vehicles,
        }));
    },
    enabled: open && !!tenant,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rentals;
    const q = search.toLowerCase();
    return rentals.filter((r) => {
      const customerName = r.customers.name?.toLowerCase() || "";
      const reg = r.vehicles.reg?.toLowerCase() || "";
      const make = r.vehicles.make?.toLowerCase() || "";
      const model = r.vehicles.model?.toLowerCase() || "";
      return (
        customerName.includes(q) ||
        reg.includes(q) ||
        make.includes(q) ||
        model.includes(q)
      );
    });
  }, [rentals, search]);

  const handleSelect = (rental: PickerRental) => {
    setSearch("");
    onSelect(rental);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>{title || "Select a Rental"}</DialogTitle>
          <DialogDescription>
            {description ||
              (mode === "insurance"
                ? "Choose an active rental to issue Bonzah insurance for."
                : "Choose a rental to generate an agreement for.")}
          </DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by customer, vehicle reg, make or model..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-[420px]">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading rentals...
              </div>
            ) : filtered.length === 0 ? (
              <CommandEmpty>
                {search.trim() ? "No matching rentals found." : "No rentals available."}
              </CommandEmpty>
            ) : (
              <div className="p-1">
                {filtered.map((rental) => (
                  <button
                    key={rental.id}
                    type="button"
                    onClick={() => handleSelect(rental)}
                    className="w-full text-left rounded-md px-3 py-2.5 hover:bg-accent transition-colors flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {rental.customers.name}
                        </span>
                        <Badge
                          variant={
                            rental.status === "Active"
                              ? "default"
                              : rental.status === "Confirmed"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px] px-1.5 py-0 h-4"
                        >
                          {rental.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Car className="h-3 w-3 shrink-0" />
                        <span className="font-mono uppercase">{rental.vehicles.reg}</span>
                        <span>·</span>
                        <span className="truncate">
                          {rental.vehicles.make} {rental.vehicles.model}
                        </span>
                        <span>·</span>
                        <span className="whitespace-nowrap">
                          {format(parseLocalDate(rental.start_date), "MMM d")} →{" "}
                          {rental.end_date
                            ? format(parseLocalDate(rental.end_date), "MMM d, yyyy")
                            : "Open"}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
