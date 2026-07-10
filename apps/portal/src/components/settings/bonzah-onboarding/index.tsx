'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, ArrowRight, ChevronRight, Loader2, Send, ShieldCheck } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import {
  bonzahOnboardingSchema,
  DEFAULT_VALUES,
  STEPS,
  TOTAL_STEPS,
  stepFields,
  type BonzahOnboardingFormData,
  type FileUrls,
} from './schema';
import { StepNav } from './step-nav';
import { SubmissionStatus } from './submission-status';
import { Step1Business } from './steps/step-1-business';
import { Step2Operations } from './steps/step-2-operations';
import { Step3Contacts } from './steps/step-3-contacts';
import { Step4Banking } from './steps/step-4-banking';
import { Step5Insurance } from './steps/step-5-insurance';
import { Step6Policies } from './steps/step-6-policies';
import { Step7Underwriting } from './steps/step-7-underwriting';
import { Step8Training } from './steps/step-8-training';
import { Step9Quiz } from './steps/step-9-quiz';
import { Step8Review } from './steps/step-8-review';
import { useBonzahOnboarding } from '@/hooks/use-bonzah-onboarding';
import type { QuizGradeResult } from '@/hooks/use-bonzah-quiz';

const DRAFT_KEY = (tenantId: string) => `bonzah_onboarding_draft_${tenantId}`;

