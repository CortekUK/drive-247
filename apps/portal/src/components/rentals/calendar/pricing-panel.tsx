"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarRange } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

type AdjustMode = "set" | "increase" | "decrease";

const parseLocal = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const humanDate = (s: string): string =>
  parseLocal(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: { id: string; reg: string; make: string; model: string } | null;
  baseRate: number;
  startDate: string | null;
  currency: string;
  /** Manual price for a given date for THIS vehicle (undefined if none). */
  getManual: (date: string) => number | undefined;
  onApply: (vehicleId: string, entries: { date: string; price: number }[]) => Promise<unknown>;
  onClear: (vehicleId: string, dates: string[]) => Promise<unknown>;
  isSetting: boolean;
  isClearing: boolean;
}

export function PricingPanel({
  open,
  onOpenChange,
  vehicle,
  baseRate,
  startDate,
  currency,
  getManual,
  onApply,
  onClear,
  isSetting,
  isClearing,
}: Props) {
  const [endDate, setEndDate] = useState<string>("");
  const [mode, setMode] = useState<AdjustMode>("set");
  const [amount, setAmount] = useState<string>("");

  // Reset the form each time a new cell opens the panel.
  useEffect(() => {
    if (startDate) {
      setEndDate(startDate);
      setMode("set");
      const existing = getManual(startDate);
      setAmount(existing != null ? String(existing) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, vehicle?.id]);

  const effectivePrice = (date: string) => {
    const m = getManual(date);
    return m != null ? m : baseRate;
  };

  // Dates covered by the selected range (start..end inclusive).
  const dates = useMemo(() => {
    if (!startDate) return [] as string[];
    const start = parseLocal(startDate);
    const end = endDate && endDate >= startDate ? parseLocal(endDate) : start;
    const out: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      out.push(toStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [startDate, endDate]);

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount >= 0;
  const canApply = !!vehicle && dates.length > 0 && amountValid && !isSetting;

  const datesWithCustom = dates.filter((d) => getManual(d) != null);

  const previewFor = (date: string): number => {
    if (mode === "set") return parsedAmount;
    if (mode === "increase") return effectivePrice(date) + parsedAmount;
    return Math.max(0, effectivePrice(date) - parsedAmount);
  };

  const handleApply = async () => {
    if (!canApply || !vehicle) return;
    const entries = dates.map((date) => ({
      date,
      price: Math.round(previewFor(date) * 100) / 100,
    }));
    await onApply(vehicle.id, entries);
    onOpenChange(false);
  };

  const handleClear = async () => {
    if (!vehicle || datesWithCustom.length === 0) {
      onOpenChange(false);
      return;
    }
    await onClear(vehicle.id, datesWithCustom);
    onOpenChange(false);
  };

  const currentManual = startDate ? getManual(startDate) : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Set price
          </SheetTitle>
          <SheetDescription>
            {vehicle ? (
              <span className="font-medium text-foreground">
                {vehicle.reg} · {vehicle.make} {vehicle.model}
              </span>
            ) : (
              "Select a vehicle day"
            )}
          </SheetDescription>
        </SheetHeader>

        {vehicle && startDate && (
          <div className="mt-6 space-y-5">
            {/* Current day */}
            <div className="rounded-lg border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Day</span>
                <span className="font-medium">{humanDate(startDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base daily rate</span>
                <span>{formatCurrency(baseRate, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current price</span>
                <span className={currentManual != null ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""}>
                  {formatCurrency(currentManual != null ? currentManual : baseRate, currency)}
                  {currentManual != null ? " (custom)" : " (default)"}
                </span>
              </div>
            </div>

            {/* Optional range */}
            <div className="space-y-1">
              <Label className="text-xs">Apply through (optional)</Label>
              <Input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground">
                {dates.length === 1
                  ? "Applies to this day only."
                  : `Applies to ${dates.length} days (${humanDate(dates[0])} – ${humanDate(dates[dates.length - 1])}).`}
              </p>
            </div>

            {/* Action */}
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Action</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as AdjustMode)}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="set">Set price to</SelectItem>
                    <SelectItem value="increase">Increase by</SelectItem>
                    <SelectItem value="decrease">Decrease by</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Amount ({currency})</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-9"
                />
              </div>
            </div>

            {amountValid && dates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {mode === "set"
                  ? `Each day → ${formatCurrency(parsedAmount, currency)}`
                  : `${humanDate(dates[0])} → ${formatCurrency(previewFor(dates[0]), currency)}${dates.length > 1 ? " (per-day, from each day's current price)" : ""}`}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleApply} disabled={!canApply} className="flex-1">
                {isSetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
              </Button>
              {datesWithCustom.length > 0 && (
                <Button variant="outline" onClick={handleClear} disabled={isClearing}>
                  {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Clear (${datesWithCustom.length})`}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              A custom price overrides the base rate and any weekend/holiday surcharge for that day — on both the operator side and customer checkout.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
