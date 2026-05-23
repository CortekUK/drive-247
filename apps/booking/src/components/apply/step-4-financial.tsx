"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { ApplyFormValues } from "@/client-schemas/apply";

export function Step4Financial() {
  const { register, watch, setValue, formState: { errors } } = useFormContext<ApplyFormValues>();
  const canPayDeposit = watch("canPayDeposit");

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-md border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="canPayDeposit"
            checked={!!canPayDeposit}
            onCheckedChange={(v) => setValue("canPayDeposit", v === true, { shouldValidate: true })}
          />
          <div>
            <Label htmlFor="canPayDeposit" className="cursor-pointer text-sm font-medium">
              I can pay a security deposit
            </Label>
            <p className="text-xs text-muted-foreground">
              Deposits are refundable, held on a card via Stripe.
            </p>
          </div>
        </div>
        {canPayDeposit && (
          <div className="space-y-1.5">
            <Label htmlFor="depositComfortAmount">Deposit you&rsquo;re comfortable with (USD)</Label>
            <Input
              id="depositComfortAmount"
              type="number"
              min={0}
              step={50}
              {...register("depositComfortAmount", { valueAsNumber: true })}
            />
            {errors.depositComfortAmount && (
              <p className="text-xs text-destructive">{errors.depositComfortAmount.message}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="weeklyBudget">Weekly rental budget (USD)</Label>
        <Input
          id="weeklyBudget"
          type="number"
          min={0}
          step={10}
          {...register("weeklyBudget", { valueAsNumber: true })}
          placeholder="e.g. 350"
        />
        {errors.weeklyBudget && <p className="text-xs text-destructive">{errors.weeklyBudget.message}</p>}
      </div>
    </div>
  );
}
