'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Calendar, CreditCard, Clock, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WhatGetsSplit = 'rental_only' | 'rental_tax' | 'rental_tax_extras';

export interface InstallmentConfig {
  minimum_days_weekly: number;
  minimum_days_monthly: number;
  weekly_installments_limit: number;
  monthly_installments_limit: number;
  limiting_amount_per_day_weekly: number;
  limiting_amount_per_day_monthly: number;
  charge_first_upfront?: boolean;
  what_gets_split?: WhatGetsSplit;
  grace_period_days?: number;
  max_retry_attempts?: number;
  retry_interval_days?: number;
  // Backward compat (old keys)
  min_days_for_weekly?: number;
  min_days_for_monthly?: number;
  max_installments_weekly?: number;
  max_installments_monthly?: number;
}

export interface InstallmentOption {
  type: 'full' | 'weekly' | 'monthly';
  numberOfInstallments: number;
  scheduledInstallments: number;
  installmentAmount: number;
  firstInstallmentAmount: number;
  totalAmount: number;
  upfrontTotal: number;
  label: string;
  description: string;
}

interface InstallmentSelectorProps {
  rentalDays: number;
  installableAmount: number;
  upfrontAmount: number;
  totalBill: number;
  config: InstallmentConfig;
  enabled: boolean;
  onSelectPlan: (option: InstallmentOption | null) => void;
  selectedPlan: InstallmentOption | null;
  formatCurrency: (amount: number) => string;
}

// Helper to resolve new keys with backward compat fallbacks
function resolveConfig(config: InstallmentConfig) {
  return {
    minimumDaysWeekly: config.minimum_days_weekly ?? config.min_days_for_weekly ?? 7,
    minimumDaysMonthly: config.minimum_days_monthly ?? config.min_days_for_monthly ?? 30,
    weeklyInstallmentsLimit: config.weekly_installments_limit ?? config.max_installments_weekly ?? 4,
    monthlyInstallmentsLimit: config.monthly_installments_limit ?? config.max_installments_monthly ?? 6,
    limitingAmountPerDayWeekly: config.limiting_amount_per_day_weekly ?? 0,
    limitingAmountPerDayMonthly: config.limiting_amount_per_day_monthly ?? 0,
  };
}

