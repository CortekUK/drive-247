'use client';

import React, { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Loader2, CalendarRange } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { useVehicleDailyPrices } from '@/hooks/use-vehicle-daily-prices';

interface Props {
  vehicleId: string;
  dailyRent: number;
}

type AdjustMode = 'set' | 'increase' | 'decrease';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Turo-style per-day pricing calendar. The operator picks one or more days for
 * a specific vehicle and sets a fixed price, or nudges the price up/down. A day
 * with a custom price overrides the base rate AND all weekend/holiday surcharges
 * for that day (see calculate-rental-price.ts). Clearing reverts to default.
 */
export function VehicleDailyPricingCalendar({ vehicleId, dailyRent }: Props) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || 'USD';
  const { priceMap, isLoading, setPrices, isSetting, clearPrices, isClearing } = useVehicleDailyPrices(vehicleId);

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<AdjustMode>('set');
  const [amount, setAmount] = useState<string>('');

  const today = startOfDay(new Date());

  const gridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewMonth]);

  // Effective price for a day = manual price if set, else the vehicle's base daily rate.
  const effectivePrice = (dateStr: string) => (priceMap[dateStr] != null ? priceMap[dateStr] : dailyRent);

  const isSelectable = (day: Date) => isSameMonth(day, viewMonth) && !isBefore(startOfDay(day), today);

  const toggleDay = (day: Date) => {
    if (!isSelectable(day)) return;
    const key = format(day, 'yyyy-MM-dd');
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllInMonth = () => {
    const all = gridDays.filter(isSelectable).map(d => format(d, 'yyyy-MM-dd'));
    setSelected(new Set(all));
  };

  const clearSelection = () => setSelected(new Set());

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount >= 0;
  const canApply = selected.size > 0 && amountValid && !isSetting;

  const applyPrices = async () => {
    if (!canApply) return;
    const entries = [...selected].map(dateStr => {
      let price: number;
      if (mode === 'set') price = parsedAmount;
      else if (mode === 'increase') price = effectivePrice(dateStr) + parsedAmount;
      else price = Math.max(0, effectivePrice(dateStr) - parsedAmount);
      return { date: dateStr, price: Math.round(price * 100) / 100 };
    });
    await setPrices(entries);
    clearSelection();
    setAmount('');
  };

  const clearCustom = async () => {
    // Only clear days that actually have a custom price.
    const dates = [...selected].filter(d => priceMap[d] != null);
    if (dates.length === 0) {
      clearSelection();
      return;
    }
    await clearPrices(dates);
    clearSelection();
  };

  const customCount = Object.keys(priceMap).length;
  const selectedWithCustom = [...selected].filter(d => priceMap[d] != null).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Per-day pricing
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Set a custom price for specific days. A custom price overrides the base rate and any weekend/holiday surcharge for that day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewMonth(m => addMonths(m, -1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-32 text-center">{format(viewMonth, 'MMMM yyyy')}</span>
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewMonth(m => addMonths(m, 1))} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-[11px] font-medium text-muted-foreground text-center py-1">{w}</div>
            ))}
            {gridDays.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const inMonth = isSameMonth(day, viewMonth);
              const selectable = isSelectable(day);
              const isSelected = selected.has(dateStr);
              const hasCustom = priceMap[dateStr] != null;
              const price = effectivePrice(dateStr);
              return (
                <button
                  type="button"
                  key={dateStr}
                  disabled={!selectable}
                  onClick={() => toggleDay(day)}
                  className={[
                    'relative flex flex-col items-center justify-center rounded-md border h-16 text-xs transition-colors',
                    !inMonth ? 'opacity-30 pointer-events-none border-transparent' : '',
                    !selectable && inMonth ? 'opacity-40 cursor-not-allowed bg-muted/30' : '',
                    selectable ? 'cursor-pointer hover:border-primary/50' : '',
                    isSelected ? 'border-primary ring-1 ring-primary bg-primary/10' : 'border-border',
                    hasCustom && !isSelected ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900' : '',
                  ].join(' ')}
                >
                  <span className={`font-medium ${hasCustom ? 'text-indigo-700 dark:text-indigo-300' : 'text-foreground'}`}>{format(day, 'd')}</span>
                  <span className={`mt-0.5 text-[10px] ${hasCustom ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground'}`}>
                    {formatCurrency(price, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                  {hasCustom && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500 inline-block" /> Custom price</span>
              <span>{customCount} custom day{customCount !== 1 ? 's' : ''} set</span>
            </div>
            <button type="button" onClick={selectAllInMonth} className="text-primary hover:underline">Select all future days</button>
          </div>

          {selected.size > 0 && (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{selected.size} day{selected.size !== 1 ? 's' : ''} selected</span>
                <button type="button" onClick={clearSelection} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
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
                <div className="space-y-1">
                  <Label className="text-xs">Amount ({currency})</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-9 w-28"
                  />
                </div>
                <Button type="button" onClick={applyPrices} disabled={!canApply} className="h-9">
                  {isSetting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                </Button>
                {selectedWithCustom > 0 && (
                  <Button type="button" variant="outline" onClick={clearCustom} disabled={isClearing} className="h-9">
                    {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Clear custom (${selectedWithCustom})`}
                  </Button>
                )}
              </div>
              {mode !== 'set' && (
                <p className="text-[11px] text-muted-foreground">
                  {mode === 'increase' ? 'Adds to' : 'Subtracts from'} each day&apos;s current price (custom price if set, otherwise the base daily rate).
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
