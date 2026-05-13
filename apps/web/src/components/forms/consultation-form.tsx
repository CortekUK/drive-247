"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2 } from "lucide-react";
import {
  captureConsultationAction,
  type LeadCaptureState,
} from "@/actions/lead-capture";

const FLEET_SIZE_OPTIONS = [
  "1–4 vehicles",
  "5–10 vehicles",
  "11–25 vehicles",
  "25+ vehicles",
];

const PLATFORM_OPTIONS = [
  "Turo",
  "Website",
  "Instagram / Facebook",
  "Google",
  "Manual / WhatsApp",
  "Other",
];

const BOOKING_SOURCE_OPTIONS = [
  "Turo",
  "Instagram / Facebook",
  "Website",
  "Referrals",
  "Google",
  "Other",
];

const BUDGET_OPTIONS = [
  "Under $500",
  "$500\u2013$1,500",
  "$1,500\u2013$3,000",
  "$3,000+",
  "Not sure yet",
];

const READINESS_OPTIONS = [
  "Ready to launch this week",
  "Ready if the system is a good fit",
  "Comparing options",
  "Just researching",
];

const selectClasses =
  "border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function ConsultationForm() {
  const [state, formAction, isPending] = useActionState<
    LeadCaptureState,
    FormData
  >(captureConsultationAction, null);

  if (state?.success) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600/[0.08] dark:bg-indigo-400/[0.1]">
          <CheckCircle2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <p className="text-lg font-semibold">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3.5">
      <div>
        <label
          htmlFor="name"
          className="mb-1.5 block text-sm font-medium"
        >
          Name<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="John Smith"
          required
          disabled={isPending}
          className="h-10"
        />
      </div>

      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium"
        >
          Email<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="john@example.com"
          required
          disabled={isPending}
          className="h-10"
        />
      </div>

      <div>
        <label
          htmlFor="phone"
          className="mb-1.5 block text-sm font-medium"
        >
          Phone
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          placeholder="(555) 123-4567"
          disabled={isPending}
          className="h-10"
        />
      </div>

      <div>
        <label
          htmlFor="fleet_size"
          className="mb-1.5 block text-sm font-medium"
        >
          Fleet size<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <select
          id="fleet_size"
          name="fleet_size"
          required
          disabled={isPending}
          className={selectClasses}
          defaultValue=""
        >
          <option value="" disabled>
            Select fleet size
          </option>
          {FLEET_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="current_platform"
          className="mb-1.5 block text-sm font-medium"
        >
          Current platform<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <select
          id="current_platform"
          name="current_platform"
          required
          disabled={isPending}
          className={selectClasses}
          defaultValue=""
        >
          <option value="" disabled>
            Where do you take bookings today?
          </option>
          {PLATFORM_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="challenge"
          className="mb-1.5 block text-sm font-medium"
        >
          Main booking source<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <select
          id="challenge"
          name="challenge"
          required
          disabled={isPending}
          className={selectClasses}
          defaultValue=""
        >
          <option value="" disabled>
            Where do most bookings come from?
          </option>
          {BOOKING_SOURCE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="budget"
          className="mb-1.5 block text-sm font-medium"
        >
          Launch budget<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <select
          id="budget"
          name="budget"
          required
          disabled={isPending}
          className={selectClasses}
          defaultValue=""
        >
          <option value="" disabled>
            Select launch budget
          </option>
          {BUDGET_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="readiness"
          className="mb-1.5 block text-sm font-medium"
        >
          Launch readiness<span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <select
          id="readiness"
          name="readiness"
          required
          disabled={isPending}
          className={selectClasses}
          defaultValue=""
        >
          <option value="" disabled>
            How ready are you to launch?
          </option>
          {READINESS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {state && !state.success && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="h-11 w-full bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {isPending ? "Sending..." : "Get your 7-day launch plan"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        We&apos;ll review your fleet and outline your direct channel strategy within 24 hours.
      </p>
    </form>
  );
}