export default function InstallmentSelector({
  rentalDays,
  installableAmount,
  upfrontAmount,
  totalBill,
  config,
  enabled,
  onSelectPlan,
  selectedPlan,
  formatCurrency,
}: InstallmentSelectorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const chargeFirstUpfront = config.charge_first_upfront !== false;
  const resolved = resolveConfig(config);

  const availableOptions = useMemo((): InstallmentOption[] => {
    const options: InstallmentOption[] = [];

    const fullAmount = installableAmount + upfrontAmount;
    options.push({
      type: 'full',
      numberOfInstallments: 1,
      scheduledInstallments: 0,
      installmentAmount: fullAmount,
      firstInstallmentAmount: fullAmount,
      totalAmount: fullAmount,
      upfrontTotal: fullAmount,
      label: 'Pay in Full',
      description: `Pay ${formatCurrency(fullAmount)} now`,
    });

    if (!enabled) return options;

    const perDayRate = rentalDays > 0 ? totalBill / rentalDays : 0;

    const calculateInstallments = (total: number, count: number) => {
      const baseAmount = Math.floor((total / count) * 100) / 100;
      const lastAmount = Math.round((total - (baseAmount * (count - 1))) * 100) / 100;
      return { baseAmount, lastAmount };
    };

    // Weekly eligibility: dual-gate check
    const weeklyDaysOk = rentalDays >= resolved.minimumDaysWeekly;
    const weeklyAmountOk = resolved.limitingAmountPerDayWeekly <= 0 || perDayRate >= resolved.limitingAmountPerDayWeekly;

    if (weeklyDaysOk && weeklyAmountOk) {
      const count = resolved.weeklyInstallmentsLimit;
      if (count >= 2) {
        const { baseAmount } = calculateInstallments(installableAmount, count);
        const firstInstallment = chargeFirstUpfront ? baseAmount : 0;
        const scheduledCount = chargeFirstUpfront ? count - 1 : count;
        const upfrontTotal = upfrontAmount + firstInstallment;

        const description = chargeFirstUpfront
          ? `Pay ${formatCurrency(upfrontTotal)} today, then ${formatCurrency(baseAmount)}/week × ${scheduledCount}`
          : `Pay ${formatCurrency(upfrontAmount)} today, then ${formatCurrency(baseAmount)}/week × ${scheduledCount}`;

        options.push({
          type: 'weekly',
          numberOfInstallments: count,
          scheduledInstallments: scheduledCount,
          installmentAmount: baseAmount,
          firstInstallmentAmount: firstInstallment,
          totalAmount: installableAmount,
          upfrontTotal,
          label: `Weekly (${count} payments)`,
          description,
        });
      }
    }

    // Monthly eligibility: dual-gate check
    const monthlyDaysOk = rentalDays >= resolved.minimumDaysMonthly;
    const monthlyAmountOk = resolved.limitingAmountPerDayMonthly <= 0 || perDayRate >= resolved.limitingAmountPerDayMonthly;

    if (monthlyDaysOk && monthlyAmountOk) {
      const count = resolved.monthlyInstallmentsLimit;
      if (count >= 2) {
        const { baseAmount } = calculateInstallments(installableAmount, count);
        const firstInstallment = chargeFirstUpfront ? baseAmount : 0;
        const scheduledCount = chargeFirstUpfront ? count - 1 : count;
        const upfrontTotal = upfrontAmount + firstInstallment;

        const description = chargeFirstUpfront
          ? `Pay ${formatCurrency(upfrontTotal)} today, then ${formatCurrency(baseAmount)}/month × ${scheduledCount}`
          : `Pay ${formatCurrency(upfrontAmount)} today, then ${formatCurrency(baseAmount)}/month × ${scheduledCount}`;

        options.push({
          type: 'monthly',
          numberOfInstallments: count,
          scheduledInstallments: scheduledCount,
          installmentAmount: baseAmount,
          firstInstallmentAmount: firstInstallment,
          totalAmount: installableAmount,
          upfrontTotal,
          label: `Monthly (${count} payments)`,
          description,
        });
      }
    }

    return options;
  }, [rentalDays, installableAmount, upfrontAmount, totalBill, config, enabled, formatCurrency, chargeFirstUpfront, resolved]);

  // Auto-select pay-in-full if no installment options
  useEffect(() => {
    if (availableOptions.length === 1 && (!selectedPlan || selectedPlan.type !== 'full')) {
      onSelectPlan(availableOptions[0]);
    }
  }, [availableOptions.length]);

  if (availableOptions.length === 1) {
    return null;
  }

  const handleSelectOption = (value: string) => {
    const option = availableOptions.find(o => o.type === value);
    onSelectPlan(option || null);
  };

  const handleConfirm = () => {
    setDialogOpen(false);
  };

  const planCount = availableOptions.length - 1; // exclude "Pay in Full"

  // Summary text for trigger card
  const selectedSummary = selectedPlan && selectedPlan.type !== 'full'
    ? `${selectedPlan.label} — ${selectedPlan.description}`
    : 'Pay in Full selected';

  return (
    <>
      {/* Trigger Card */}
      <Card
        className="p-4 border-2 border-accent/20 cursor-pointer hover:border-accent/40 transition-all"
        onClick={() => setDialogOpen(true)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            <CreditCard className="w-5 h-5 text-accent" />
            <div>
              <h3 className="font-semibold">Payment Options</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {selectedPlan && selectedPlan.type !== 'full' ? (
                  <span className="flex items-center gap-1">
                    <Check className="w-3 h-3 text-green-600" />
                    {selectedSummary}
                  </span>
                ) : (
                  `${planCount} installment plan${planCount > 1 ? 's' : ''} available`
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {planCount} option{planCount > 1 ? 's' : ''}
            </Badge>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </div>
      </Card>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-accent" />
              Choose Payment Plan
            </DialogTitle>
            <DialogDescription>
              Select how you'd like to pay for your rental
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={selectedPlan?.type || 'full'}
            onValueChange={handleSelectOption}
            className="space-y-3 mt-2"
          >
            {availableOptions.map((option) => (
              <div
                key={option.type}
                className={cn(
                  'relative flex items-start gap-3 p-4 rounded-lg border-2 transition-all cursor-pointer',
                  selectedPlan?.type === option.type
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                )}
                onClick={() => handleSelectOption(option.type)}
              >
                <RadioGroupItem
                  value={option.type}
                  id={`payment-${option.type}`}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor={`payment-${option.type}`}
                      className="font-medium cursor-pointer"
                    >
                      {option.label}
                    </Label>
                    {option.type === 'full' && (
                      <Badge variant="outline" className="text-xs">
                        No fees
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {option.description}
                  </p>

                  {option.type !== 'full' && selectedPlan?.type === option.type && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Payment Schedule
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-sm bg-accent/10 -mx-2 px-2 py-1 rounded">
                          <span className="flex items-center gap-1 font-medium">
                            <Calendar className="w-3 h-3 text-accent" />
                            Today
                          </span>
                          <span className="font-bold text-accent">{formatCurrency(option.upfrontTotal)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground pl-4 -mt-1">
                          {chargeFirstUpfront && option.firstInstallmentAmount > 0
                            ? `Deposit + Fees (${formatCurrency(upfrontAmount)}) + 1st installment (${formatCurrency(option.firstInstallmentAmount)})`
                            : `Deposit + Fees (${formatCurrency(upfrontAmount)})`
                          }
                        </div>

                        {Array.from({ length: option.scheduledInstallments }).map((_, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              {option.type === 'weekly'
                                ? `Week ${chargeFirstUpfront ? i + 2 : i + 1}`
                                : `Month ${chargeFirstUpfront ? i + 2 : i + 1}`}
                            </span>
                            <span className="font-medium">{formatCurrency(option.installmentAmount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-sm pt-2 border-t border-dashed">
                          <span className="font-medium">Total</span>
                          <span className="font-bold text-accent">
                            {formatCurrency(upfrontAmount + option.totalAmount - option.firstInstallmentAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </RadioGroup>

          <p className="text-xs text-muted-foreground mt-2 flex items-start gap-2">
            <CreditCard className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Installment payments are automatically charged to your card on the scheduled dates.
              Your card will be securely saved for future payments.
            </span>
          </p>

          <div className="flex justify-end mt-4">
            <Button onClick={handleConfirm} className="px-8">
              Confirm Selection
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
