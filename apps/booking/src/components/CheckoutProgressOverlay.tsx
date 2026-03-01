'use client';

import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckoutProgressOverlayProps {
  isVisible: boolean;
  currentStep: number; // 0 = hidden, 1-based index for active step
  steps: { label: string }[];
}

export default function CheckoutProgressOverlay({
  isVisible,
  currentStep,
  steps,
}: CheckoutProgressOverlayProps) {
  const totalSteps = steps.length;
  const percent = currentStep > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md transition-all duration-300',
        isVisible
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      )}
    >
      <div className="w-full max-w-md mx-4 p-8 rounded-2xl bg-card border border-border shadow-2xl">
        {/* Spinning icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/10 blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              {currentStep >= totalSteps ? (
                <Check className="w-8 h-8 text-primary" />
              ) : (
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              )}
            </div>
          </div>
        </div>

        {/* Title */}
        <h3 className="text-xl font-display font-semibold text-center text-foreground mb-1">
          Processing Your Booking
        </h3>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Please don&apos;t close this page
        </p>

        {/* Progress bar */}
        <div className="relative h-2 rounded-full bg-muted overflow-hidden mb-2">
          <div
            className="checkout-progress-bar-fill h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground text-right mb-6 tabular-nums">
          {percent}%
        </p>

        {/* Step list */}
        <div className="space-y-3">
          {steps.map((step, index) => {
            const stepNum = index + 1;
            const isCompleted = currentStep > stepNum;
            const isActive = currentStep === stepNum;
            const isPending = currentStep < stepNum;

            return (
              <div key={index} className="flex items-center gap-3">
                {/* Icon */}
                <div className="shrink-0">
                  {isCompleted ? (
                    <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-green-600" />
                    </div>
                  ) : isActive ? (
                    <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                    </div>
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    'text-sm transition-colors duration-300',
                    isCompleted && 'text-muted-foreground',
                    isActive && 'text-foreground font-medium',
                    isPending && 'text-muted-foreground/50'
                  )}
                >
                  {step.label}
                  {isActive && (
                    <span className="inline-flex ml-0.5">
                      <span className="animate-pulse">.</span>
                      <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                      <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
