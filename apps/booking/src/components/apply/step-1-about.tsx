"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isoMaxDateOfBirth,
  isoMinDateOfBirth,
  MIN_APPLICANT_AGE,
  type ApplyFormValues,
} from "@/client-schemas/apply";

export function Step1About() {
  const { register, formState: { errors } } = useFormContext<ApplyFormValues>();
  // Cache once per mount — date bounds don't need to update mid-session.
  const dobBounds = useMemo(() => ({ min: isoMinDateOfBirth(), max: isoMaxDateOfBirth() }), []);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" {...register("fullName")} placeholder="Marcus Johnson" autoComplete="name" />
        {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input
            id="dateOfBirth"
            type="date"
            min={dobBounds.min}
            max={dobBounds.max}
            {...register("dateOfBirth")}
          />
          <p className="text-xs text-muted-foreground">Must be at least {MIN_APPLICANT_AGE} years old.</p>
          {errors.dateOfBirth && <p className="text-xs text-destructive">{errors.dateOfBirth.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Mobile phone</Label>
          <Input id="phone" type="tel" inputMode="tel" {...register("phone")} autoComplete="tel" placeholder="+1 555 123 4567" />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} autoComplete="email" placeholder="you@example.com" />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="addressLine1">Address line 1</Label>
        <Input id="addressLine1" {...register("addressLine1")} autoComplete="address-line1" />
        {errors.addressLine1 && <p className="text-xs text-destructive">{errors.addressLine1.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="addressLine2">Address line 2 (optional)</Label>
        <Input id="addressLine2" {...register("addressLine2")} autoComplete="address-line2" />
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" {...register("city")} autoComplete="address-level2" />
          {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state">State / Region</Label>
          <Input id="state" {...register("state")} autoComplete="address-level1" />
          {errors.state && <p className="text-xs text-destructive">{errors.state.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Postal code</Label>
          <Input id="postalCode" {...register("postalCode")} autoComplete="postal-code" />
          {errors.postalCode && <p className="text-xs text-destructive">{errors.postalCode.message}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="country">Country (ISO 2-letter)</Label>
        <Input id="country" maxLength={2} {...register("country")} autoComplete="country" />
        {errors.country && <p className="text-xs text-destructive">{errors.country.message}</p>}
      </div>
    </div>
  );
}
