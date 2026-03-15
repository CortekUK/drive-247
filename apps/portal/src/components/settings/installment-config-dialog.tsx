'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Save, Loader2, Calendar, CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import type { InstallmentConfig, WhatGetsSplit } from '@/hooks/use-rental-settings';

interface InstallmentConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: InstallmentConfig;
  onSave: (config: InstallmentConfig) => Promise<void>;
  isSaving: boolean;
}

// Example scenarios for the teaching UI
const EXAMPLE_SCENARIOS = [
  { days: 7, dailyRate: 30, total: 210 },
  { days: 14, dailyRate: 50, total: 700 },
  { days: 30, dailyRate: 25, total: 750 },
  { days: 60, dailyRate: 40, total: 2400 },
];

export function InstallmentConfigDialog({
  open,
  onOpenChange,
  config,
  onSave,
  isSaving,
}: InstallmentConfigDialogProps) {
  const { tenant } = useTenant();
  const [form, setForm] = useState<InstallmentConfig>({ ...config });

  // Track raw string values for number inputs so users can clear & retype
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Sync form when dialog opens or config changes
  useEffect(() => {
    if (open) {
      setForm({ ...config });
      setDrafts({});
    }
  }, [open, config]);

  const update = (field: keyof InstallmentConfig, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Get displayed value: use draft string if editing, otherwise form number
  const getDraft = (field: string) => field in drafts ? drafts[field] : String((form as any)[field] ?? '');

  // Handle change: store raw string, update form only if valid number
  const handleNumberChange = (field: keyof InstallmentConfig, raw: string, opts?: { min?: number; max?: number }) => {
    setDrafts(prev => ({ ...prev, [field]: raw }));
    const num = raw === '' ? NaN : Number(raw);
    if (!isNaN(num)) {
      let val = num;
      if (opts?.min !== undefined) val = Math.max(opts.min, val);
      if (opts?.max !== undefined) val = Math.min(opts.max, val);
      update(field, val);
    }
  };

  // On blur: if draft is empty or invalid, reset to form value and clear draft
  const handleNumberBlur = (field: keyof InstallmentConfig, fallback: number, opts?: { min?: number; max?: number }) => {
    const raw = drafts[field];
    if (raw === undefined) return;
    const num = raw === '' ? NaN : Number(raw);
    if (isNaN(num)) {
      update(field, fallback);
    } else {
      let val = num;
      if (opts?.min !== undefined) val = Math.max(opts.min, val);
      if (opts?.max !== undefined) val = Math.min(opts.max, val);
      update(field, val);
    }
    setDrafts(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const handleSave = async () => {
    await onSave(form);
    onOpenChange(false);
  };

  // Compute eligibility for example scenarios
  const scenarioResults = useMemo(() => {
    return EXAMPLE_SCENARIOS.map(s => {
      const weeklyEligible =
        s.days >= form.minimum_days_weekly &&
        (form.limiting_amount_per_day_weekly <= 0 || s.dailyRate >= form.limiting_amount_per_day_weekly);
      const monthlyEligible =
        s.days >= form.minimum_days_monthly &&
        (form.limiting_amount_per_day_monthly <= 0 || s.dailyRate >= form.limiting_amount_per_day_monthly);
      return { ...s, weeklyEligible, monthlyEligible };
    });
  }, [form]);

  // Live preview data
  const previewData = useMemo(() => {
    const days = 20;
    const total = 1000;
    const perDay = total / days;
    const weeklyOk = days >= form.minimum_days_weekly &&
      (form.limiting_amount_per_day_weekly <= 0 || perDay >= form.limiting_amount_per_day_weekly);
    const monthlyOk = days >= form.minimum_days_monthly &&
      (form.limiting_amount_per_day_monthly <= 0 || perDay >= form.limiting_amount_per_day_monthly);

    const options: { type: string; payments: number; amount: number }[] = [];
    if (weeklyOk && form.weekly_installments_limit >= 2) {
      const amt = Math.floor((total / form.weekly_installments_limit) * 100) / 100;
      options.push({ type: 'Weekly', payments: form.weekly_installments_limit, amount: amt });
    }
    if (monthlyOk && form.monthly_installments_limit >= 2) {
      const amt = Math.floor((total / form.monthly_installments_limit) * 100) / 100;
      options.push({ type: 'Monthly', payments: form.monthly_installments_limit, amount: amt });
    }
    return { days, total, options };
  }, [form]);

  const tenantName = tenant?.business_name || tenant?.name || 'Your company';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-xl">Set Up Installment Payments</DialogTitle>
          <DialogDescription>
            Let your customers pay for their rental in smaller, regular payments instead of all at once
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[45%_55%] overflow-hidden">
          {/* LEFT PANEL — Configuration */}
          <div className="overflow-y-auto p-6 space-y-6 border-r">
            {/* Weekly Installments */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm text-foreground">Weekly Payment Plan</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Rental must be at least this many days</Label>
                  <Input
                    type="number"
                    min="1"
                    value={getDraft('minimum_days_weekly')}
                    onChange={e => handleNumberChange('minimum_days_weekly', e.target.value, { min: 1 })}
                    onBlur={() => handleNumberBlur('minimum_days_weekly', 7, { min: 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Split into how many payments?</Label>
                  <Input
                    type="number"
                    min="2"
                    max="12"
                    value={getDraft('weekly_installments_limit')}
                    onChange={e => handleNumberChange('weekly_installments_limit', e.target.value, { min: 2, max: 12 })}
                    onBlur={() => handleNumberBlur('weekly_installments_limit', 4, { min: 2, max: 12 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Only allow if daily rate is at least ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={getDraft('limiting_amount_per_day_weekly')}
                  onChange={e => handleNumberChange('limiting_amount_per_day_weekly', e.target.value, { min: 0 })}
                  onBlur={() => handleNumberBlur('limiting_amount_per_day_weekly', 0, { min: 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Leave at 0 if you don't want to set a minimum daily rate.
                </p>
              </div>
            </div>

            <Separator />

            {/* Monthly Installments */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm text-foreground">Monthly Payment Plan</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Rental must be at least this many days</Label>
                  <Input
                    type="number"
                    min="1"
                    value={getDraft('minimum_days_monthly')}
                    onChange={e => handleNumberChange('minimum_days_monthly', e.target.value, { min: 1 })}
                    onBlur={() => handleNumberBlur('minimum_days_monthly', 30, { min: 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Split into how many payments?</Label>
                  <Input
                    type="number"
                    min="2"
                    max="12"
                    value={getDraft('monthly_installments_limit')}
                    onChange={e => handleNumberChange('monthly_installments_limit', e.target.value, { min: 2, max: 12 })}
                    onBlur={() => handleNumberBlur('monthly_installments_limit', 6, { min: 2, max: 12 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Only allow if daily rate is at least ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={getDraft('limiting_amount_per_day_monthly')}
                  onChange={e => handleNumberChange('limiting_amount_per_day_monthly', e.target.value, { min: 0 })}
                  onBlur={() => handleNumberBlur('limiting_amount_per_day_monthly', 0, { min: 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Leave at 0 if you don't want to set a minimum daily rate.
                </p>
              </div>
            </div>

            <Separator />

            <Separator />

            {/* Failed Payment Recovery */}
            <div className="space-y-4">
              <h3 className="font-medium text-sm text-foreground">If a Payment Fails</h3>
              <p className="text-xs text-muted-foreground">
                What happens when the system tries to charge a customer's card and it doesn't go through
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Wait this many days before chasing</Label>
                  <Input
                    type="number"
                    min="0"
                    max="14"
                    value={getDraft('grace_period_days')}
                    onChange={e => handleNumberChange('grace_period_days', e.target.value, { min: 0, max: 14 })}
                    onBlur={() => handleNumberBlur('grace_period_days', 3, { min: 0, max: 14 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">How many times to retry</Label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={getDraft('max_retry_attempts')}
                    onChange={e => handleNumberChange('max_retry_attempts', e.target.value, { min: 1, max: 10 })}
                    onBlur={() => handleNumberBlur('max_retry_attempts', 3, { min: 1, max: 10 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Days between each retry</Label>
                  <Input
                    type="number"
                    min="1"
                    max="7"
                    value={getDraft('retry_interval_days')}
                    onChange={e => handleNumberChange('retry_interval_days', e.target.value, { min: 1, max: 7 })}
                    onBlur={() => handleNumberBlur('retry_interval_days', 1, { min: 1, max: 7 })}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT PANEL — Live Preview */}
          <div className="overflow-y-auto p-6 bg-muted/50 space-y-6">
            {/* Example bookings as simple cards */}
            <div className="space-y-3">
              <h3 className="font-medium text-sm text-foreground">Live Examples for {tenantName}</h3>
              <div className="grid grid-cols-2 gap-3">
                {scenarioResults.map((s, i) => (
                  <div key={i} className="border rounded-lg bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{s.days}-day rental</span>
                      <span className="text-xs text-muted-foreground">${s.dailyRate}/day · ${s.total}</span>
                    </div>
                    <div className="flex gap-2">
                      {s.weeklyEligible ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[#f0fdf4] text-[#16a34a]">
                          <CheckCircle2 className="w-3 h-3" /> Weekly
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-50 text-[#dc2626]">
                          <XCircle className="w-3 h-3" /> Weekly
                        </span>
                      )}
                      {s.monthlyEligible ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[#f0fdf4] text-[#16a34a]">
                          <CheckCircle2 className="w-3 h-3" /> Monthly
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-50 text-[#dc2626]">
                          <XCircle className="w-3 h-3" /> Monthly
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Customer preview */}
            <div className="space-y-3">
              <h3 className="font-medium text-sm text-foreground">What a {tenantName} customer sees</h3>
              <div className="border-2 border-dashed border-[#6366f1]/30 rounded-lg bg-background overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-[#6366f1]" />
                    <span className="text-sm font-medium text-foreground">{tenantName} — Payment Options</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{previewData.days} days · ${previewData.total.toLocaleString()}</span>
                </div>
                <div className="p-4 space-y-3">

                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2.5 border-2 border-[#6366f1] rounded-lg bg-[#6366f1]/5">
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-[#6366f1] flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#6366f1]" />
                    </div>
                    <span className="text-sm font-medium flex-1">Pay in Full</span>
                    <span className="text-xs text-muted-foreground">${previewData.total.toLocaleString()}</span>
                  </div>

                  {previewData.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 border rounded-lg">
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40" />
                      <span className="text-sm font-medium flex-1">{opt.type} ({opt.payments}x)</span>
                      <span className="text-xs text-muted-foreground">${opt.amount.toFixed(2)}/each</span>
                    </div>
                  ))}

                  {previewData.options.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      No installment options for this sample booking
                    </p>
                  )}
                </div>

                {previewData.options.length > 0 && (
                  <div className="border-t pt-2.5 space-y-1">
                    <div className="flex justify-between text-xs bg-[#6366f1]/5 px-2 py-1.5 rounded">
                      <span className="font-medium flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-[#6366f1]" />
                        Today
                      </span>
                      <span className="font-medium text-[#6366f1]">
                        {form.charge_first_upfront
                          ? `$${previewData.options[0].amount.toFixed(2)} + deposit`
                          : 'Deposit only'
                        }
                      </span>
                    </div>
                    {Array.from({ length: Math.min(form.charge_first_upfront ? previewData.options[0].payments - 1 : previewData.options[0].payments, 3) }).map((_, i) => (
                      <div key={i} className="flex justify-between text-xs px-2 py-1">
                        <span className="text-muted-foreground">
                          {previewData.options[0].type === 'Weekly' ? `Week ${form.charge_first_upfront ? i + 2 : i + 1}` : `Month ${form.charge_first_upfront ? i + 2 : i + 1}`}
                        </span>
                        <span className="text-[#404040]">${previewData.options[0].amount.toFixed(2)}</span>
                      </div>
                    ))}
                    {(form.charge_first_upfront ? previewData.options[0].payments - 1 : previewData.options[0].payments) > 3 && (
                      <p className="text-[10px] text-muted-foreground text-center">
                        + {(form.charge_first_upfront ? previewData.options[0].payments - 1 : previewData.options[0].payments) - 3} more payments
                      </p>
                    )}
                  </div>
                )}
              </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t bg-background">
          <Button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Configuration
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

