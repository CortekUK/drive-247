'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STEPS, TOTAL_STEPS } from './schema';

interface StepNavProps {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}

export function StepNav({ currentStep, completedSteps, onStepClick }: StepNavProps) {
  const progressPct = ((currentStep - 1) / (TOTAL_STEPS - 1)) * 100;
  const currentStepInfo = STEPS.find((s) => s.id === currentStep);

  return (
    <div className="space-y-4">
      {/* Mobile: compact progress + label */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            Step {currentStep} of {TOTAL_STEPS}
          </span>
          <span className="text-muted-foreground">{currentStepInfo?.title}</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted dark:bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Desktop: full stepper */}
      <div className="hidden lg:flex items-center justify-between relative">
        {/* Background line */}
        <div className="absolute top-4 left-4 right-4 h-px bg-border dark:bg-gray-800" />
        {/* Filled line */}
        <div
          className="absolute top-4 left-4 h-px bg-primary transition-all duration-300"
          style={{ width: `calc((100% - 2rem) * ${progressPct / 100})` }}
        />

        {STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isComplete = completedSteps.has(step.id);
          const isClickable = isComplete || step.id <= currentStep;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              className={cn(
                'relative z-10 flex flex-col items-center gap-2 transition-opacity',
                !isClickable && 'cursor-not-allowed opacity-50',
                isClickable && 'hover:opacity-90',
              )}
              style={{ minWidth: '88px' }}
            >
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all',
                  isActive &&
                    'bg-primary text-primary-foreground border-primary ring-4 ring-primary/15',
                  !isActive &&
                    isComplete &&
                    'bg-primary/10 text-primary border-primary dark:bg-primary/20',
                  !isActive &&
                    !isComplete &&
                    'bg-background dark:bg-gray-900 text-muted-foreground border-border dark:border-gray-700',
                )}
              >
                {isComplete && !isActive ? (
                  <Check className="h-4 w-4" />
                ) : (
                  step.id
                )}
              </div>
              <div className="text-center">
                <p
                  className={cn(
                    'text-xs font-medium leading-tight',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.title}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
