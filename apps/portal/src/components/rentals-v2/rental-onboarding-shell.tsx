"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollportFill } from "@/lib/scrollport";

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
      // Measured against the SCROLLPORT — `<main>` under v2's fixed frame, the
      // window under v1 (lib/scrollport.ts). `top` is taken from the
      // scrollport's content origin, so a re-measure that fires while the page
      // is scrolled (the observer below can fire at any scroll position) sizes
      // the shell exactly as one at scroll 0 would; `window.scrollY` used to do
      // that job and is always 0 once the window stops being the scroller.
      const { top, height } = scrollportFill(el);
      // 16 = <main>'s bottom padding (p-4), which is inside `height`. With 12
      // the page ended 4px below the viewport, so it scrolled by 4px at every
      // width, banner or not.
      setHeight(`${Math.max(320, height - top - 16)}px`);
    };
    update();
    window.addEventListener("resize", update);
    // Re-measure when something above the shell mounts or unmounts, not only on
    // resize. A maintenance/deposit banner lands after mount (its query refetches
    // every 60s) and at md+ also switches off the layout's switch-row pull-up, so
    // <main> drops 70px (40px banner + 30px), not 40. With only the resize
    // listener the shell kept its old height: 74px of page scroll with Continue
    // 58px below the fold at 1440x900 (HEAD 44 / 28). An unchanged height
    // string is a no-op, so the observer settles after one pass instead of
    // looping.
    // <main> as well as <body>: with the shell ending exactly at the viewport
    // bottom the page no longer overflows, so <body> rests at the layout's
    // min-h-svh and does not change size when a banner above unmounts. <main>
    // is flex-1 and grows into the freed space, so it still reports, and the
    // shell grows back instead of leaving a 70px gap under Continue.
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    const main = el.closest("main");
    if (main) ro.observe(main);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  return (
    /* Switch row alignment: at md+ the h1 (text-3xl, a 36px line box) is
       centred on the sidebar's Portal / Website switch. main's content box
       starts at 50px there, so 50 + 24 + 18 = 92; it sat at 50, under the 64px
       top bar. The padding is inside the measured height (border-box), and the
       height still comes from the live top: innerHeight - top - 16, so the
       shell plus main's 16px bottom padding ends exactly at the viewport bottom. */
    <div ref={rootRef} style={{ height }} className="min-h-0 flex flex-col overflow-hidden md:pt-6">
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
