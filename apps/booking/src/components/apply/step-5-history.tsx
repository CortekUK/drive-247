"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { ApplyFormValues } from "@/client-schemas/apply";

interface ToggleProps {
  id: keyof ApplyFormValues;
  label: string;
  description?: string;
}

function Toggle({ id, label, description }: ToggleProps) {
  const { watch, setValue } = useFormContext<ApplyFormValues>();
  const value = watch(id);
  return (
    <div className="flex items-start gap-3 rounded-md border bg-card p-3">
      <Checkbox
        id={id as string}
        checked={!!value}
        onCheckedChange={(v) => setValue(id, v === true as never, { shouldValidate: true })}
      />
      <div>
        <Label htmlFor={id as string} className="cursor-pointer text-sm font-medium">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export function Step5History() {
  const { register, watch, formState: { errors } } = useFormContext<ApplyFormValues>();
  const rideshareActive = watch("rideshareAccountActive");

  return (
    <div className="space-y-4">
      <Toggle id="rentedBefore" label="I've rented a car before (any company)" />
      <Toggle id="rentedFromUsBefore" label="I've rented from this company before" />
      <Toggle id="rideshareAccountActive" label="My rideshare/delivery account is active right now" />

      {rideshareActive && (
        <div className="space-y-1.5">
          <Label htmlFor="rideshareTier">Rideshare tier or rating (optional)</Label>
          <Input id="rideshareTier" {...register("rideshareTier")} placeholder="e.g. Uber Platinum, 4.95 rating" />
          {errors.rideshareTier && <p className="text-xs text-destructive">{errors.rideshareTier.message}</p>}
        </div>
      )}
    </div>
  );
}
