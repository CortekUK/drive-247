'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, TrendingUp, Settings, RotateCcw } from 'lucide-react';
import { useWeekendPricing } from '@/hooks/use-weekend-pricing';
import { useTenantHolidays } from '@/hooks/use-tenant-holidays';
import { useVehiclePricingOverrides, type VehiclePricingOverrideUpsert } from '@/hooks/use-vehicle-pricing-overrides';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import Link from 'next/link';

interface Props {
  vehicleId: string;
  dailyRent: number;
}

interface OverrideDialogState {
  open: boolean;
  ruleType: 'weekend' | 'holiday';
  holidayId: string | null;
  holidayName: string;
  overrideType: 'fixed_price' | 'custom_percent' | 'excluded';
  fixedPrice: number | '';
  customPercent: number | '';
}

const emptyDialog: OverrideDialogState = {
  open: false,
  ruleType: 'weekend',
  holidayId: null,
  holidayName: '',
  overrideType: 'fixed_price',
  fixedPrice: '',
  customPercent: '',
};

export function VehicleDynamicPricing({ vehicleId, dailyRent }: Props) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';
  const { settings: weekendSettings, isLoading: weekendLoading } = useWeekendPricing();
  const { holidays, isLoading: holidaysLoading } = useTenantHolidays();
  const { overrides, isLoading: overridesLoading, upsertOverride, isUpserting, resetOverride, isResetting } = useVehiclePricingOverrides(vehicleId);

  const [dialog, setDialog] = useState<OverrideDialogState>(emptyDialog);

  const isLoading = weekendLoading || holidaysLoading || overridesLoading;
  const hasWeekendRule = weekendSettings.weekend_surcharge_percent > 0;
  const hasAnyRules = hasWeekendRule || holidays.length > 0;

  const getWeekendOverride = () => overrides.find(o => o.rule_type === 'weekend');
  const getHolidayOverride = (holidayId: string) => overrides.find(o => o.rule_type === 'holiday' && o.holiday_id === holidayId);

  const computeEffectiveRate = (surchargePercent: number, override: ReturnType<typeof getWeekendOverride>) => {
    if (!override) {
      return dailyRent * (1 + surchargePercent / 100);
    }
    if (override.override_type === 'excluded') return dailyRent;
    if (override.override_type === 'fixed_price' && override.fixed_price != null) return override.fixed_price;
    if (override.override_type === 'custom_percent' && override.custom_percent != null) {
      return dailyRent * (1 + override.custom_percent / 100);
    }
    return dailyRent * (1 + surchargePercent / 100);
  };

  const getOverrideLabel = (override: ReturnType<typeof getWeekendOverride>) => {
    if (!override) return 'Inherit';
    if (override.override_type === 'excluded') return 'Excluded';
    if (override.override_type === 'fixed_price') return formatCurrency(override.fixed_price || 0, currencyCode) + ' (fixed)';
    if (override.override_type === 'custom_percent') return `+${override.custom_percent}% (custom)`;
    return 'Inherit';
  };

  const openOverrideDialog = (ruleType: 'weekend' | 'holiday', holidayId: string | null, holidayName: string) => {
    const existing = ruleType === 'weekend' ? getWeekendOverride() : getHolidayOverride(holidayId!);
    setDialog({
      open: true,
      ruleType,
      holidayId,
      holidayName: ruleType === 'weekend' ? 'Weekends' : holidayName,
      overrideType: existing?.override_type || 'fixed_price',
      fixedPrice: existing?.override_type === 'fixed_price' ? (existing.fixed_price ?? '') : '',
      customPercent: existing?.override_type === 'custom_percent' ? (existing.custom_percent ?? '') : '',
    });
  };

  const handleSaveOverride = async () => {
    const payload: VehiclePricingOverrideUpsert = {
      vehicle_id: vehicleId,
      rule_type: dialog.ruleType,
      holiday_id: dialog.holidayId,
      override_type: dialog.overrideType,
      fixed_price: dialog.overrideType === 'fixed_price' ? Number(dialog.fixedPrice) || 0 : null,
      custom_percent: dialog.overrideType === 'custom_percent' ? Number(dialog.customPercent) || 0 : null,
    };
    await upsertOverride(payload);
    setDialog(emptyDialog);
  };

  const handleReset = async (ruleType: 'weekend' | 'holiday', holidayId?: string | null) => {
    await resetOverride({ ruleType, holidayId });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAnyRules) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No dynamic pricing rules configured.{' '}
        <Link href="/settings?tab=pricing" className="text-primary hover:underline">
          Set up pricing rules in Settings
        </Link>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rule</TableHead>
            <TableHead>Global Effect</TableHead>
            <TableHead>This Vehicle</TableHead>
            <TableHead>Effective Rate</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Weekend row */}
          {hasWeekendRule && (
            <TableRow>
              <TableCell className="font-medium">Weekends</TableCell>
              <TableCell>
                <Badge variant="secondary">+{weekendSettings.weekend_surcharge_percent}%</Badge>
              </TableCell>
              <TableCell className="text-sm">
                {getOverrideLabel(getWeekendOverride())}
              </TableCell>
              <TableCell className="font-medium">
                {formatCurrency(computeEffectiveRate(weekendSettings.weekend_surcharge_percent, getWeekendOverride()), currencyCode)}/day
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openOverrideDialog('weekend', null, '')}>
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                  {getWeekendOverride() && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReset('weekend')} disabled={isResetting}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}

          {/* Holiday rows */}
          {holidays.map(holiday => {
            const override = getHolidayOverride(holiday.id);
            const isExcludedByGlobal = holiday.excluded_vehicle_ids?.includes(vehicleId);
            const effectiveSurcharge = isExcludedByGlobal ? 0 : holiday.surcharge_percent;

            return (
              <TableRow key={holiday.id}>
                <TableCell className="font-medium">
                  {holiday.name}
                  <span className="text-xs text-muted-foreground ml-1.5">
                    ({formatDateShort(holiday.start_date)}
                    {holiday.start_date !== holiday.end_date && <> – {formatDateShort(holiday.end_date)}</>})
                  </span>
                </TableCell>
                <TableCell>
                  {isExcludedByGlobal ? (
                    <Badge variant="outline" className="text-xs">Excluded (global)</Badge>
                  ) : (
                    <Badge variant="secondary">+{holiday.surcharge_percent}%</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {isExcludedByGlobal ? 'Excluded' : getOverrideLabel(override)}
                </TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(
                    isExcludedByGlobal ? dailyRent : computeEffectiveRate(holiday.surcharge_percent, override),
                    currencyCode
                  )}/day
                </TableCell>
                <TableCell>
                  {!isExcludedByGlobal && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openOverrideDialog('holiday', holiday.id, holiday.name)}>
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                      {override && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleReset('holiday', holiday.id)} disabled={isResetting}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Override Dialog */}
      <Dialog open={dialog.open} onOpenChange={open => !open && setDialog(emptyDialog)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override: {dialog.holidayName}</DialogTitle>
            <DialogDescription>
              Set a vehicle-specific override for this pricing rule.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Override Type</Label>
              <Select
                value={dialog.overrideType}
                onValueChange={val => setDialog(prev => ({ ...prev, overrideType: val as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_price">Fixed Price</SelectItem>
                  <SelectItem value="custom_percent">Custom Percentage</SelectItem>
                  <SelectItem value="excluded">Excluded (no surcharge)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {dialog.overrideType === 'fixed_price' && (
              <div className="space-y-2">
                <Label>Fixed Price per Day</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder={String(dailyRent)}
                  value={dialog.fixedPrice}
                  onChange={e => setDialog(prev => ({ ...prev, fixedPrice: e.target.value === '' ? '' : Number(e.target.value) }))}
                />
              </div>
            )}

            {dialog.overrideType === 'custom_percent' && (
              <div className="space-y-2">
                <Label>Surcharge (%)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="0"
                    value={dialog.customPercent}
                    onChange={e => setDialog(prev => ({ ...prev, customPercent: e.target.value === '' ? '' : Number(e.target.value) }))}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(emptyDialog)}>Cancel</Button>
            <Button onClick={handleSaveOverride} disabled={isUpserting}>
              {isUpserting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatDateShort(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[month - 1]} ${day}`;
  } catch {
    return dateStr;
  }
}
