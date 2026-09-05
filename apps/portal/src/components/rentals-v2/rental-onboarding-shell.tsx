"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Three guided steps, then the real form.
 *
 * v2's flow had a fourth "Schedule" step, but its component took no props and
 * collected nothing — a placeholder. Dates, times and locations are gathered
 * properly by the rental form itself, so sending an operator through an empty
 * screen first would be a step that asks for something and keeps none of it.
 */
export const ONBOARDING_STEPS = ["Booking Mode", "Customer", "Vehicle", "Rental Details"];

/**
 * `data-tour` handle for a breadcrumb: "Rental Details" → rental-step-rental-details.
 * The first-rental walkthrough points at these (see lib/first-rental-tour.ts);
 * derived from the label so it cannot drift from what the operator reads.
 */
const stepTourId = (step: string) => `rental-step-${step.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

interface RentalOnboardingShellProps {
  /** 0-based index of the current step within ONBOARDING_STEPS. */
  currentStep: number;
  /** Short line under the title; changes per step. */
  subtitle?: string;
  /** Navigate to an earlier (already-completed) step via the breadcrumbs. */
  onStepClick?: (index: number) => void;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  children: React.ReactNode;
}

export function RentalOnboardingShell({
  currentStep,
  subtitle,
  onStepClick,
  onContinue,
  continueDisabled = false,
  continueLabel = "Continue",
  children,
}: RentalOnboardingShellProps) {
  // Bound the shell to fill exactly from its top offset down to the viewport
  // bottom, so the list scrolls internally and the footer stays pinned —
  // independent of whatever header/padding the dashboard layout adds above.
  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<string>();

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(`${Math.max(320, window.innerHeight - top - 12)}px`);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div ref={rootRef} style={{ height }} className="min-h-0 flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-5xl flex flex-1 min-h-0 flex-col">
        {/* Fixed header */}
        <div className="shrink-0">
          <h1 className="text-3xl font-semibold tracking-tight">Create Rental</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>

        {/* Swappable middle content */}
        <div className="flex-1 min-h-0 mt-5 flex flex-col">{children}</div>

        {/* Fixed footer: breadcrumbs (navigation) + Continue */}
        <div className="shrink-0 mt-5 flex items-center justify-between gap-4">
          <nav aria-label="Progress" data-tour="rental-steps" className="flex items-center gap-1.5 text-xs leading-none">
            {ONBOARDING_STEPS.map((step, i) => {
              const isCurrent = i === currentStep;
              const isDone = i < currentStep;
              return (
                <Fragment key={step}>
                  {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                  {isDone ? (
                    <button
                      type="button"
                      data-tour={stepTourId(step)}
                      onClick={() => onStepClick?.(i)}
                      className="leading-none font-medium text-foreground/80 hover:text-primary hover:underline underline-offset-2 cursor-pointer transition-colors"
                    >
                      {step}
                    </button>
                  ) : (
                    <span
                      data-tour={stepTourId(step)}
                      className={cn(
                        "leading-none",
                        isCurrent ? "font-semibold text-primary" : "text-muted-foreground/60"
                      )}
                    >
                      {step}
                    </span>
                  )}
                </Fragment>
              );
            })}
          </nav>

          <button
            type="button"
            disabled={continueDisabled}
            onClick={onContinue}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors",
              continueDisabled
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {continueLabel}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
