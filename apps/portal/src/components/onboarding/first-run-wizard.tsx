'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Input } from '@/components/ui-v2/input';
import { Progress } from '@/components/ui-v2/progress';
import { cn } from '@/lib/utils';
import {
  FIRST_RUN_QUESTIONS,
  isAnswered,
  type FirstRunAnswer,
  type FirstRunAnswers,
  type FirstRunQuestion,
} from '@/lib/first-run-questions';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';

/**
 * First-run onboarding wizard — full screen, canary only, shown exactly once.
 *
 * Step 5 of the signup flow: landing → account → pay → "Go to portal" → HERE →
 * dashboard. A handful of questions, then the operator is dropped into the app
 * and never sees this again, because finishing (or skipping) writes the
 * `tenant_first_run` row that `useFirstRunWizard` looks for.
 *
 * WHAT IT RENDERS IS NOT IN THIS FILE. Every question comes from
 * `lib/first-run-questions.ts`; this component only knows how to draw the three
 * question KINDS. Swapping the questions is an edit to that array.
 *
 * WHY A PLAIN OVERLAY AND NOT `<Dialog>`. The other blocking surfaces here
 * split two ways: `SubscriptionGateDialog` is a Radix dialog because it is a
 * modal-sized card, and `TenantSuspendedScreen` is a bare `fixed inset-0`
 * because it owns the whole viewport. This is the second kind — it needs the
 * full width for choice cards and the page wash behind them, and it has no
 * business fighting Radix's scroll-lock and portal for a screen that covers
 * everything anyway.
 *
 * SUPPRESSION. The caller passes `suppressed` while the subscription paywall
 * owns the screen, exactly as `FeedbackForcePrompt` and `WelcomePackPrompt` do.
 * Two non-dismissible full-screen surfaces stacked on each other leave the
 * operator unable to act on either.
 */
export function FirstRunWizard({ suppressed = false }: { suppressed?: boolean }) {
  const { shouldShow, save } = useFirstRunWizard();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FirstRunAnswers>({});
  const [finishing, setFinishing] = useState(false);
  const [failed, setFailed] = useState(false);

  const questions = FIRST_RUN_QUESTIONS;
  const total = questions.length;
  const question = questions[step];

  const canAdvance = useMemo(
    () => (question ? isAnswered(question, answers[question.id]) : false),
    [question, answers],
  );

  // Hooks above this line, always. `shouldShow` flips as the query resolves.
  if (!shouldShow || suppressed || total === 0 || !question) return null;

  const isLast = step === total - 1;
  // Answered steps, not the current index: a progress bar that reads "1 of 5
  // done" before anything has been answered is a lie the operator can see.
  const answeredCount = questions.filter((q) => q.id in answers).length;
  const percent = Math.round((answeredCount / total) * 100);

  const setAnswer = (value: FirstRunAnswer) =>
    setAnswers((prev) => ({ ...prev, [question.id]: value }));

  const toggleMulti = (value: string) => {
    const current = answers[question.id];
    const list = Array.isArray(current) ? current : [];
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
    setAnswers((prev) => {
      // An empty multi-select is "not answered", not "answered with nothing" —
      // drop the key so `answeredCount` and `isAnswered` agree.
      if (next.length === 0) {
        const { [question.id]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [question.id]: next };
    });
  };

  const finish = async (skipped: boolean) => {
    setFinishing(true);
    setFailed(false);
    try {
      await save.mutateAsync({ answers, skipped });
      // No local "done" state: the row now exists, the query is invalidated,
      // `shouldShow` goes false and this unmounts. One source of truth.
    } catch {
      // Never trap the operator behind a wizard whose write failed. Say so and
      // leave both buttons live so they can retry — and note that even a total
      // failure here is recoverable, because the wizard simply asks again next
      // load rather than losing anything.
      setFailed(true);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div
      data-first-run-wizard=""
      role="dialog"
      aria-modal="true"
      aria-label="Set up your account"
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-background bg-app-gradient p-4 backdrop-blur-sm"
    >
      <Card className="w-full max-w-2xl">
        <CardContent className="flex flex-col gap-7 py-2">
          {/* Header — brand mark, step counter, progress */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <Sparkles className="size-4" />
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  Let&apos;s set you up
                </span>
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                Step {step + 1} of {total}
              </span>
            </div>
            <Progress value={percent} className="h-1.5" />
          </div>

          {/* Question */}
          <div className="flex flex-col gap-1.5">
            <h1 className="font-heading text-2xl font-medium leading-snug text-foreground">
              {question.prompt}
            </h1>
            {question.help ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {question.help}
              </p>
            ) : null}
          </div>

          {/* Answer */}
          <QuestionField
            question={question}
            answer={answers[question.id]}
            onSelect={setAnswer}
            onToggle={toggleMulti}
          />

          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              We couldn&apos;t save your answers just then. Please try again — nothing
              has been lost.
            </p>
          ) : null}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={finishing}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void finish(true)}
                disabled={finishing}
              >
                Skip for now
              </Button>
              {isLast ? (
                <Button
                  type="button"
                  onClick={() => void finish(false)}
                  disabled={!canAdvance || finishing}
                >
                  {finishing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Go to my dashboard
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
                  disabled={!canAdvance || finishing}
                >
                  Continue
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Draws one question. The only place that knows about the three kinds. */
function QuestionField({
  question,
  answer,
  onSelect,
  onToggle,
}: {
  question: FirstRunQuestion;
  answer: FirstRunAnswer | undefined;
  onSelect: (value: FirstRunAnswer) => void;
  onToggle: (value: string) => void;
}) {
  if (question.kind === 'text') {
    return (
      <Input
        autoFocus
        value={typeof answer === 'string' ? answer : ''}
        placeholder={question.placeholder}
        aria-label={question.prompt}
        onChange={(e) => onSelect(e.target.value)}
        className="h-11"
      />
    );
  }

  const selected = Array.isArray(answer)
    ? answer
    : typeof answer === 'string'
      ? [answer]
      : [];
  const multi = question.kind === 'multi';

  return (
    <div
      role={multi ? 'group' : 'radiogroup'}
      aria-label={question.prompt}
      className={cn(
        'grid gap-2',
        question.options.length > 4 ? 'sm:grid-cols-2' : 'grid-cols-1',
      )}
    >
      {question.options.map((option) => {
        const isOn = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isOn}
            onClick={() => (multi ? onToggle(option.value) : onSelect(option.value))}
            className={cn(
              'flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-all',
              'ring-1 ring-foreground/10 hover:ring-foreground/20',
              'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
              isOn
                ? 'bg-primary/10 text-foreground ring-2 ring-primary/60'
                : 'bg-card text-foreground',
            )}
          >
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{option.label}</span>
              {option.hint ? (
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={cn(
                'flex size-5 shrink-0 items-center justify-center transition-colors',
                multi ? 'rounded-md' : 'rounded-full',
                isOn
                  ? 'bg-primary text-primary-foreground'
                  : 'ring-1 ring-foreground/15',
              )}
            >
              {isOn ? <Check className="size-3" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
