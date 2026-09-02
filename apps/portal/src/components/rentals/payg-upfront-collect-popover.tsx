"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency as formatCurrencyUtil } from "@/lib/format-utils";

export interface PaygUpfrontLineItem {
  key: string;
  label: string;
  description?: string;
  amount: number;
  categories: string[];
  defaultChecked?: boolean;
  disabled?: boolean;
}

export interface PaygUpfrontConfirmPayload {
  amount: number;
  targetCategories: string[];
  selectedKeys: string[];
}

interface Props {
  currencyCode: string;
  lineItems: PaygUpfrontLineItem[];
  onConfirm: (payload: PaygUpfrontConfirmPayload) => void;
  triggerLabel?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function PaygUpfrontCollectPopover({
  currencyCode,
  lineItems,
  onConfirm,
  triggerLabel = "Collect Now",
  buttonClassName,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const item of lineItems) {
      if (item.defaultChecked !== false && !item.disabled && item.amount > 0) init.add(item.key);
    }
    return init;
  });

  useEffect(() => {
    if (!open) return;
    setChecked((prev) => {
      const next = new Set(prev);
      for (const item of lineItems) {
        if (item.disabled || item.amount <= 0) next.delete(item.key);
      }
      return next;
    });
  }, [open, lineItems]);

  const { total, selectedCategories } = useMemo(() => {
    let total = 0;
    const cats = new Set<string>();
    for (const item of lineItems) {
      if (!checked.has(item.key)) continue;
      total += item.amount;
      for (const c of item.categories) cats.add(c);
    }
    return {
      total: Math.round(total * 100) / 100,
      selectedCategories: Array.from(cats),
    };
  }, [lineItems, checked]);

  const handleToggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleContinue = () => {
    if (total <= 0 || selectedCategories.length === 0) return;
    setOpen(false);
    onConfirm({
      amount: total,
      targetCategories: selectedCategories,
      selectedKeys: Array.from(checked),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          disabled={disabled}
          className={
            buttonClassName ??
            "shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white"
          }
        >
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[360px] p-0 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-medium">Build upfront payment</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tick the items to bundle into one Collect Now charge.
          </p>
        </div>

        <div className="max-h-[320px] overflow-y-auto divide-y divide-border">
          {lineItems.map((item) => {
            const isChecked = checked.has(item.key);
            const isDisabled = item.disabled || item.amount <= 0;
            return (
              <label
                key={item.key}
                htmlFor={`payg-upfront-${item.key}`}
                className={
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors " +
                  (isDisabled
                    ? "opacity-50 cursor-not-allowed bg-muted/10"
                    : "hover:bg-muted/30")
                }
              >
                <Checkbox
                  id={`payg-upfront-${item.key}`}
                  checked={isChecked}
                  disabled={isDisabled}
                  onCheckedChange={() => !isDisabled && handleToggle(item.key)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {item.label}
                    </span>
                    <span className="text-sm font-semibold tabular-nums shrink-0">
                      {formatCurrencyUtil(item.amount, currencyCode)}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.description}
                    </p>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>

        <div className="border-t border-border px-4 py-3 bg-muted/20 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Total to collect
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrencyUtil(total, currencyCode)}
            </span>
          </div>
          <Button
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
            disabled={total <= 0 || selectedCategories.length === 0}
            onClick={handleContinue}
          >
            Continue to payment
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
