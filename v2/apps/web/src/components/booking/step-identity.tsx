"use client";

import { ArrowRight, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { useBookingStore } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";

export function StepIdentity() {
  const store = useBookingStore();
  const { fullName, email, phone, licenseFileName } = store;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      store.set("licenseFileName", file.name);
    }
  }

  function handleProceed() {
    const next: Record<string, string> = {};
    if (!fullName) next.fullName = "Required";
    if (!email) next.email = "Required";
    else if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Invalid email";
    if (!phone) next.phone = "Required";
    if (!licenseFileName) next.license = "Driver license required";
    setErrors(next);
    if (Object.keys(next).length === 0) store.next();
  }

  return (
    <article className="w-full max-w-[480px] rounded-[16px] bg-white p-6 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.12)] ring-1 ring-brand-border-soft sm:p-8">
      <h1 className="text-[22px] font-semibold leading-tight text-brand-text">
        Tell us About Yourself
      </h1>

      <div className="mt-6 space-y-5">
        <Field
          id="fullName"
          label="Full Name"
          placeholder="Enter Full Name"
          value={fullName}
          onChange={(v) => store.set("fullName", v)}
          error={errors.fullName}
        />
        <Field
          id="email"
          label="Email Address"
          type="email"
          placeholder="Enter Email Address"
          value={email}
          onChange={(v) => store.set("email", v)}
          error={errors.email}
        />
        <Field
          id="phone"
          label="Phone Number"
          type="tel"
          placeholder="Enter Phone Number"
          value={phone}
          onChange={(v) => store.set("phone", v)}
          error={errors.phone}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-[12.5px] leading-tight text-brand-text">
            Driver License
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "inline-flex w-fit items-center gap-2 rounded-[8px] border bg-brand-cream px-4 py-2 text-[13px] text-brand-text transition-colors",
              errors.license ? "border-danger" : "border-brand-border-soft",
            )}
          >
            <Upload className="size-3.5" strokeWidth={1.75} />
            {licenseFileName || "Upload"}
          </button>
          {errors.license && (
            <p className="text-xs text-danger">{errors.license}</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleProceed}
        className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-forest text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Proceed to Book
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </article>
  );
}

type FieldProps = {
  id: string;
  label: string;
  placeholder?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
};

function Field({
  id,
  label,
  placeholder,
  type = "text",
  value,
  onChange,
  error,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] leading-tight text-brand-text">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-10 w-full rounded-[8px] border bg-white px-3.5 text-[13px] text-brand-text placeholder:text-brand-placeholder focus:border-brand-forest focus:outline-none",
          error ? "border-danger" : "border-brand-border",
        )}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
