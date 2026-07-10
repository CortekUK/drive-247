'use client';

import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { SectionTitle } from './section-title';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from '@/hooks/use-toast';
import {
  useBonzahQuizQuestions,
  useGradeBonzahQuiz,
  type QuizGradeResult,
} from '@/hooks/use-bonzah-quiz';

interface Step9QuizProps {
  result: QuizGradeResult | null;
  onResult: (r: QuizGradeResult | null) => void;
}

export function Step9Quiz({ result, onResult }: Step9QuizProps) {
  const { data: questions, isLoading } = useBonzahQuizQuestions();
  const grade = useGradeBonzahQuiz();
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const allAnswered =
    !!questions && questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);

  const handleSubmit = async () => {
    if (!allAnswered) {
      toast({
        title: 'Answer every question',
        description: 'Please select an answer for each question before checking.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await grade.mutateAsync(answers);
      onResult(res);
      if (res.passed) {
        toast({
          title: 'Quiz passed 🎉',
          description: `You scored ${res.score}/${res.total}. You can now submit your application.`,
        });
      } else {
        toast({
          title: 'Not quite',
          description: `You scored ${res.score}/${res.total}. Review the training and try again.`,
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Could not grade the quiz',
        description: (err as Error).message || 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const retake = () => {
    onResult(null);
    setAnswers({});
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading quiz…
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="space-y-8">
        <SectionTitle icon={ClipboardCheck} title="Knowledge Check" />
        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          No quiz is configured yet. You can continue.
        </div>
      </div>
    );
  }

  const passed = result?.passed === true;

  return (
    <div className="space-y-8">
      <SectionTitle
        icon={ClipboardCheck}
        title="Knowledge Check"
        description="A quick check to confirm you're ready to offer Bonzah. You need 80% to submit your application."
      />

      {passed && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 dark:bg-emerald-950/20 dark:border-emerald-900/60 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="text-sm text-emerald-900 dark:text-emerald-200">
            <strong>Passed — {result?.score}/{result?.total}.</strong> Continue to review and
            submit your application.
          </div>
        </div>
      )}

      <div className="space-y-6">
        {questions.map((q, idx) => {
          const graded = result?.results?.[q.id];
          const selected = answers[q.id];
          return (
            <div key={q.id} className="rounded-xl border border-border/70 p-4">
              <div className="flex items-start gap-2 mb-3">
                <span className="text-xs font-semibold text-primary mt-0.5">Q{idx + 1}</span>
                <p className="text-sm font-medium leading-tight">{q.question}</p>
                {result && (
                  graded ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 ml-auto shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500 ml-auto shrink-0" />
                  )
                )}
              </div>
              <RadioGroup
                value={selected !== undefined ? String(selected) : ''}
                onValueChange={(v) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: Number(v) }))
                }
                disabled={!!result}
                className="space-y-2"
              >
                {q.options.map((opt, i) => (
                  <label
                    key={i}
                    className="flex items-center gap-2.5 rounded-md border border-border/50 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <RadioGroupItem value={String(i)} />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        {!passed ? (
          <>
            <Button type="button" onClick={handleSubmit} disabled={grade.isPending || !allAnswered}>
              {grade.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Checking…
                </>
              ) : (
                'Check answers'
              )}
            </Button>
            {result && !passed && (
              <Button type="button" variant="ghost" onClick={retake}>
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Try again
              </Button>
            )}
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={retake}>
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Retake quiz
          </Button>
        )}
      </div>
    </div>
  );
}
