"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { captureLeadAction, type LeadCaptureState } from "@/actions/lead-capture";

export function LeadCaptureForm() {
  const [state, formAction, isPending] = useActionState<LeadCaptureState, FormData>(
    captureLeadAction,
    null
  );

  if (state?.success) {
    return (
      <p className="text-sm font-medium text-green-600">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <Input
        type="email"
        name="email"
        placeholder="you@company.com"
        required
        className="flex-1"
        disabled={isPending}
      />
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Sending..." : "Get updates"}
      </Button>
      {state && !state.success && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}
    </form>
  );
}
