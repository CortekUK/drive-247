"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ArrowRight,
  PartyPopper,
  X,
  Rocket,
} from "lucide-react";
import type { ChecklistItem } from "@/hooks/use-platform-status";
import { useTenant } from "@/contexts/TenantContext";

interface GettingStartedChecklistProps {
  checklist: ChecklistItem[];
  checklistProgress: number;
  allComplete: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function ProgressRing({
  progress,
  size = 40,
  strokeWidth = 3,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted-foreground/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#progress-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient
            id="progress-gradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Rocket className="h-4 w-4 text-indigo-400" />
      </div>
    </div>
  );
}

export function GettingStartedChecklist({
  checklist,
  checklistProgress,
  allComplete,
}: GettingStartedChecklistProps) {
  const router = useRouter();
  const { tenant } = useTenant();
  const collapseKey = `getting-started-collapsed-${tenant?.id}`;
  const dismissKey = `getting-started-dismissed-${tenant?.id}`;
  const completedAtKey = `getting-started-completed-at-${tenant?.id}`;

  useEffect(() => {
    if (!tenant?.id) return;
    if (allComplete && !localStorage.getItem(completedAtKey)) {
      localStorage.setItem(completedAtKey, Date.now().toString());
    }
  }, [allComplete, tenant?.id, completedAtKey]);

  const isHidden = (() => {
    if (typeof window === "undefined") return false;
    if (localStorage.getItem(dismissKey) === "true") return true;
    const completedAt = localStorage.getItem(completedAtKey);
    if (completedAt && Date.now() - Number(completedAt) > SEVEN_DAYS_MS)
      return true;
    return false;
  })();

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    if (allComplete) return true;
    return localStorage.getItem(collapseKey) === "true";
  });

  useEffect(() => {
    if (allComplete) {
      setCollapsed(true);
      localStorage.setItem(collapseKey, "true");
    }
  }, [allComplete, collapseKey]);

  if (isHidden) return null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(collapseKey, String(next));
  };

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, "true");
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const completedCount = checklist.filter((i) => i.isComplete).length;
  const remaining = checklist.length - completedCount;
  const sortedChecklist = [...checklist].sort(
    (a, b) => a.priority - b.priority
  );
  const nextStep = sortedChecklist.find((i) => !i.isComplete);

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden relative">
      {/* Subtle top accent line */}
      <div
        className="absolute top-0 left-0 h-[2px] bg-gradient-to-r from-indigo-500 via-indigo-400 to-violet-500 transition-all duration-700 ease-out"
        style={{ width: `${checklistProgress}%` }}
      />

      {/* Collapsed header */}
      <button
        onClick={toggleCollapsed}
        className="w-full px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-muted/10 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-4 min-w-0">
          {allComplete ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 shrink-0">
              <PartyPopper className="h-4.5 w-4.5 text-green-500" />
            </div>
          ) : (
            <ProgressRing progress={checklistProgress} />
          )}

          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">
                {allComplete ? "Setup Complete" : "Getting Started"}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {completedCount}/{checklist.length}
              </span>
            </div>
            {/* Show next step hint when collapsed, or general text when expanded */}
            <p className="text-xs text-muted-foreground truncate">
              {allComplete
                ? "All integrations configured"
                : collapsed && nextStep
                  ? `Next: ${nextStep.label}`
                  : `${remaining} step${remaining !== 1 ? "s" : ""} remaining`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Step dots */}
          <div className="hidden sm:flex items-center gap-1.5">
            {checklist.map((item) => (
              <div
                key={item.id}
                className={`h-2 w-2 rounded-full transition-colors duration-500 ${
                  item.isComplete
                    ? "bg-green-500"
                    : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>

          {allComplete && (
            <div
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDismiss();
              }}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground ml-1"
            >
              <X className="h-3.5 w-3.5" />
            </div>
          )}

          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
              collapsed ? "" : "rotate-180"
            }`}
          />
        </div>
      </button>

      {/* Animated checklist panel */}
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: collapsed
            ? 0
            : contentRef.current?.scrollHeight ?? 1000,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="px-5 pt-1 pb-4 space-y-1">
          {sortedChecklist.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                item.isComplete ? "opacity-50" : "bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-3">
                {item.isComplete ? (
                  <CheckCircle2 className="h-[18px] w-[18px] text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-[18px] w-[18px] text-muted-foreground/30 shrink-0" />
                )}
                <div>
                  <p
                    className={`text-sm font-medium ${
                      item.isComplete
                        ? "line-through text-muted-foreground"
                        : ""
                    }`}
                  >
                    {item.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
              {!item.isComplete && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0 text-xs h-7 px-3"
                  onClick={() => router.push(item.actionPath)}
                >
                  {item.actionLabel}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
