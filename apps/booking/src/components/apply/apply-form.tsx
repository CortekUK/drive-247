"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { applySchema, ApplyFormValues, STEP_SCHEMAS, STEP_TITLES } from "@/client-schemas/apply";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui/button";
import { ApplyProgress } from "./apply-progress";
import { Step1About } from "./step-1-about";
import { Step2Driver } from "./step-2-driver";
import { Step3Intent } from "./step-3-intent";
import { Step4Financial } from "./step-4-financial";
import { Step5History } from "./step-5-history";
import { Step6Documents } from "./step-6-documents";
import { Step7Review } from "./step-7-review";

interface FormConfig {
  hiddenSteps: string[];
  requiredOverrides: Record<string, string[]>;
  welcomeMessage: string | null;
}

const STEP_KEYS: ReadonlyArray<"about" | "driver" | "intent" | "financial" | "history" | "documents" | "review"> = [
  "about", "driver", "intent", "financial", "history", "documents", "review",
];

const STEP_FIELDS: (keyof ApplyFormValues)[][] = [
  [
    "fullName", "dateOfBirth", "email", "phone",
    "addressLine1", "addressLine2", "city", "state", "postalCode", "country",
  ],
  ["licenceNumber", "licenceState", "licenceExpiry", "yearsDriving", "hasViolations", "violationsDescription"],
  [
    "purpose", "ridesharePlatforms", "neededByDate", "rentalLengthTarget",
    "vehicleInterestType", "vehicleId", "vehicleClass", "startDate", "endDate",
  ],
  ["canPayDeposit", "depositComfortAmount", "weeklyBudget"],
  ["rentedBefore", "rentedFromUsBefore", "rideshareAccountActive", "rideshareTier"],
  ["licencePhotoUrl", "selfieUrl", "rideshareProofUrl"],
  ["termsAccepted", "marketingConsent"],
];

export function ApplyForm() {
  const router = useRouter();
  const { tenantSlug } = useTenant();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [config, setConfig] = useState<FormConfig>({ hiddenSteps: [], requiredOverrides: {}, welcomeMessage: null });

  // Pull tenant's Apply form config (Phase 4 scaffold). Hide optional steps the operator
  // disabled and show their welcome message.
  useEffect(() => {
    if (!tenantSlug) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.functions.invoke<FormConfig>("get-apply-form-config", {
        body: { tenantSlug },
      });
      if (!cancelled && data) setConfig(data);
    };
    load();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  // Filter visible step indexes (always keep `review` — it's the submit screen).
  const visibleStepIndexes = useMemo(() => {
    return STEP_KEYS
      .map((key, idx) => ({ key, idx }))
      .filter(({ key }) => key === "review" || !config.hiddenSteps.includes(key))
      .map((x) => x.idx);
  }, [config.hiddenSteps]);

  const methods = useForm<ApplyFormValues>({
    resolver: zodResolver(applySchema),
    mode: "onTouched",
    defaultValues: {
      fullName: "",
      dateOfBirth: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "US",

      licenceNumber: "",
      licenceState: "",
      licenceExpiry: "",
      yearsDriving: 0,
      hasViolations: false,
      violationsDescription: "",

      purpose: "personal",
      ridesharePlatforms: [],
      neededByDate: "",
      rentalLengthTarget: "weekly",
      vehicleInterestType: "any",
      vehicleId: undefined,
      vehicleClass: "",
      startDate: "",
      endDate: "",

      canPayDeposit: false,
      depositComfortAmount: 0,
      weeklyBudget: 0,

      rentedBefore: false,
      rentedFromUsBefore: false,
      rideshareAccountActive: false,
      rideshareTier: "",

      licencePhotoUrl: undefined,
      selfieUrl: undefined,
      rideshareProofUrl: undefined,

      termsAccepted: true as unknown as true, // resolved on submit
      marketingConsent: false,
      hpField: "",
    },
  });

  const isLastStep = step === STEP_TITLES.length - 1;
  const StepComponent = useMemo(() => {
    return [Step1About, Step2Driver, Step3Intent, Step4Financial, Step5History, Step6Documents, Step7Review][step];
  }, [step]);

  const findNextVisible = (from: number, dir: 1 | -1) => {
    let i = from + dir;
    while (i >= 0 && i < STEP_TITLES.length) {
      if (visibleStepIndexes.includes(i)) return i;
      i += dir;
    }
    return from;
  };

  const handleNext = async () => {
    const fields = STEP_FIELDS[step];
    const partial = STEP_SCHEMAS[step];
    const values = methods.getValues();
    const slice: Record<string, unknown> = {};
    for (const f of fields) slice[f] = (values as Record<string, unknown>)[f];
    const result = partial.safeParse(slice);
    if (!result.success) {
      await methods.trigger(fields as Parameters<typeof methods.trigger>[0]);
      toast.error("Please fix the highlighted fields before continuing.");
      return;
    }

    // Phase 4 scaffold: enforce tenant-configured "extra required" fields.
    // The base schema marks them optional, but the operator can mark them required
    // via /settings/apply-form. We check them here on top of the Zod validation.
    const stepKey = STEP_KEYS[step];
    const extraRequired = config.requiredOverrides?.[stepKey] ?? [];
    const missing: string[] = [];
    for (const field of extraRequired) {
      const v = (values as Record<string, unknown>)[field];
      const isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (isEmpty) missing.push(field);
    }
    if (missing.length > 0) {
      // Trigger RHF errors for the missing fields so they highlight
      await methods.trigger(missing as Parameters<typeof methods.trigger>[0]);
      missing.forEach((f) => {
        methods.setError(f as Parameters<typeof methods.setError>[0], {
          type: "required-override",
          message: "This field is required",
        });
      });
      toast.error(`Required: ${missing.join(", ")}`);
      return;
    }

    setStep((s) => findNextVisible(s, 1));
  };

  const handleBack = () => setStep((s) => findNextVisible(s, -1));

  const handleSubmit = methods.handleSubmit(async (values) => {
    if (!tenantSlug) {
      toast.error("We couldn't identify the rental operator. Please refresh and try again.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-application", {
        body: { ...values, tenantSlug },
      });
      if (error) throw error;
      const status = (data as { status?: string } | null)?.status ?? "received";
      router.push(`/apply/submitted?status=${encodeURIComponent(status)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:py-14">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Apply for a rental</h1>
          <p className="text-sm text-muted-foreground">
            {config.welcomeMessage ?? "Tell us a bit about yourself. We'll review your application and get back to you shortly."}
          </p>
        </header>

        <ApplyProgress
          currentStep={step}
          onStepClick={(s) => s <= step && setStep(s)}
        />

        <div className="rounded-lg border bg-card p-5 shadow-sm sm:p-7">
          <StepComponent />
          {/* Honeypot */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
            {...methods.register("hpField")}
          />
        </div>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={step === 0 || submitting}
          >
            Back
          </Button>
          {isLastStep ? (
            <Button type="submit" disabled={submitting}>
              {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>) : "Submit application"}
            </Button>
          ) : (
            <Button type="button" onClick={handleNext} disabled={submitting}>
              Next
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
