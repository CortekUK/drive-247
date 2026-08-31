"use client";

import { ArrowRight, Calendar as CalendarIcon, MapPin } from "lucide-react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AGE_RANGES, TIME_SLOTS } from "@/lib/fixtures/booking";
import { useBookingStore } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";

function formatDate(date: Date | null) {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StepLogistics() {
  const store = useBookingStore();
  const {
    pickupLocation,
    dropoffLocation,
    pickupDate,
    pickupTime,
    dropoffDate,
    dropoffTime,
    driverAge,
  } = store;

  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleProceed() {
    const next: Record<string, string> = {};
    if (!pickupLocation) next.pickupLocation = "Required";
    if (!dropoffLocation) next.dropoffLocation = "Required";
    if (!pickupDate) next.pickupDate = "Required";
    if (!pickupTime) next.pickupTime = "Required";
    if (!dropoffDate) next.dropoffDate = "Required";
    if (!dropoffTime) next.dropoffTime = "Required";
    if (!driverAge) next.driverAge = "Required";
    setErrors(next);
    if (Object.keys(next).length === 0) store.next();
  }

  return (
    <article className="w-full max-w-[480px] rounded-[16px] bg-white p-6 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.12)] ring-1 ring-brand-border-soft sm:p-8">
      <h1 className="text-[22px] font-semibold leading-tight text-brand-text">
        Trip Logistics
      </h1>

      <div className="mt-6 space-y-5">
        <FormDot
          id="pickupLocation"
          label="Pick-up Location"
          dotColor="#181a17"
          trailing={<MapPin className="size-4 text-brand-ring-dark" strokeWidth={1.5} />}
          value={pickupLocation}
          onChange={(v) => store.set("pickupLocation", v)}
          error={errors.pickupLocation}
        />
        <FormDot
          id="dropoffLocation"
          label="Drop-off Location"
          dotColor="#df232a"
          value={dropoffLocation}
          onChange={(v) => store.set("dropoffLocation", v)}
          error={errors.dropoffLocation}
        />

        <div className="grid grid-cols-2 gap-4">
          <DateField
            id="pickupDate"
            label="Pick-up Date"
            value={pickupDate}
            onChange={(d) => store.set("pickupDate", d)}
            error={errors.pickupDate}
          />
          <TimeField
            id="pickupTime"
            label="Pick-up Time"
            value={pickupTime}
            onChange={(v) => store.set("pickupTime", v)}
            error={errors.pickupTime}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DateField
            id="dropoffDate"
            label="Drop-off Date"
            value={dropoffDate}
            onChange={(d) => store.set("dropoffDate", d)}
            error={errors.dropoffDate}
          />
          <TimeField
            id="dropoffTime"
            label="Drop-off Time"
            value={dropoffTime}
            onChange={(v) => store.set("dropoffTime", v)}
            error={errors.dropoffTime}
          />
        </div>
      </div>

      <hr className="my-7 border-brand-border-soft" />

      <h2 className="text-[18px] font-semibold leading-tight text-brand-text">
        Driver Eligibility
      </h2>

      <div className="mt-4 flex flex-col gap-1.5">
        <label
          htmlFor="driverAge"
          className="text-[12.5px] leading-tight text-brand-text"
        >
          Your Age
        </label>
        <Select
          value={driverAge || undefined}
          onValueChange={(v) => store.set("driverAge", v)}
        >
          <SelectTrigger
            id="driverAge"
            className="h-10 w-full rounded-[8px] border border-brand-border bg-white px-3.5 text-[13px] text-brand-text"
          >
            <SelectValue placeholder="Select Age" />
          </SelectTrigger>
          <SelectContent>
            {AGE_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.driverAge && (
          <p className="text-xs text-danger">{errors.driverAge}</p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-brand-text-soft">
        Providing your age helps us give you 100% accurate pricing and verified
        car options right from the start.
      </p>

      <button
        type="button"
        onClick={handleProceed}
        className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-forest text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Proceed to Fleet
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </article>
  );
}

type FormDotProps = {
  id: string;
  label: string;
  dotColor: string;
  trailing?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
};

function FormDot({
  id,
  label,
  dotColor,
  trailing,
  value,
  onChange,
  error,
}: FormDotProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] leading-[16.5px] text-brand-text-soft"
      >
        {label}
      </label>
      <div
        className={cn(
          "relative flex items-center rounded-[8px] border bg-white px-[15px] py-[11px] shadow-[0px_2px_4px_rgba(0,0,0,0.04)]",
          error ? "border-danger" : "border-brand-border",
        )}
      >
        <span
          aria-hidden
          className="size-[11px] shrink-0 rounded-full border-2"
          style={{ borderColor: dotColor }}
        />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter Address"
          className="flex-1 bg-transparent pl-3 text-[13px] text-brand-text placeholder:text-brand-placeholder focus:outline-none"
        />
        {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type DateFieldProps = {
  id: string;
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  error?: string;
};

function DateField({ id, label, value, onChange, error }: DateFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] leading-[16.5px] text-brand-text-soft"
      >
        {label}
      </label>
      <Popover>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              "flex h-10 items-center justify-between rounded-[8px] border bg-white px-3.5 text-[13px] text-brand-text transition-colors",
              error ? "border-danger" : "border-brand-border",
            )}
          >
            <span className={value ? "text-brand-text" : "text-brand-placeholder"}>
              {value ? formatDate(value) : "Select Date"}
            </span>
            <CalendarIcon className="size-4 text-brand-text-subtle" strokeWidth={1.75} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value ?? undefined}
            onSelect={(d) => onChange(d ?? null)}
            disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

type TimeFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
};

function TimeField({ id, label, value, onChange, error }: TimeFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] leading-[16.5px] text-brand-text-soft"
      >
        {label}
      </label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className={cn(
            "h-10 w-full rounded-[8px] border bg-white px-3.5 text-[13px] text-brand-text",
            error ? "border-danger" : "border-brand-border",
          )}
        >
          <SelectValue placeholder="Select Time" />
        </SelectTrigger>
        <SelectContent>
          {TIME_SLOTS.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
