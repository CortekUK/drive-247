"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, Car, CreditCard, HelpCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TraxComposer } from "@/components/trax/trax-composer";
import { TraxGreeting } from "@/components/trax/trax-greeting";
import { ChatMessage } from "./ChatMessage";
import { SupportWorkspace } from "./SupportWorkspace";
import { useTraxSupportChat } from "./trax-support-context";

/**
 * The TRAX support conversation inside Trax's docked panel and full page.
 *
 * Same shape as trax-thread.tsx — greeting and composer centred while empty,
 * then a scrolling thread with the composer pinned — but driven by
 * `useTraxSupport`: verified answers and navigation, Check again, payment
 * cards, issues, My Tickets and the explicit Communicate with Support handoff
 * (SupportWorkspace). Attachments stay off: the support endpoint takes text only.
 */

const SUGGESTIONS: Array<{ icon: LucideIcon; label: string; prompt: string }> = [
  { icon: Car, label: "Vehicles out now", prompt: "Which vehicles are out on rent right now?" },
  { icon: CalendarClock, label: "Today's pickups and returns", prompt: "What pickups and returns are scheduled for today?" },
  { icon: HelpCircle, label: "How to create a rental", prompt: "How do I create a new rental?" },
];
const PAYMENT_SUGGESTION = { icon: CreditCard, label: "Check a rental's payments", prompt: "I want to check the payments for a rental." };
const PAYMENT_QUESTION = /\b(payments?|stripe|refunds?|receipt|paid|charged?|paisa|paise|raqam)\b/i;

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface TraxSupportThreadProps {
  density?: "sheet" | "page";
  autoFocus?: boolean;
  /** False while the panel is closed: nothing renders, so ticket polling and read receipts stop. */
  active?: boolean;
  className?: string;
}

export function TraxSupportThread({ density = "page", autoFocus = false, active = true, className }: TraxSupportThreadProps) {
  const {
    messages, isLoading, error, sendMessage, confirmAction, rejectAction, navigate, capabilities,
    checkAgain, supportRequest, issues, activeIssueId, recentConversations, contextKey,
  } = useTraxSupportChat();
  const endRef = useRef<HTMLDivElement>(null);

  const page = density === "page";
  const empty = messages.length === 0;
  const suggestions = capabilities?.finance ? [...SUGGESTIONS, PAYMENT_SUGGESTION] : SUGGESTIONS;
  const lastQuestion = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const status = capabilities?.finance && PAYMENT_QUESTION.test(lastQuestion)
    ? "Checking rental payments… Verifying with Stripe…"
    : capabilities?.modelReady ? "Checking guidance and authorized records…" : "Loading application guidance…";

  useEffect(() => {
    if (empty) return;
    endRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isLoading]);

  const send = (text: string) => {
    if (text.trim()) void sendMessage(text);
  };

  if (!active) return null;

  return (
    <div data-slot="trax-support-thread" data-density={density} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <SupportWorkspace
        key={contextKey}
        request={supportRequest}
        capabilities={capabilities}
        issues={issues}
        activeIssueId={activeIssueId}
        recent={recentConversations}
        busy={isLoading}
        compact={density === "sheet"}
      >
        <div className={cn("flex min-h-0 flex-1 flex-col", empty && "no-scrollbar overflow-y-auto")}>
          {/* 1 — the greeting, or the conversation. */}
          {empty ? (
            <div className={cn("flex flex-[1_0_auto] flex-col items-center justify-end px-4", page ? "pt-12" : "pt-8")}>
              <div className={cn("w-full", page && "max-w-[720px]")}>
                <TraxGreeting density={density} />
              </div>
            </div>
          ) : (
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
              <div className={cn("mx-auto flex w-full min-w-0 flex-col gap-1 px-4", page ? "max-w-[768px] py-6" : "py-4")}>
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    onConfirmAction={confirmAction}
                    onRejectAction={rejectAction}
                    onVerifyNavigation={navigate}
                    onCheckAgain={m.id === messages.at(-1)?.id ? checkAgain : undefined}
                    isLoading={isLoading}
                  />
                ))}
                {isLoading && <p role="status" className="py-2 pl-10 text-[13px] font-medium text-muted-foreground">{status}</p>}
                <div ref={endRef} />
              </div>
            </div>
          )}

          {/* 2 — the composer, the same element in both states. */}
          <div className={cn("relative shrink-0 px-4", empty ? (page ? "pt-7" : "pt-5") : page ? "pb-6 pt-1" : "pb-4 pt-1")}>
            <div className={cn("mx-auto w-full", page && "max-w-[768px]")}>
              <TraxComposer
                density={density}
                busy={isLoading}
                capability={null}
                capabilityResolved
                autoFocus={autoFocus}
                onSend={(text) => send(text)}
              />
              {capabilities && !capabilities.modelReady && (
                <p className="pt-2 text-center text-[11px] text-muted-foreground">Prepared guidance · AI model not configured</p>
              )}
            </div>
          </div>

          {/* 3 — suggestions, empty state only. */}
          {empty && (
            <div className={cn("flex flex-[1_0_auto] justify-center px-4", page ? "pb-12 pt-5" : "pb-8 pt-3")}>
              <div className={cn("flex h-fit w-full", page ? "max-w-[720px] flex-wrap content-start justify-center gap-2" : "flex-col items-stretch gap-0.5")}>
                {suggestions.map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={isLoading}
                    onClick={() => send(prompt)}
                    className={cn(
                      "items-center text-muted-foreground transition-colors",
                      "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      page
                        ? "inline-flex gap-1.5 rounded-full bg-card/50 px-3 py-1.5 text-[12px] backdrop-blur hover:bg-card"
                        : "flex w-full gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-card/60",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0 text-primary dark:text-[hsl(var(--chart-2))]" aria-hidden />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SupportWorkspace>
      {error && <p role="alert" className="mx-4 mb-3 rounded-lg bg-card/70 p-3 text-[13px]">{error}</p>}
    </div>
  );
}
