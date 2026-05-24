"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { computeAge, isoToday, type ApplyFormValues } from "@/client-schemas/apply";

export function Step2Driver() {
  const { register, setValue, watch, formState: { errors } } = useFormContext<ApplyFormValues>();
  const hasViolations = watch("hasViolations");
  const dateOfBirth = watch("dateOfBirth");

  // Licence expiry: today → 30y out. Today's date stays stable until midnight crossings.
  const licenceBounds = useMemo(() => {
    const max = new Date();
    max.setFullYear(max.getFullYear() + 30);
    return { min: isoToday(), max: isoToday(max) };
  }, []);

  // Max plausible years driving = age − 16 (clamped to 80).
  const maxYearsDriving = useMemo(() => {
    if (!dateOfBirth) return 80;
    const age = computeAge(dateOfBirth);
    if (!Number.isFinite(age)) return 80;
    return Math.min(80, Math.max(0, age - 16));
  }, [dateOfBirth]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="licenceNumber">Driver licence number</Label>
          <Input id="licenceNumber" {...register("licenceNumber")} />
          {errors.licenceNumber && <p className="text-xs text-destructive">{errors.licenceNumber.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="licenceState">Issuing state / region</Label>
          <Input id="licenceState" {...register("licenceState")} />
          {errors.licenceState && <p className="text-xs text-destructive">{errors.licenceState.message}</p>}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="licenceExpiry">Licence expiry date</Label>
          <Input
            id="licenceExpiry"
            type="date"
            min={licenceBounds.min}
            max={licenceBounds.max}
            {...register("licenceExpiry")}
          />
          {errors.licenceExpiry && <p className="text-xs text-destructive">{errors.licenceExpiry.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yearsDriving">Years driving</Label>
          <Input
            id="yearsDriving"
            type="number"
            min={0}
            max={maxYearsDriving}
            {...register("yearsDriving", { valueAsNumber: true })}
          />
          {errors.yearsDriving && <p className="text-xs text-destructive">{errors.yearsDriving.message}</p>}
        </div>
      </div>

      <div className="space-y-3 rounded-md border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="hasViolations"
            checked={!!hasViolations}
            onCheckedChange={(v) => setValue("hasViolations", v === true, { shouldValidate: true })}
          />
          <div className="space-y-0.5">
            <Label htmlFor="hasViolations" className="cursor-pointer text-sm font-medium">
              I have prior driving violations / accidents
            </Label>
            <p className="text-xs text-muted-foreground">
              Be honest — this helps us recommend the right rental for you.
            </p>
          </div>
        </div>
        {hasViolations && (
          <div className="space-y-1.5">
            <Label htmlFor="violationsDescription">Briefly describe</Label>
            <Textarea
              id="violationsDescription"
              {...register("violationsDescription")}
              placeholder="e.g. Speeding ticket in 2023, no accidents."
              maxLength={2000}
              rows={3}
            />
            {errors.violationsDescription && (
              <p className="text-xs text-destructive">{errors.violationsDescription.message}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
