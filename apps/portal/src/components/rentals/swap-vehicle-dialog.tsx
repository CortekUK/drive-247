"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { ArrowRight, CalendarIcon, Car, Loader2, Search, Wrench } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency as formatCurrencyUtil } from "@/lib/format-utils";
import { useVehicleSwap, type SwapCandidate } from "@/hooks/use-vehicle-swap";

interface RentalForSwap {
  id: string;
  vehicle_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  rental_period_type?: string | null;
  is_pay_as_you_go?: boolean | null;
  vehicles?: { reg?: string | null; make?: string | null; model?: string | null } | null;
}

interface SwapVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: RentalForSwap | null;
}

const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function rateFor(v: SwapCandidate, periodType?: string | null): { rate: number | null; label: string } {
  const p = (periodType || "daily").toLowerCase();
  if (p === "weekly") return { rate: v.weekly_rent, label: "week" };
  if (p === "monthly") return { rate: v.monthly_rent, label: "month" };
  return { rate: v.daily_rent, label: "day" };
}

export function SwapVehicleDialog({ open, onOpenChange, rental }: SwapVehicleDialogProps) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [blockOld, setBlockOld] = useState(false);
  const [blockStart, setBlockStart] = useState<Date | undefined>(undefined);
  const [blockEnd, setBlockEnd] = useState<Date | undefined>(undefined);

  const { candidates, isLoadingCandidates, swap, isSwapping } = useVehicleSwap({
    rentalId: rental?.id || "",
    currentVehicleId: rental?.vehicle_id,
    startDate: rental?.start_date,
    endDate: rental?.is_pay_as_you_go ? null : rental?.end_date,
    enabled: open && !!rental,
  });

  // Reset the form each time the dialog opens. The maintenance block is a
  // forward-looking window on the physical car (independent of the rental's
  // dates), so default it to today → +7 days. Defaulting "To" to the rental's
  // end date could land before today and break the end >= start constraint.
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedId(null);
      setReason("");
      setBlockOld(false);
      const today = new Date();
      setBlockStart(today);
      setBlockEnd(addDays(today, 7));
    }
  }, [open]);

  // Keep the block window valid: if the start moves past the end, push the end out.
  const handleBlockStartChange = (d?: Date) => {
    setBlockStart(d);
    if (d && blockEnd && blockEnd < d) {
      setBlockEnd(addDays(d, 7));
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((v) =>
      [v.reg, v.make, v.model].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [candidates, search]);

  const selected = candidates.find((v) => v.id === selectedId) || null;
  const blockRangeValid = !!blockStart && !!blockEnd && blockEnd >= blockStart;
  const canConfirm =
    !!selected && !selected.unavailable && !isSwapping &&
    (!blockOld || blockRangeValid);

  const handleConfirm = () => {
    if (!selected) return;
    swap(
      {
        newVehicleId: selected.id,
        reason: reason.trim() || undefined,
        blockOldStart: blockOld && blockStart ? ymd(blockStart) : null,
        blockOldEnd: blockOld && blockEnd ? ymd(blockEnd) : null,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const currentLabel = rental?.vehicles
    ? `${rental.vehicles.reg ?? ""} · ${rental.vehicles.make ?? ""} ${rental.vehicles.model ?? ""}`.trim()
    : "Current vehicle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            Swap Vehicle
          </DialogTitle>
          <DialogDescription>
            Move this rental onto a different vehicle (e.g. while the current car is in maintenance).
            Pricing and dates stay the same.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Current → New summary */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Current</p>
              <p className="font-medium truncate">{currentLabel}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">New</p>
              <p className={cn("font-medium truncate", !selected && "text-muted-foreground")}>
                {selected ? `${selected.reg} · ${selected.make} ${selected.model}` : "Pick below"}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by plate, make or model"
              className="pl-9"
            />
          </div>

          {/* Candidate list */}
          <ScrollArea className="h-[240px] rounded-lg border">
            {isLoadingCandidates ? (
              <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading vehicles…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                No other vehicles found.
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map((v) => {
                  const { rate, label } = rateFor(v, rental?.rental_period_type);
                  const disabled = v.unavailable;
                  const isSelected = v.id === selectedId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                        disabled
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-muted/50",
                        isSelected && "bg-primary/5"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          isSelected ? "border-primary" : "border-muted-foreground/40"
                        )}
                      >
                        {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{v.reg}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {v.make} {v.model}
                        </p>
                      </div>
                      {rate ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatCurrencyUtil(rate, currency)}/{label}
                        </span>
                      ) : null}
                      {v.unavailable ? (
                        <Badge variant="outline" className="shrink-0 border-red-200 text-red-600">
                          Booked
                        </Badge>
                      ) : v.blocked ? (
                        <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-600">
                          Maintenance
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 border-green-200 text-green-600">
                          Free
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {selected?.blocked && (
            <p className="text-xs text-amber-600">
              Heads up: {selected.reg} has a maintenance block overlapping these dates. You can still swap into it.
            </p>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="swap-reason">Reason (optional)</Label>
            <Textarea
              id="swap-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Original vehicle in for maintenance"
              rows={2}
            />
          </div>

          {/* Block old vehicle */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="block-old"
                checked={blockOld}
                onCheckedChange={(c) => setBlockOld(c === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="block-old" className="flex items-center gap-1.5 font-medium">
                  <Wrench className="h-3.5 w-3.5" />
                  Block the old vehicle for maintenance
                </Label>
                <p className="text-xs text-muted-foreground">
                  Stops {currentLabel.split(" · ")[0] || "the old car"} from being booked during these dates.
                </p>
              </div>
            </div>

            {blockOld && (
              <div className="grid grid-cols-2 gap-3 pl-7">
                <DatePickerField label="From" value={blockStart} onChange={handleBlockStartChange} />
                <DatePickerField label="To" value={blockEnd} onChange={setBlockEnd} minDate={blockStart} />
              </div>
            )}

            {blockOld && !blockRangeValid && (
              <p className="pl-7 text-xs text-red-500">The "To" date must be on or after the "From" date.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSwapping}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {isSwapping ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Swapping…
              </>
            ) : (
              "Confirm swap"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatePickerField({
  label,
  value,
  onChange,
  minDate,
}: {
  label: string;
  value?: Date;
  onChange: (d?: Date) => void;
  minDate?: Date;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("justify-start pl-3 text-left font-normal", !value && "text-muted-foreground")}
          >
            {value ? format(value, "PP") : <span>Pick a date</span>}
            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => onChange(d ?? undefined)}
            disabled={minDate ? { before: minDate } : undefined}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default SwapVehicleDialog;
