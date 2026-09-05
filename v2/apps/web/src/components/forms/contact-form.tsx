"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const VEHICLE_OPTIONS = [
  { value: "lexus-rx", label: "Lexus RX" },
  { value: "porsche-911", label: "Porsche 911 Carrera" },
  { value: "aston-vanquish", label: "Aston Martin Vanquish" },
  { value: "rolls-phantom", label: "Rolls-Royce Phantom" },
  { value: "bmw-m4", label: "BMW M4" },
  { value: "audi-a4", label: "Audi A4" },
  { value: "other", label: "Other / Not sure" },
] as const;

const contactSchema = z.object({
  fullName: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
  phone: z.string().min(5, "Required"),
  vehicleOfInterest: z.string().min(1, "Required"),
  details: z.string().optional(),
});

type ContactValues = z.infer<typeof contactSchema>;

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      vehicleOfInterest: "",
      details: "",
    },
  });

  async function onSubmit(values: ContactValues) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    console.log("contact submission", values);
    setSubmitted(true);
  }

  const inputProps = (name: keyof ContactValues) => {
    const { ref, ...rest } = register(name);
    return { inputRef: ref, ...rest };
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full flex-col gap-3.5 rounded-[14px] bg-white p-5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.18)] ring-1 ring-brand-border-soft sm:p-6"
      noValidate
    >
      <Field
        id="fullName"
        label="Full Name"
        placeholder="Enter Name"
        error={errors.fullName?.message}
        {...inputProps("fullName")}
      />
      <Field
        id="email"
        label="Email"
        type="email"
        placeholder="Enter Email"
        error={errors.email?.message}
        {...inputProps("email")}
      />
      <Field
        id="phone"
        label="Phone Number"
        type="tel"
        placeholder="Enter Phone Number"
        error={errors.phone?.message}
        {...inputProps("phone")}
      />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="vehicleOfInterest"
          className="text-[12.5px] leading-tight text-brand-text"
        >
          Vehicle of Interest
        </label>
        <Select
          value={watch("vehicleOfInterest") || undefined}
          onValueChange={(value) =>
            setValue("vehicleOfInterest", value, { shouldValidate: true })
          }
        >
          <SelectTrigger
            id="vehicleOfInterest"
            className="h-10 w-full rounded-[8px] border border-brand-border bg-white px-3.5 text-[13px] text-brand-text"
          >
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {VEHICLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.vehicleOfInterest?.message && (
          <p className="text-xs text-danger">
            {errors.vehicleOfInterest.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="details"
          className="text-[12.5px] leading-tight text-brand-text"
        >
          Additional Details
        </label>
        <Textarea
          id="details"
          placeholder="Type your message here"
          rows={3}
          className="rounded-[8px] border-brand-border bg-white text-[13px] text-brand-text placeholder:text-brand-placeholder"
          {...register("details")}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 inline-flex h-11 items-center justify-center rounded-full bg-brand-forest px-6 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {isSubmitting ? "Sending…" : "Rent a Car"}
      </button>

      {submitted && (
        <p className="text-center text-xs text-success">
          Message sent. We’ll be in touch shortly.
        </p>
      )}
    </form>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "ref"> & {
  id: string;
  label: string;
  error?: string;
  inputRef?: React.Ref<HTMLInputElement>;
};

function Field(props: FieldProps) {
  const { id, label, error, className, inputRef, ...rest } = props;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[12.5px] leading-tight text-brand-text"
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className={
          "h-10 w-full rounded-[8px] border border-brand-border bg-white px-3.5 text-[13px] text-brand-text placeholder:text-brand-placeholder focus:border-brand-forest focus:outline-none " +
          (className ?? "")
        }
        {...rest}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
