"use client";

import { STEP_TITLES } from "@/client-schemas/apply";

interface ApplyProgressProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function ApplyProgress({ currentStep, onStepClick }: ApplyProgressProps) {
  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {currentStep + 1} of {STEP_TITLES.length}</span>
        <span className="font-medium text-foreground">{STEP_TITLES[currentStep]}</span>
      </div>
      <div className="flex gap-1.5">
        {STEP_TITLES.map((title, idx) => {
          const done = idx < currentStep;
          const active = idx === currentStep;
          return (
            <button
              key={title}
              type="button"
              disabled={!onStepClick || idx > currentStep}
              onClick={() => onStepClick?.(idx)}
              className={[
                "h-1.5 flex-1 rounded-full transition-colors",
                done ? "bg-primary" : active ? "bg-primary/70" : "bg-muted",
                onStepClick && idx <= currentStep ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
              aria-label={`Step ${idx + 1}: ${title}`}
            />
          );
        })}
      </div>
    </div>
  );
}
