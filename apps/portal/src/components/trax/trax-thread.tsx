"use client";

import { useEffect, useRef } from "react";
import { CalendarClock, Car, HelpCircle, TrendingUp, type LucideIcon } from "lucide-react";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { cn } from "@/lib/utils";
import type { ChatAttachment } from "@/types/chat";
import { useTrax } from "./trax-provider";
import { TraxComposer } from "./trax-composer";
import { TraxGreeting } from "./trax-greeting";
import { AttachmentChip, useTraxAttachmentCapability } from "./trax-attachments";

/**
 * The Trax conversation itself — greeting, messages and composer.
 *
 * ONE implementation, rendered by both surfaces: the docked panel and the full
 * page. They differ only in `density`. That is deliberate: message rendering,
 * the action confirm/reject wiring, auto-scroll and the Enter/Shift+Enter
 * contract must behave identically in a panel and on a page, and two copies of
 * them drift the first time one is touched. It has no header — each surface
 * draws its own.
 *
 * It reads the conversation from `useTrax()`, never from `useChat()` directly —
 * calling the hook here would give this component its own thread and undo the
 * whole point of the provider.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT: CLAUDE'S, AND ONE COMPOSER FOR BOTH STATES
 *
 * An empty conversation is a centred column: the greeting, the composer
 * directly beneath it, quiet suggestion chips under that. Once a message
 * exists, the greeting's slot becomes the scrolling message list and the
 * suggestions go, which leaves the composer pinned at the bottom.
 *
 * The composer is the SAME element in both states (the middle child, never
 * remounted), so a half-typed follow-up, attached files and focus all survive
 * the switch. The empty state centres it with two growing spacers instead of
 * moving it to a different place in the tree.
 *
 * ---------------------------------------------------------------------------
 * ONE BACKGROUND, NO LINES
 *
 * Nothing here paints a column background: the layout's app gradient shows
 * through, and the only opaque surface is the composer card. There is no
 * divider above the composer — a fade at the bottom of the scroller separates
 * the two instead.
 */

const SUGGESTIONS: Array<{ icon: LucideIcon; label: string; prompt: string }> = [
  { icon: CalendarClock, label: "Pending extensions", prompt: "Which rentals have pending extension requests?" },
  { icon: TrendingUp, label: "Revenue this month", prompt: "Show me this month's revenue breakdown" },
  { icon: Car, label: "Vehicles out now", prompt: "Which vehicles are out right now?" },
  { icon: HelpCircle, label: "How installments work", prompt: "How do installments work?" },
];

/**
 * "No lines" for the SHARED ChatMessage, scoped to this thread only.
 *
 * components/chat/ChatMessage.tsx and the cards it renders are also v1's, so
 * they are not edited. They draw hairlines everywhere — the assistant bubble,
 * code blocks, the copy button, the action and rental-request cards — and in
 * v2 dark mode `border-border/40` is worse than a line: `--border` already
 * carries an alpha, the `/40` makes the colour invalid, and the border falls
 * back to `currentColor`, a bright outline. So inside Trax every border is made
 * transparent (the action card's spinner, which IS a border, excepted), and
 * the surfaces that relied on a border for their shape get a soft card tone.
 */
const MESSAGE_SURFACES = cn(
  "[&_*:not(.animate-spin)]:!border-transparent",
  "[&_div:has(>.trax-markdown)]:bg-card/70",
  "[&_.rounded-xl.overflow-hidden]:bg-card/70",
);

export interface TraxThreadProps {
  density?: "sheet" | "page";
  autoFocus?: boolean;
  className?: string;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** "Thinking…" with a slow gradient sweep through the letters. */
function Thinking() {
  const ref = useRef<HTMLSpanElement>(null);

  /* Web Animations rather than a keyframe: no stylesheet change for one
     indicator, and it is simply never started under reduced motion. */
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
    const anim = el.animate([{ backgroundPosition: "100% 0" }, { backgroundPosition: "-100% 0" }], {
      duration: 1800,
      iterations: Infinity,
      easing: "linear",
    });
    return () => anim.cancel();
  }, []);

  return (
    <div role="status" className="flex items-center gap-2 py-2 pl-10 text-[13px] font-medium">
      <span
        ref={ref}
        className={cn(
          "bg-[length:200%_100%] bg-clip-text text-transparent",
          "bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_20%,hsl(var(--chart-2))_45%,hsl(var(--primary))_55%,hsl(var(--muted-foreground))_80%)]",
          "dark:bg-[linear-gradient(90deg,hsl(var(--muted-foreground))_20%,hsl(var(--chart-2))_45%,hsl(var(--chart-1))_55%,hsl(var(--muted-foreground))_80%)]",
        )}
      >
        Thinking…
      </span>
    </div>
  );
}

