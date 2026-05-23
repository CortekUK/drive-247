"use client";

import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useFleetList, type FleetVehicle } from "@/hooks/use-fleet-list";
import type { ApplyFormValues } from "@/client-schemas/apply";

const PURPOSES = [
  { value: "uber", label: "Uber" },
  { value: "lyft", label: "Lyft" },
  { value: "doordash", label: "DoorDash" },
  { value: "instacart", label: "Instacart" },
  { value: "personal", label: "Personal use" },
  { value: "delivery", label: "Other delivery work" },
  { value: "other", label: "Other" },
];

const RIDESHARE_PLATFORMS = ["Uber", "Lyft", "DoorDash", "Instacart", "Grubhub", "Amazon Flex"];

export function Step3Intent() {
  const { register, watch, setValue, formState: { errors } } = useFormContext<ApplyFormValues>();
  const purpose = watch("purpose");
  const vehicleInterestType = watch("vehicleInterestType");
  const ridesharePlatforms = watch("ridesharePlatforms") || [];
  const { data: fleet } = useFleetList();

  const togglePlatform = (p: string) => {
    const next = ridesharePlatforms.includes(p)
      ? ridesharePlatforms.filter((x) => x !== p)
      : [...ridesharePlatforms, p];
    setValue("ridesharePlatforms", next, { shouldValidate: true });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Primary purpose</Label>
        <Select value={purpose} onValueChange={(v) => setValue("purpose", v as ApplyFormValues["purpose"], { shouldValidate: true })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {PURPOSES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {errors.purpose && <p className="text-xs text-destructive">{errors.purpose.message}</p>}
      </div>

      {["uber", "lyft", "doordash", "instacart", "delivery"].includes(purpose) && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <Label className="text-sm">Which platforms do you drive for?</Label>
          <div className="flex flex-wrap gap-2 pt-1">
            {RIDESHARE_PLATFORMS.map((p) => {
              const active = ridesharePlatforms.includes(p);
              return (
                <button
                  type="button"
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={[
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-accent",
                  ].join(" ")}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="neededByDate">Needed by</Label>
          <Input id="neededByDate" type="date" {...register("neededByDate")} />
          {errors.neededByDate && <p className="text-xs text-destructive">{errors.neededByDate.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>Rental length target</Label>
          <Select
            value={watch("rentalLengthTarget")}
            onValueChange={(v) => setValue("rentalLengthTarget", v as ApplyFormValues["rentalLengthTarget"], { shouldValidate: true })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily (under a week)</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Vehicle interest</Label>
        <Select
          value={vehicleInterestType}
          onValueChange={(v) => setValue("vehicleInterestType", v as ApplyFormValues["vehicleInterestType"], { shouldValidate: true })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="specific">A specific vehicle</SelectItem>
            <SelectItem value="class">A vehicle class</SelectItem>
            <SelectItem value="any">Open to any available</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {vehicleInterestType === "specific" && (
        <div className="space-y-1.5">
          <Label>Which vehicle?</Label>
          <Select
            value={watch("vehicleId") ?? undefined}
            onValueChange={(v) => setValue("vehicleId", v, { shouldValidate: true })}
          >
            <SelectTrigger><SelectValue placeholder="Pick a vehicle" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(fleet ?? []).map((v: FleetVehicle) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.make ?? ""} {v.model ?? ""}{v.reg ? ` · ${v.reg}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {vehicleInterestType === "class" && (
        <div className="space-y-1.5">
          <Label htmlFor="vehicleClass">Vehicle class</Label>
          <Input id="vehicleClass" placeholder="e.g. sedan, SUV, compact" {...register("vehicleClass")} />
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Pickup date</Label>
          <Input id="startDate" type="date" {...register("startDate")} />
          {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">Return date</Label>
          <Input id="endDate" type="date" {...register("endDate")} />
          {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
        </div>
      </div>
    </div>
  );
}
