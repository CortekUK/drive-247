'use client';

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WhatGetsSplit = 'rental_only' | 'rental_tax' | 'rental_tax_extras';

export interface InstallmentConfig {
  min_days_for_weekly: number;
  min_days_for_monthly: number;
  max_installments_weekly: number;
  max_installments_monthly: number;
  // Phase 3 additions
  charge_first_upfront?: boolean;
  what_gets_split?: WhatGetsSplit;
  grace_period_days?: number;
  max_retry_attempts?: number;
  retry_interval_days?: number;
}

export interface InstallmentOption {
  type: 'full' | 'weekly' | 'monthly';
  numberOfInstallments: number;       // Total number of installments
  scheduledInstallments: number;      // Number of installments to schedule (excludes first)
  installmentAmount: number;          // Amount per scheduled installment
  firstInstallmentAmount: number;     // First installment amount (paid upfront)
  totalAmount: number;                // Total installable amount
  upfrontTotal: number;               // Total amount paid today (deposit + fees + first installment)
  label: string;
  description: string;
}

interface InstallmentSelectorProps {
  rentalDays: number;
  installableAmount: number;  // Vehicle + Extras + Tax (split into installments)
  upfrontAmount: number;      // Deposit + Service Fee + Delivery + Collection (paid now)
  config: InstallmentConfig;
  enabled: boolean;
  onSelectPlan: (option: InstallmentOption | null) => void;
  selectedPlan: InstallmentOption | null;
  formatCurrency: (amount: number) => string;
}

export default function InstallmentSelector({
  rentalDays,
  installableAmount,
  upfrontAmount,
  config,
  enabled,
  onSelectPlan,
  selectedPlan,
  formatCurrency,
}: InstallmentSelectorProps) {
  const [expanded, setExpanded] = useState(true);

  // Calculate available installment options based on rental duration and config
  // If charge_first_upfront is true (default), first installment is charged at checkout
  // If false, all installments are scheduled for future dates
  const chargeFirstUpfront = config.charge_first_upfront !== false; // Default to true

  const availableOptions = useMemo((): InstallmentOption[] => {
    const options: InstallmentOption[] = [];

    // Always add "Pay in Full" option
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

    // Helper to calculate installments with rounding to last
    const calculateInstallments = (total: number, count: number) => {
      // Base amount for each installment (rounded down)
      const baseAmount = Math.floor((total / count) * 100) / 100;
      // Last installment gets the remainder to ensure total is exact
      const lastAmount = Math.round((total - (baseAmount * (count - 1))) * 100) / 100;
      return { baseAmount, lastAmount };
    };

    // Check if weekly installments are available
    if (rentalDays >= config.min_days_for_weekly) {
      const maxWeekly = Math.min(
        Math.floor(rentalDays / 7),
        config.max_installments_weekly
      );

      if (maxWeekly >= 2) {
        const { baseAmount, lastAmount } = calculateInstallments(installableAmount, maxWeekly);

        // If charging first upfront: first installment paid now, remaining scheduled
        // If not: all installments are scheduled
        const firstInstallment = chargeFirstUpfront ? baseAmount : 0;
        const scheduledCount = chargeFirstUpfront ? maxWeekly - 1 : maxWeekly;
        const upfrontTotal = upfrontAmount + firstInstallment;

        const description = chargeFirstUpfront
          ? `Pay ${formatCurrency(upfrontTotal)} today, then ${formatCurrency(baseAmount)}/week × ${scheduledCount}`
          : `Pay ${formatCurrency(upfrontAmount)} today, then ${formatCurrency(baseAmount)}/week × ${scheduledCount}`;

        options.push({
          type: 'weekly',
          numberOfInstallments: maxWeekly,
          scheduledInstallments: scheduledCount,
          installmentAmount: baseAmount,
          firstInstallmentAmount: firstInstallment,
          totalAmount: installableAmount,
          upfrontTotal,
          label: `Weekly (${maxWeekly} payments)`,
          description,
        });
      }
    }

    // Check if monthly installments are available
    if (rentalDays >= config.min_days_for_monthly) {
      const maxMonthly = Math.min(
        Math.ceil(rentalDays / 30),
        config.max_installments_monthly
      );

      if (maxMonthly >= 2) {
        const { baseAmount, lastAmount } = calculateInstallments(installableAmount, maxMonthly);

        // If charging first upfront: first installment paid now, remaining scheduled
        // If not: all installments are scheduled
        const firstInstallment = chargeFirstUpfront ? baseAmount : 0;
        const scheduledCount = chargeFirstUpfront ? maxMonthly - 1 : maxMonthly;
        const upfrontTotal = upfrontAmount + firstInstallment;

        const description = chargeFirstUpfront
          ? `Pay ${formatCurrency(upfrontTotal)} today, then ${formatCurrency(baseAmount)}/month × ${scheduledCount}`
          : `Pay ${formatCurrency(upfrontAmount)} today, then ${formatCurrency(baseAmount)}/month × ${scheduledCount}`;

        options.push({
          type: 'monthly',
          numberOfInstallments: maxMonthly,
          scheduledInstallments: scheduledCount,
          installmentAmount: baseAmount,
          firstInstallmentAmount: firstInstallment,
          totalAmount: installableAmount,
          upfrontTotal,
          label: `Monthly (${maxMonthly} payments)`,
          description,
        });
      }
    }

    return options;
  }, [rentalDays, installableAmount, upfrontAmount, config, enabled, formatCurrency, chargeFirstUpfront]);

  // If only "Pay in Full" is available, auto-select it and don't show selector
  if (availableOptions.length === 1) {
    if (!selectedPlan || selectedPlan.type !== 'full') {
      onSelectPlan(availableOptions[0]);
    }
    return null;
  }

  const handleSelectOption = (value: string) => {
    const option = availableOptions.find(o => o.type === value);
    onSelectPlan(option || null);
  };

  return (
    <Card className="p-4 border-2 border-accent/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-accent" />
          <h3 className="font-semibold">Payment Options</h3>
          {availableOptions.length > 1 && (
            <Badge variant="secondary" className="ml-2">
              {availableOptions.length - 1} installment options
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-4">
          <RadioGroup
            value={selectedPlan?.type || 'full'}
            onValueChange={handleSelectOption}
            className="space-y-3"
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

                  {/* Show payment schedule for installments */}
                  {option.type !== 'full' && selectedPlan?.type === option.type && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Payment Schedule
                      </p>
                      <div className="space-y-1.5">
                        {/* Today: Deposit + Fees (+ First Installment if charging upfront) */}
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

                        {/* Scheduled installments */}
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
                            {formatCurrency(upfrontAmount + option.totalAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </RadioGroup>

          {/* Info note */}
          <p className="text-xs text-muted-foreground mt-4 flex items-start gap-2">
            <CreditCard className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Installment payments are automatically charged to your card on the scheduled dates.
              Your card will be securely saved for future payments.
            </span>
          </p>
        </div>
      )}
    </Card>
  );
}
