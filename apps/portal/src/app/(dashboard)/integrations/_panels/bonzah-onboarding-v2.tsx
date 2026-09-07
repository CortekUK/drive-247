"use client";

// ── Bonzah application, inside the Integrations dialog ────────────────────────
//
// WHY THIS FILE EXISTS AT ALL.
//
// The Bonzah application wizard is v1's — `components/settings/bonzah-onboarding/`
// — and 56 other tenants reach it through `/settings?tab=insurance`. V2_PLAN §3
// says never edit an old screen in place, so not one byte of that directory is
// touched here. The first choice was to mount `<BonzahOnboardingForm />` inside
// the dialog unchanged. It does not compose, for four reasons that are all
// layout assumptions baked into v1's own files:
//
//   1. `step-nav.tsx`'s desktop stepper is `hidden lg:flex` over TEN steps, each
//      carrying `style={{ minWidth: '88px' }}` — an 880px floor. `lg:` is a
//      VIEWPORT breakpoint, so on any desktop screen it renders that 880px rail
//      into a dialog whose content box is ~600px. It does not wrap; it overflows.
//   2. The wizard's root is a `<Card>` with its own `CardHeader`/`CardTitle`
//      ("Bonzah Onboarding" + a ShieldCheck) — a second title and a second card
//      edge inside a dialog that already has `DialogTitle` and a card edge.
//   3. Its footer is `sticky bottom-0 … border-t px-6 py-4`, written against the
//      settings page's scroll container. Nested inside `DialogContent`'s own
//      `overflow-y-auto` with `p-8`, its `px-6` fights the dialog's padding and
//      the bar sticks to the wrong box.
//   4. Every step change calls `containerRef.current.scrollIntoView(...)`, and
//      `scrollIntoView` walks EVERY scrollable ancestor — including the document
//      — so advancing a step scrolls the page behind the modal.
//
// So this is a v2 SHELL, not a v2 copy. What it re-implements is chrome only:
// the header, the progress meter, the scroll box and the footer. Everything with
// business meaning is imported from v1 and runs unmodified —
//
//   • `schema.ts`           — the Zod schema, DEFAULT_VALUES, STEPS, stepFields.
//                             Validation is imported, never duplicated.
//   • `steps/*`             — all ten step bodies, which are pure
//                             `useFormContext()` consumers with no page
//                             assumptions beyond `md:grid-cols-2`.
//   • `use-bonzah-onboarding` — draft read/write, the submission insert, and the
//                             two fire-and-forget notifications that tell the
//                             Bonzah reviewer an application landed.
//
// That keeps one source of truth for what an application IS, and confines the v2
// work to how it looks. When Settings' insurance tab is retired for everyone,
// this file loses nothing.
//
// ⚠️ ISOLATION. RLS is off (V2_PLAN §5). `useBonzahOnboarding` scopes every read
// and write to `tenant.id` from TenantContext; the only query issued directly
// here is the storage `move` below, whose paths are prefixed with the tenant id
// this component was handed. Nothing here reads a row it did not key by tenant.

import { useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";

// ── v1, imported and not copied ──────────────────────────────────────────────
import {
  bonzahOnboardingSchema,
  DEFAULT_VALUES,
  STEPS,
  TOTAL_STEPS,
  stepFields,
  type BonzahOnboardingFormData,
  type FileUrls,
} from "@/components/settings/bonzah-onboarding/schema";
import { Step1Business } from "@/components/settings/bonzah-onboarding/steps/step-1-business";
import { Step2Operations } from "@/components/settings/bonzah-onboarding/steps/step-2-operations";
import { Step3Contacts } from "@/components/settings/bonzah-onboarding/steps/step-3-contacts";
import { Step4Banking } from "@/components/settings/bonzah-onboarding/steps/step-4-banking";
import { Step5Insurance } from "@/components/settings/bonzah-onboarding/steps/step-5-insurance";
import { Step6Policies } from "@/components/settings/bonzah-onboarding/steps/step-6-policies";
import { Step7Underwriting } from "@/components/settings/bonzah-onboarding/steps/step-7-underwriting";
import { Step8Training } from "@/components/settings/bonzah-onboarding/steps/step-8-training";
import { Step9Quiz } from "@/components/settings/bonzah-onboarding/steps/step-9-quiz";
import { Step8Review } from "@/components/settings/bonzah-onboarding/steps/step-8-review";
import { useBonzahOnboarding } from "@/hooks/use-bonzah-onboarding";
import type { QuizGradeResult } from "@/hooks/use-bonzah-quiz";

/* ─────────────────────────────── shape ──────────────────────────────────── */

/**
 * The same localStorage key v1 writes.
 *
 * Deliberate: an operator who started the application on the Settings screen
 * before this board existed, or on another tab, finds their draft here rather
 * than an empty form. The DB draft (`bonzah_onboarding_drafts`, one row per
 * tenant) is the cross-device copy and wins; localStorage is the instant one.
 */
const DRAFT_KEY = (tenantId: string) => `bonzah_onboarding_draft_${tenantId}`;

/** Steps that are gated on something other than field validity. */
const TRAINING_STEP = 8;
const QUIZ_STEP = 9;

type Props = {
  /** The tenant this application belongs to. Used for storage paths. */
  tenantId: string;
  /** Leave the wizard and return to the panel's stage view. */
  onExit: () => void;
  /** Called after a submission row lands, so the panel can re-read its stage. */
  onSubmitted: () => void | Promise<void>;
};

/* ──────────────────────────────── shell ─────────────────────────────────── */

export default function BonzahOnboardingV2({ tenantId, onExit, onSubmitted }: Props) {
  const { fetchDraft, saveDraft, deleteDraft, submit } = useBonzahOnboarding();

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [fileUrls, setFileUrls] = useState<FileUrls>({});
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [trainingAcknowledged, setTrainingAcknowledged] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizGradeResult | null>(null);

  /**
   * The wizard owns its own scroll box rather than letting the dialog scroll.
   *
   * That is what makes the header and footer stay put without any of v1's
   * `sticky` maths, and it is why advancing a step can scroll THIS element
   * back to the top instead of `scrollIntoView`, which would have scrolled the
   * page behind the modal as well.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const form = useForm<BonzahOnboardingFormData>({
    resolver: zodResolver(bonzahOnboardingSchema),
    defaultValues: DEFAULT_VALUES as BonzahOnboardingFormData,
    mode: "onTouched",
  });

  const draftKey = DRAFT_KEY(tenantId);
  // Gate saving until the initial load resolves, so the empty default form does
  // not overwrite a stored draft before it has been hydrated. (v1's rule; the
  // bug it prevents is silent and total.)
  const draftLoadedRef = useRef(false);

  const applyDraft = (parsed: {
    values?: BonzahOnboardingFormData;
    step?: number;
    completed?: number[];
    fileUrls?: FileUrls;
  }) => {
    if (parsed?.values) form.reset(parsed.values);
    if (typeof parsed?.step === "number") setCurrentStep(parsed.step);
    if (parsed?.completed) setCompletedSteps(new Set(parsed.completed));
    if (parsed?.fileUrls) setFileUrls(parsed.fileUrls);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hydrated = false;
      try {
        const dbDraft = await fetchDraft();
        if (!cancelled && dbDraft) {
          applyDraft(dbDraft);
          hydrated = true;
        }
      } catch {
        // fall through to localStorage
      }
      if (!cancelled && !hydrated) {
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) applyDraft(JSON.parse(raw));
        } catch {
          // ignore corrupt drafts
        }
      }
      if (!cancelled) draftLoadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const watched = form.watch();
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const snapshot = {
      values: watched,
      step: currentStep,
      completed: Array.from(completedSteps),
      fileUrls,
    };
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(snapshot));
      } catch {
        // ignore quota errors
      }
      void saveDraft(snapshot as never).catch(() => {
        // best-effort; localStorage still holds the draft
      });
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, currentStep, completedSteps, fileUrls, draftKey]);

  const stepInfo = useMemo(() => STEPS.find((s) => s.id === currentStep), [currentStep]);
  const furthest = useMemo(
    () => Math.max(currentStep, ...(completedSteps.size ? Array.from(completedSteps) : [1])),
    [currentStep, completedSteps],
  );

  const goToStep = (step: number) => {
    setCurrentStep(step);
    // Scroll only this box. `scrollIntoView` would have taken the page with it.
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNext = async () => {
    if (currentStep === TRAINING_STEP && !trainingAcknowledged) {
      toast({
        title: "Please confirm the training",
        description: "Tick the box to confirm you have watched the training.",
        variant: "destructive",
      });
      return;
    }
    if (currentStep === QUIZ_STEP && !quizResult?.passed) {
      toast({
        title: "Pass the quiz to continue",
        description: 'Answer the questions and click "Check answers" to pass.',
        variant: "destructive",
      });
      return;
    }

    const fieldsForStep = stepFields[currentStep] ?? [];
    const valid = await form.trigger(fieldsForStep as never);
    if (!valid) {
      toast({
        title: "Please fix the highlighted fields",
        description: "Some required information is missing or invalid.",
        variant: "destructive",
      });
      return;
    }
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1);
  };

  /**
   * Files are uploaded to `<tenant>/draft/…` before a submission row exists, so
   * once it does they are moved under its id. Identical to v1's: the path is
   * prefixed with the tenant id, which is what keeps one operator's uploads out
   * of another's folder.
   */
  const moveDraftFiles = async (submissionId: string): Promise<FileUrls> => {
    const updated: FileUrls = {};
    for (const [field, files] of Object.entries(fileUrls)) {
      if (!files) continue;
      const moved = [];
      for (const file of files) {
        const newPath = file.path.replace(`${tenantId}/draft/`, `${tenantId}/${submissionId}/`);
        if (newPath !== file.path) {
          const { error } = await supabase.storage
            .from("bonzah-onboarding-files")
            .move(file.path, newPath);
          if (!error) {
            const { data: signed } = await supabase.storage
              .from("bonzah-onboarding-files")
              .createSignedUrl(newPath, 60 * 60 * 24 * 30);
            moved.push({ ...file, path: newPath, url: signed?.signedUrl ?? file.url });
            continue;
          }
        }
        moved.push(file);
      }
      updated[field as keyof FileUrls] = moved;
    }
    return updated;
  };

  const handleFinalSubmit = async () => {
    setShowSubmitConfirm(false);
    const valid = await form.trigger();
    if (!valid) {
      toast({
        title: "Please complete the form",
        description: "Some required fields are missing on earlier steps.",
        variant: "destructive",
      });
      return;
    }
    if (!quizResult?.passed) {
      toast({
        title: "Complete the quiz first",
        description: "You need to pass the knowledge check before submitting.",
        variant: "destructive",
      });
      goToStep(QUIZ_STEP);
      return;
    }

    setIsSubmitting(true);
    try {
      const values = form.getValues();
      const row = await submit.mutateAsync({ data: values, fileUrls, quizResult });
      const movedFiles = await moveDraftFiles(row.id);
      if (Object.keys(movedFiles).length > 0) {
        await supabase
          .from("bonzah_onboarding_submissions")
          .update({ file_urls: movedFiles as unknown as Json })
          .eq("id", row.id)
          .eq("tenant_id", tenantId); // ← isolation: RLS is off on this table
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // ignore
      }
      await deleteDraft().catch(() => {});

      toast({
        title: "Application sent",
        description:
          "Bonzah has your application. They review it and set your account up from their side — you will see the status here.",
      });
      // The panel re-reads its stage and lands on "In review", which is the
      // submission status. Nothing navigates; the dialog stays open.
      await onSubmitted();
    } catch (err: unknown) {
      toast({
        title: "Could not submit",
        description:
          (err as { message?: string })?.message || "Could not submit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLast = currentStep === TOTAL_STEPS;

  return (
    <div className="flex max-h-[calc(88vh_-_17rem)] min-h-[20rem] flex-col">
      {/* ── header ──────────────────────────────────────────────────────────
          Fixed above the scroll box, so the operator always knows where they
          are in a ten-step form without scrolling back up. */}
      <div className="shrink-0 space-y-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Step {currentStep} of {TOTAL_STEPS}
            </p>
            <h3 className="mt-0.5 truncate text-base font-medium leading-tight text-foreground">
              {stepInfo?.title}
            </h3>
            {stepInfo?.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {stepInfo.description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-1 shrink-0 text-xs text-muted-foreground"
            onClick={onExit}
            disabled={isSubmitting}
          >
            Save &amp; close
          </Button>
        </div>

        {/* Ten segments, not ten labelled nodes: the labels are already on the
            heading above, and a labelled rail cannot fit ten steps in a dialog
            — which is precisely what breaks v1's `StepNav` in here. */}
        <ol className="flex items-center gap-1" aria-label="Application progress">
          {STEPS.map((s) => {
            const done = completedSteps.has(s.id);
            const active = s.id === currentStep;
            const reachable = done || s.id <= furthest;
            return (
              <li key={s.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  title={`${s.id}. ${s.title}`}
                  aria-label={`Step ${s.id}: ${s.title}`}
                  aria-current={active ? "step" : undefined}
                  disabled={!reachable || isSubmitting}
                  onClick={() => reachable && goToStep(s.id)}
                  className={cn(
                    "block h-1.5 w-full rounded-full transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    active
                      ? "bg-primary"
                      : done
                        ? "bg-primary/55"
                        : "bg-muted-foreground/20",
                    reachable && !active && "hover:bg-primary/40",
                    !reachable && "cursor-default",
                  )}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── the step itself ─────────────────────────────────────────────────
          `no-scrollbar` keeps the bar off the dialog (the theme rule is at
          styles/v2-theme.css); the box still scrolls by wheel, trackpad,
          keyboard and the focus ring moving through the fields. */}
      <FormProvider {...form}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) setShowSubmitConfirm(true);
            else void handleNext();
          }}
        >
          <div
            ref={scrollRef}
            className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="space-y-8 pb-6 pr-0.5">
              {currentStep === 1 && <Step1Business fileUrls={fileUrls} setFileUrls={setFileUrls} />}
              {currentStep === 2 && <Step2Operations />}
              {currentStep === 3 && <Step3Contacts fileUrls={fileUrls} setFileUrls={setFileUrls} />}
              {currentStep === 4 && <Step4Banking />}
              {currentStep === 5 && <Step5Insurance fileUrls={fileUrls} setFileUrls={setFileUrls} />}
              {currentStep === 6 && <Step6Policies fileUrls={fileUrls} setFileUrls={setFileUrls} />}
              {currentStep === 7 && <Step7Underwriting />}
              {currentStep === 8 && (
                <Step8Training
                  acknowledged={trainingAcknowledged}
                  onAcknowledgedChange={setTrainingAcknowledged}
                />
              )}
              {currentStep === 9 && <Step9Quiz result={quizResult} onResult={setQuizResult} />}
              {currentStep === 10 && <Step8Review fileUrls={fileUrls} />}
            </div>
          </div>

          {/* ── footer ────────────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => currentStep > 1 && goToStep(currentStep - 1)}
              disabled={currentStep === 1 || isSubmitting}
            >
              <ArrowLeft className="mr-1.5 size-4" />
              Back
            </Button>

            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Your answers save as you go
            </span>

            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Sending…
                </>
              ) : isLast ? (
                <>
                  <Send className="mr-1.5 size-4" />
                  Submit application
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="ml-1.5 size-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </FormProvider>

      <AlertDialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Check className="size-4 text-primary" />
              Send this to Bonzah?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bonzah reviews your application and sets your account up from their side. You cannot
              edit it once it is sent, but you can send a new one if something needs correcting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalSubmit}>Send it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
