"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2 } from "lucide-react";
import {
  captureConsultationAction,
  type LeadCaptureState,
} from "@/actions/lead-capture";

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
          htmlFor="business"
          className="mb-1.5 block text-sm font-medium"
        >
          Business Name
          <span className="text-indigo-600 dark:text-indigo-400">*</span>
        </label>
        <Input
          id="business"
          name="business"
          type="text"
          placeholder="Your business name"
          required
          disabled={isPending}
          className="h-10"
        />
      </div>

      <div>
        <label
          htmlFor="message"
          className="mb-1.5 block text-sm font-medium"
        >
          Message
        </label>
        <textarea
          id="message"
          name="message"
          placeholder="Tell us about your fleet and what you'd like to discuss..."
          rows={3}
          disabled={isPending}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {state && !state.success && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="h-11 w-full bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {isPending ? "Sending..." : "Request a strategy review"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        We&apos;ll review your fleet and outline your direct channel strategy within 24 hours.
      </p>
    </form>
  );
}