export function BonzahOnboardingForm() {
  const { tenant } = useTenant();
  const { activeSubmission, lastSubmission, isLoading, submit, fetchDraft, saveDraft, deleteDraft } =
    useBonzahOnboarding();
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [fileUrls, setFileUrls] = useState<FileUrls>({});
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forceShowForm, setForceShowForm] = useState(false);
  const [trainingAcknowledged, setTrainingAcknowledged] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizGradeResult | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Step numbers for the gated training/quiz steps (kept in sync with STEPS).
  const TRAINING_STEP = 8;
  const QUIZ_STEP = 9;

  const form = useForm<BonzahOnboardingFormData>({
    resolver: zodResolver(bonzahOnboardingSchema),
    defaultValues: DEFAULT_VALUES as BonzahOnboardingFormData,
    mode: 'onTouched',
  });

  const draftKey = tenant?.id ? DRAFT_KEY(tenant.id) : null;
  // Gate saving until the initial load resolves, so the empty default form
  // doesn't overwrite a stored draft before it has been hydrated.
  const draftLoadedRef = useRef(false);

  const applyDraft = (parsed: {
    values?: BonzahOnboardingFormData;
    step?: number;
    completed?: number[];
    fileUrls?: FileUrls;
  }) => {
    if (parsed?.values) form.reset(parsed.values);
    if (typeof parsed?.step === 'number') setCurrentStep(parsed.step);
    if (parsed?.completed) setCompletedSteps(new Set(parsed.completed));
    if (parsed?.fileUrls) setFileUrls(parsed.fileUrls);
  };

  // Load draft on mount: DB is the source of truth (cross-device), with
  // localStorage as an instant fallback if the DB has nothing / is offline.
  useEffect(() => {
    if (!draftKey || !tenant?.id) return;
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
  }, [draftKey, tenant?.id]);

  // Save draft on every change — to localStorage (instant) and the DB (durable,
  // cross-device). Debounced; DB write is best-effort and never blocks the UI.
  const watched = form.watch();
  useEffect(() => {
    if (!draftKey || !draftLoadedRef.current) return;
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

  const scrollToTop = () => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
    setTimeout(scrollToTop, 50);
  };

  const handleNext = async () => {
    // Gate the training step: must acknowledge before continuing.
    if (currentStep === TRAINING_STEP && !trainingAcknowledged) {
      toast({
        title: 'Please confirm the training',
        description: 'Tick the box to confirm you’ve watched the training.',
        variant: 'destructive',
      });
      return;
    }
    // Gate the quiz step: must pass the server-graded quiz before continuing.
    if (currentStep === QUIZ_STEP && !quizResult?.passed) {
      toast({
        title: 'Pass the quiz to continue',
        description: 'Answer the questions and click "Check answers" to pass.',
        variant: 'destructive',
      });
      return;
    }

    const fieldsForStep = stepFields[currentStep] ?? [];
    const valid = await form.trigger(fieldsForStep as never);
    if (!valid) {
      toast({
        title: 'Please fix the highlighted fields',
        description: 'Some required information is missing or invalid.',
        variant: 'destructive',
      });
      return;
    }
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    if (currentStep < TOTAL_STEPS) {
      goToStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) goToStep(currentStep - 1);
  };

  const moveDraftFiles = async (submissionId: string): Promise<FileUrls> => {
    if (!tenant?.id) return fileUrls;
    const updated: FileUrls = {};
    for (const [field, files] of Object.entries(fileUrls)) {
      if (!files) continue;
      const moved = [];
      for (const file of files) {
        const newPath = file.path.replace(
          `${tenant.id}/draft/`,
          `${tenant.id}/${submissionId}/`,
        );
        if (newPath !== file.path) {
          const { error } = await supabase.storage
            .from('bonzah-onboarding-files')
            .move(file.path, newPath);
          if (!error) {
            const { data: signed } = await supabase.storage
              .from('bonzah-onboarding-files')
              .createSignedUrl(newPath, 60 * 60 * 24 * 30);
            moved.push({
              ...file,
              path: newPath,
              url: signed?.signedUrl ?? file.url,
            });
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
        title: 'Please complete the form',
        description: 'Some required fields are missing across earlier steps.',
        variant: 'destructive',
      });
      return;
    }
    if (!quizResult?.passed) {
      toast({
        title: 'Complete the quiz first',
        description: 'You need to pass the knowledge check before submitting.',
        variant: 'destructive',
      });
      setCurrentStep(QUIZ_STEP);
      return;
    }
    setIsSubmitting(true);
    try {
      const values = form.getValues();
      const row = await submit.mutateAsync({ data: values, fileUrls, quizResult });
      // Move draft files into the submission folder
      const movedFiles = await moveDraftFiles(row.id);
      if (Object.keys(movedFiles).length > 0) {
        await supabase
          .from('bonzah_onboarding_submissions')
          .update({ file_urls: movedFiles as unknown as Json })
          .eq('id', row.id);
      }
      // Clear draft (both stores)
      if (draftKey) localStorage.removeItem(draftKey);
      await deleteDraft().catch(() => {});
      form.reset(DEFAULT_VALUES as BonzahOnboardingFormData);
      setFileUrls({});
      setCurrentStep(1);
      setCompletedSteps(new Set());
      setForceShowForm(false);
      setTrainingAcknowledged(false);
      setQuizResult(null);
      toast({
        title: 'Submitted!',
        description:
          'Your Bonzah onboarding application has been received. Drive247 will review and get back to you soon.',
      });
    } catch (err: any) {
      toast({
        title: 'Submission failed',
        description: err.message || 'Could not submit. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Decide what to show
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading onboarding status…</span>
        </CardContent>
      </Card>
    );
  }

  // Show submission status when there's a pending or approved submission
  // (rejected falls through to the form so they can re-submit)
  if (activeSubmission && !forceShowForm) {
    return <SubmissionStatus submission={activeSubmission} />;
  }

  if (lastSubmission?.status === 'rejected' && !forceShowForm) {
    return (
      <SubmissionStatus
        submission={lastSubmission}
        onResubmit={() => setForceShowForm(true)}
      />
    );
  }

  return (
    <Card ref={containerRef}>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Bonzah Onboarding
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Step {currentStep} of {TOTAL_STEPS} · {stepInfo?.description}
            </p>
          </div>
          <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-1.5 mt-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Draft auto-saved
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pb-6 border-b">
        <StepNav
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={goToStep}
        />
      </CardContent>

      <FormProvider {...form}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (currentStep < TOTAL_STEPS) {
              void handleNext();
            } else {
              setShowSubmitConfirm(true);
            }
          }}
        >
          <CardContent className="pt-8 space-y-8">
            {currentStep === 1 && (
              <Step1Business fileUrls={fileUrls} setFileUrls={setFileUrls} />
            )}
            {currentStep === 2 && <Step2Operations />}
            {currentStep === 3 && (
              <Step3Contacts fileUrls={fileUrls} setFileUrls={setFileUrls} />
            )}
            {currentStep === 4 && <Step4Banking />}
            {currentStep === 5 && (
              <Step5Insurance fileUrls={fileUrls} setFileUrls={setFileUrls} />
            )}
            {currentStep === 6 && (
              <Step6Policies fileUrls={fileUrls} setFileUrls={setFileUrls} />
            )}
            {currentStep === 7 && <Step7Underwriting />}
            {currentStep === 8 && (
              <Step8Training
                acknowledged={trainingAcknowledged}
                onAcknowledgedChange={setTrainingAcknowledged}
              />
            )}
            {currentStep === 9 && (
              <Step9Quiz result={quizResult} onResult={setQuizResult} />
            )}
            {currentStep === 10 && <Step8Review fileUrls={fileUrls} />}
          </CardContent>

          <div className="sticky bottom-0 z-10 bg-card/95 backdrop-blur-sm border-t border-border dark:border-gray-800 px-6 py-4 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 1 || isSubmitting}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
            <div className="text-xs text-muted-foreground hidden md:block">
              {STEPS.slice(0, currentStep - 1).length > 0 && (
                <span className="inline-flex items-center gap-1">
                  {STEPS[currentStep - 1]?.title}
                  {currentStep < TOTAL_STEPS && (
                    <>
                      <ChevronRight className="h-3 w-3" />
                      {STEPS[currentStep]?.title}
                    </>
                  )}
                </span>
              )}
            </div>
            {currentStep < TOTAL_STEPS ? (
              <Button type="submit" disabled={isSubmitting}>
                Continue
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1.5" />
                    Submit Application
                  </>
                )}
              </Button>
            )}
          </div>
        </form>
      </FormProvider>

      <AlertDialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your application?</AlertDialogTitle>
            <AlertDialogDescription>
              Once submitted, the Drive247 team will review your application and follow up
              with your Bonzah credentials. You won't be able to edit this submission, but
              you can submit a new one if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalSubmit}>
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default BonzahOnboardingForm;