export function TraxThread({ density = "page", autoFocus = false, className }: TraxThreadProps) {
  const { chat } = useTrax();
  const { messages, isLoading, sendMessage, confirmAction, rejectAction } = chat;
  /* The thread only mounts once a surface is visible (the panel mounts it
     lazily), so this probe never fires on a page where Trax was not opened. */
  const { capability, isResolved } = useTraxAttachmentCapability(true);
  const endRef = useRef<HTMLDivElement>(null);

  const page = density === "page";
  const empty = messages.length === 0;

  /* Pin to the newest message. `messages.length` rather than `messages`: the
     array identity changes on every action-confirm rewrite too, and scrolling
     on those yanks the view while someone is reading. */
  useEffect(() => {
    if (empty) return;
    endRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isLoading]);

  const send = (text: string, attachments: ChatAttachment[]) => {
    void sendMessage(text, attachments.length > 0 ? { attachments } : undefined);
  };

  return (
    <div
      data-slot="trax-thread"
      data-density={density}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", empty && "no-scrollbar overflow-y-auto", className)}
    >
      {/* 1 — above the composer: the greeting, or the conversation. */}
      {empty ? (
        <div className={cn("flex flex-[1_0_auto] flex-col items-center justify-end px-4", page ? "pt-12" : "pt-8")}>
          <div className={cn("w-full", page && "max-w-[720px]")}>
            <TraxGreeting density={density} />
          </div>
        </div>
      ) : (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
          <div
            className={cn(
              "mx-auto flex w-full min-w-0 flex-col gap-2 px-4",
              page ? "max-w-[768px] py-6" : "py-4",
              MESSAGE_SURFACES,
            )}
          >
            {messages.map((m) => (
              <div key={m.id} className="flex min-w-0 flex-col">
                {m.role === "user" && m.attachments && m.attachments.length > 0 && (
                  <div className={cn("flex flex-wrap justify-end gap-2 pl-10 pr-10", m.content ? "pt-3" : "py-3")}>
                    {m.attachments.map((a) => (
                      <AttachmentChip key={a.id} attachment={a} notDelivered={m.attachmentsDelivered === false} />
                    ))}
                  </div>
                )}
                {/* A files-only message has no text to put in a bubble. */}
                {(m.role !== "user" || m.content.length > 0) && (
                  <ChatMessage
                    message={m}
                    onConfirmAction={confirmAction}
                    onRejectAction={rejectAction}
                    /* `onNavigate` is deliberately NOT passed, and that is a
                       behavioural difference from v1 rather than an omission.
                       Despite the name it is a "dismiss me" callback — the cards
                       and the action badge do their own routing, and the v1
                       dialog supplies `() => setIsOpen(false)` because it is a
                       full-screen overlay you cannot see past.
                       Neither surface here has that problem: the panel docks
                       beside the page, so staying open while the page next to it
                       navigates is the entire reason it is a panel and not a
                       dialog; and the full page is a route, so there is nothing
                       to dismiss. Leaving it undefined keeps Trax on screen next
                       to whatever it just took you to. */
                    isLoading={isLoading}
                  />
                )}
              </div>
            ))}
            {isLoading && <Thinking />}
            <div ref={endRef} />
          </div>
        </div>
      )}

      {/* 2 — the composer. Same element in both states; see the header. */}
      <div className={cn("relative shrink-0 px-4", empty ? (page ? "pt-7" : "pt-5") : page ? "pb-6 pt-1" : "pb-4 pt-1")}>
        <div className={cn("mx-auto w-full", page && "max-w-[768px]")}>
          <TraxComposer
            density={density}
            busy={isLoading}
            capability={capability}
            capabilityResolved={isResolved}
            autoFocus={autoFocus}
            onSend={send}
          />
        </div>
      </div>

      {/* 3 — suggestions, empty state only. Quiet chips, not a grid of cards. */}
      {empty && (
        <div className={cn("flex flex-[1_0_auto] justify-center px-4", page ? "pb-12 pt-5" : "pb-8 pt-4")}>
          <div className={cn("flex h-fit w-full flex-wrap content-start justify-center gap-2", page && "max-w-[720px]")}>
            {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                type="button"
                disabled={isLoading}
                onClick={() => send(prompt, [])}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full bg-card/50 px-3 py-1.5 text-[12px] text-muted-foreground backdrop-blur transition-colors",
                  "hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                )}
              >
                <Icon className="size-3.5 text-primary dark:text-[hsl(var(--chart-2))]" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
