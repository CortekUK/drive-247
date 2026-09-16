"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, Car, CreditCard, HelpCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TraxComposer } from "@/components/trax/trax-composer";
import { TraxGreeting } from "@/components/trax/trax-greeting";
import { ChatMessage } from "./ChatMessage";
import { SupportWorkspace } from "./SupportWorkspace";
import { useTraxSupportChat, useTraxSupportWorkspace } from "./trax-support-context";

/**
 * The TRAX workspace body: the conversation and, through SupportWorkspace, the
 * conversation history. The panel header (trax-panel.tsx) and the `/trax` page
 * header drive the view.
 *
 * Human support is not rendered here: the issue bar and the header open the
 * portal's Support section instead (lib/support-route.ts).
 *
 * The conversation keeps trax-thread.tsx's shape — greeting and composer
 * centred while empty, then a scrolling thread with the composer pinned — with
 * useTraxSupport behind it: verified answers, Check again, payment cards,
 * issues and the explicit Communicate with Support handoff. Attachments stay
 * off: the support endpoint takes text only.
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
  /** Open the portal's Support section (and leave TRAX). */
  onOpenSupport?: (target: { ticketId?: string; issueId?: string }) => void;
  className?: string;
}

export function TraxSupportThread({ density = "page", autoFocus = false, onOpenSupport, className }: TraxSupportThreadProps) {
  const {
    messages, isLoading, error, sendMessage, confirmAction, rejectAction, navigate, capabilities,
    checkAgain, supportRequest, issues, activeIssueId, recentConversations, contextKey,
  } = useTraxSupportChat();
  const { view, setView } = useTraxSupportWorkspace();
  const endRef = useRef<HTMLDivElement>(null);

  const page = density === "page";
  const empty = messages.length === 0;
  const suggestions = capabilities?.finance ? [...SUGGESTIONS, PAYMENT_SUGGESTION] : SUGGESTIONS;
  const lastQuestion = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const status = capabilities?.finance && PAYMENT_QUESTION.test(lastQuestion)
    ? "Checking rental payments… Verifying with Stripe…"
    : capabilities?.modelReady ? "Checking guidance and authorized records…" : "Loading application guidance…";

  useEffect(() => {
    if (empty || view !== "conversation") return;
    endRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isLoading, view]);

  const send = (text: string) => {
    if (text.trim()) void sendMessage(text);
  };

  return (
    <div data-slot="trax-support-thread" data-density={density} data-view={view} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <SupportWorkspace
        key={contextKey}
        request={supportRequest}
        capabilities={capabilities}
        issues={issues}
        activeIssueId={activeIssueId}
        recent={recentConversations}
        busy={isLoading}
        onOpenSupport={onOpenSupport}
        view={view}
        onView={setView}
      >
        <div className={cn("flex min-h-0 flex-1 flex-col", empty && "no-scrollbar overflow-y-auto")}>
          {/* 1 — the greeting, or the conversation. */}
          {empty ? (
            <div className={cn("flex flex-[1_0_auto] flex-col items-center justify-end px-4", page ? "pt-12" : "pt-10")}>
              <div className={cn("w-full", page && "max-w-[720px]")}>
                <TraxGreeting density={density} />
                <p className={cn("mt-2 text-center text-[12px] leading-relaxed text-muted-foreground", page && "text-[13px]")}>
                  {capabilities?.modelReady
                    ? "Ask about your fleet, rentals and bookings. TRAX checks your own records before it answers."
                    : "Prepared application guidance. TRAX is not connected to an AI model in this environment."}
                </p>
              </div>
            </div>
          ) : (
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
              <div className={cn("mx-auto flex w-full min-w-0 flex-col gap-1", page ? "max-w-[768px] px-4 py-6" : "px-3.5 py-4")}>
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
          <div className={cn("relative shrink-0", page ? "px-4" : "px-3.5", empty ? (page ? "pt-7" : "pt-6") : page ? "pb-6 pt-1" : "pb-4 pt-1")}>
            <div className={cn("mx-auto w-full", page && "max-w-[768px]")}>
              <TraxComposer
                density={density}
                busy={isLoading}
                capability={null}
                capabilityResolved
                autoFocus={autoFocus}
                onSend={(text) => send(text)}
              />
            </div>
          </div>

          {/* 3 — suggestions, empty state only. */}
          {empty && (
            <div className={cn("flex flex-[1_0_auto] justify-center", page ? "px-4 pb-12 pt-5" : "px-3.5 pb-8 pt-4")}>
              <div className={cn("flex h-fit w-full", page ? "max-w-[720px] flex-wrap content-start justify-center gap-2" : "flex-col items-stretch gap-1")}>
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
                        : "flex w-full gap-2.5 rounded-xl border border-border/40 bg-card/40 px-3 py-2.5 text-left text-[13px] hover:bg-card/80",
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
      {error && <p role="alert" className={cn("mb-3 rounded-lg bg-card/70 p-3 text-[13px]", page ? "mx-4" : "mx-3.5")}>{error}</p>}
    </div>
  );
}
