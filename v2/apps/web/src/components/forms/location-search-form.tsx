"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

type LocationSearchFormProps = {
  className?: string;
};

export function LocationSearchForm({ className }: LocationSearchFormProps) {
  const router = useRouter();
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (pickup) params.set("pickup", pickup);
    if (dropoff) params.set("dropoff", dropoff);
    router.push(`/booking${params.size ? `?${params.toString()}` : ""}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={cn("flex w-full max-w-[360px] flex-col gap-4", className)}
    >
      <Field
        id="pickup"
        label="Pick-up Location"
        value={pickup}
        onChange={setPickup}
        dotColor="#181a17"
        trailing={<MapPin className="size-4 text-brand-ring-dark" strokeWidth={1.5} />}
      />
      <Field
        id="dropoff"
        label="Drop-off Location"
        value={dropoff}
        onChange={setDropoff}
        dotColor="#df232a"
      />
      <div className="pt-4">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-full bg-brand-forest px-7 py-[11.5px] text-[13.5px] leading-[20.25px] text-white shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
        >
          Rent a Car
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  trailing?: React.ReactNode;
  dotColor: string;
};

function Field({ id, label, value, onChange, trailing, dotColor }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] leading-[16.5px] text-brand-text-soft"
      >
        {label}
      </label>
      <div className="relative flex items-center rounded-[8px] border border-white bg-white px-[17px] py-[13px] shadow-[0px_2px_4px_rgba(0,0,0,0.04)]">
        <span
          aria-hidden
          className="size-[11px] shrink-0 rounded-full border-2"
          style={{ borderColor: dotColor }}
        />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter Address"
          className="flex-1 bg-transparent pl-3 text-[13.5px] text-brand-text placeholder:text-brand-placeholder focus:outline-none"
        />
        {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
      </div>
    </div>
  );
}
