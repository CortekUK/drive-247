'use client';

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InstallmentConfig {
  min_days_for_weekly: number;
  min_days_for_monthly: number;
  max_installments_weekly: number;
  max_installments_monthly: number;
}

export interface InstallmentOption {
  type: 'full' | 'weekly' | 'monthly';
  numberOfInstallments: number;
  installmentAmount: number;
  totalAmount: number;
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
  const availableOptions = useMemo((): InstallmentOption[] => {
    const options: InstallmentOption[] = [];

    // Always add "Pay in Full" option
    options.push({
      type: 'full',
      numberOfInstallments: 1,
      installmentAmount: installableAmount + upfrontAmount,
      totalAmount: installableAmount + upfrontAmount,
      label: 'Pay in Full',
      description: `Pay ${formatCurrency(installableAmount + upfrontAmount)} now`,
    });

    if (!enabled) return options;

    // Check if weekly installments are available
    if (rentalDays >= config.min_days_for_weekly) {
      const maxWeekly = Math.min(
        Math.floor(rentalDays / 7),
        config.max_installments_weekly
      );

      if (maxWeekly >= 2) {
        const installmentAmount = Math.round((installableAmount / maxWeekly) * 100) / 100;
        options.push({
          type: 'weekly',
          numberOfInstallments: maxWeekly,
          installmentAmount,
          totalAmount: installableAmount,
          label: `Weekly (${maxWeekly} payments)`,
          description: `Pay ${formatCurrency(upfrontAmount)} now, then ${formatCurrency(installmentAmount)}/week`,
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
        const installmentAmount = Math.round((installableAmount / maxMonthly) * 100) / 100;
        options.push({
          type: 'monthly',
          numberOfInstallments: maxMonthly,
          installmentAmount,
          totalAmount: installableAmount,
          label: `Monthly (${maxMonthly} payments)`,
          description: `Pay ${formatCurrency(upfrontAmount)} now, then ${formatCurrency(installmentAmount)}/month`,
        });
      }
    }

    return options;
  }, [rentalDays, installableAmount, upfrontAmount, config, enabled, formatCurrency]);

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
                        <div className="flex justify-between text-sm">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-accent" />
                            Today (Deposit + Fees)
                          </span>
                          <span className="font-medium">{formatCurrency(upfrontAmount)}</span>
                        </div>
                        {Array.from({ length: option.numberOfInstallments }).map((_, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              {option.type === 'weekly'
                                ? `Week ${i + 1}`
                                : `Month ${i + 1}`}
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
