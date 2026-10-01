"use client";

/**
 * Notifications v2: Trax in the right rail, writing one message (Oct 1 2026).
 *
 * The operator's hard part is the variables: `{{pickup_time}}` means nothing
 * until you see it filled in. So Trax writes and rewrites in plain words, uses
 * only the variables this notification allows, and the phone / Gmail preview
 * above it shows the result filled with examples straight away.
 *
 * Trax answers through `trax-notification-editor` (a new -v2 style function;
 * it touches no tenant data). A proposed wording is checked with the same
 * validateTemplate the Save uses before it replaces the draft, and Undo puts
 * the previous wording back. Nothing is saved until the page's Save.
 *
 * One conversation per message tab; it resets when another notification is
 * chosen (the page remounts this per item). v2 only.
 */

import { useRef, useState } from "react";
import { Lightbulb, MessageCircleQuestion, Undo2, Wand2 } from "lucide-react";
import { TraxComposer } from "@/components/trax/trax-composer";
import { TraxMark } from "@/components/trax/trax-greeting";
import { SIDEBAR_HIGHLIGHT_FOCUS, SIDEBAR_HIGHLIGHT_HOVER } from "@/components/ui-v2/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { validateTemplate } from "@/lib/notifications-v2/settings-model";
import { getVariable } from "@/lib/notifications-v2/variables";
import type { NotificationChannel, NotificationItem } from "@/lib/notifications-v2/types";
import { cn } from "@/lib/utils";

export const TRAX_NOTIFICATION_FUNCTION = "trax-notification-editor";

export type TraxMessageKind = "email" | "app";

/** The wording Trax works on: email subject + body HTML, or app title + message. */
export interface TraxWording {
  subject?: string;
  title?: string;
  body: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** The wording this turn replaced, for Undo. */
  undo?: TraxWording;
  /** Trax's tap-to-send next steps under its reply. */
  suggestions?: string[];
}

/** The agreement studio's opening (trax-agreement-pane.tsx): Ask / Suggest / Make rows. */
const STARTER_ICON = { Ask: MessageCircleQuestion, Suggest: Lightbulb, Make: Wand2 } as const;

const STARTERS: Record<TraxMessageKind, { group: keyof typeof STARTER_ICON; prompts: string[] }[]> = {
  email: [
    { group: "Ask", prompts: ["Which details can this email fill in?", "How do I show the pickup time?"] },
    { group: "Suggest", prompts: ["Review this email. What's missing?", "Is anything unclear for the reader?"] },
    { group: "Make", prompts: ["Make it friendlier", "Make it shorter", "Add the pickup time"] },
  ],
  app: [
    { group: "Ask", prompts: ["Which details can this message fill in?"] },
    { group: "Suggest", prompts: ["Will this read well on a lock screen?"] },
    { group: "Make", prompts: ["Shorter for the lock screen", "Make it friendlier", "Put the key fact first"] },
  ],
};

const INTRO: Record<TraxMessageKind, string> = {
  email: "Ask about a detail, get a review, or tell me what to change. I handle the variables; you can also click the preview to type. Nothing is kept until you save.",
  app: "This shows on phones and in the bell. Tell me what to change and I'll keep the key fact first; you can also click the preview to type. Nothing is kept until you save.",
};

/** The check's sentence, said the way Trax would say it. */
function blockedReason(message: string | undefined): string {
  const m = String(message ?? "");
  if (/title/i.test(m) && /add/i.test(m)) return "A notification always needs a title: it's the first line people see on the lock screen and in the bell.";
  if (/subject/i.test(m) && /add/i.test(m)) return "An email always needs a subject.";
  if (/message/i.test(m) && /add/i.test(m)) return "An email always needs some text.";
  return m;
}

export function TraxNotificationChat({
  kind,
  item,
  wording,
  onApply,
  canEdit,
  className,
  view,
}: {
  /** What the operator is looking at, told to Trax so it can talk about it. */
  view?: { preview: string; theme: string; company?: string };
  kind: TraxMessageKind;
  item: NotificationItem;
  wording: TraxWording;
  onApply: (next: TraxWording) => void;
  canEdit: boolean;
  className?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Email is checked as email; the app message as push, the stricter of the two it feeds.
  const checkChannel: NotificationChannel = kind === "email" ? "email" : "push";

  const scrollDown = () =>
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !canEdit) return;
    const history = [...turns, { role: "user" as const, content }];
    setTurns(history);
    setBusy(true);
    scrollDown();
    try {
      const { data, error } = await supabase.functions.invoke(TRAX_NOTIFICATION_FUNCTION, {
        body: {
          channel: kind,
          notification: { name: item.name, when: item.when, recipient: item.recipient, tooltip: item.tooltip },
          current: kind === "email" ? { subject: wording.subject ?? "", body: wording.body } : { title: wording.title ?? "", body: wording.body },
          variables: item.variables
            .map((key) => getVariable(key))
            .filter(Boolean)
            .map((v) => ({ key: v!.key, label: v!.label, example: v!.example })),
          messages: history.map(({ role, content: c }) => ({ role, content: c })),
          view,
        },
      });
      if (error) throw error;
      const say = String(data?.say ?? "").trim() || "Done.";
      const suggestions = Array.isArray(data?.suggestions)
        ? (data.suggestions as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3)
        : [];
      const change = data?.change as TraxWording | null;
      if (change) {
        const next: TraxWording = kind === "email"
          ? { subject: change.subject ?? "", body: change.body ?? "" }
          : { title: change.title ?? "", body: change.body ?? "" };
        const check = validateTemplate(checkChannel, next as never, item.variables);
        if (!check.ok) {
          // Never echo a "done" that was not done: say plainly why it was kept.
          setTurns((t) => [
            ...t,
            {
              role: "assistant",
              content: `I couldn't make that change, so I kept the message as it was. ${blockedReason(check.messages[0])}`,
              suggestions,
            },
          ]);
        } else {
          onApply(next);
          setTurns((t) => [...t, { role: "assistant", content: say, undo: wording, suggestions }]);
        }
      } else {
        setTurns((t) => [...t, { role: "assistant", content: say, suggestions }]);
      }
    } catch {
      setTurns((t) => [...t, { role: "assistant", content: "I couldn't reach my writing model just now. Try again in a moment." }]);
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label="Trax" data-trax-notification-chat={kind}>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4" aria-live="polite">
        {turns.length === 0 ? (
          // Plain rows that tint on hover like the main sidebar's items. No boxes, no borders.
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3 px-3">
              <TraxMark size="sm" className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Write it with Trax</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{INTRO[kind]}</p>
              </div>
            </div>
            {canEdit &&
              STARTERS[kind].map((group) => {
                const GroupIcon = STARTER_ICON[group.group];
                return (
                  <div key={group.group} className="space-y-0.5">
                    <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.group}</p>
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={busy}
                        onClick={() => void send(prompt)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors duration-200 ease-out focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none",
                          SIDEBAR_HIGHLIGHT_HOVER,
                          SIDEBAR_HIGHLIGHT_FOCUS,
                        )}
                      >
                        <GroupIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0">{prompt}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <li key={i} className="animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
                {turn.role === "user" ? (
                  <div className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm text-foreground">
                    {turn.content}
                  </div>
                ) : (
                  <div className="flex gap-2.5">
                    <TraxMark size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere]">{turn.content}</p>
                      {turn.undo && canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            onApply(turn.undo!);
                            setTurns((t) => t.map((x, j) => (j === i ? { ...x, undo: undefined } : x)));
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-200 ease-out motion-reduce:transition-none",
                            SIDEBAR_HIGHLIGHT_HOVER,
                          )}
                        >
                          <Undo2 className="size-3.5" aria-hidden="true" />
                          Undo
                        </button>
                      )}
                      {/* Trax's next steps, on its latest reply only. Tap to send. */}
                      {canEdit && !busy && i === turns.length - 1 && turn.suggestions && turn.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {turn.suggestions.map((sug) => (
                            <button
                              key={sug}
                              type="button"
                              onClick={() => void send(sug)}
                              className={cn(
                                "rounded-full bg-primary/[0.07] px-2.5 py-1 text-[12px] font-medium text-foreground transition-colors duration-200 ease-out motion-reduce:transition-none",
                                SIDEBAR_HIGHLIGHT_HOVER,
                              )}
                            >
                              {sug}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <TraxMark size="sm" animated />
                Writing…
              </li>
            )}
          </ol>
        )}
      </div>

      {/* The regular Trax composer (components/trax/trax-composer.tsx). */}
      <div className="px-3 pb-3 pt-1">
        {canEdit ? (
          <TraxComposer
            density="sheet"
            busy={busy}
            capability={null}
            capabilityResolved
            placeholder={kind === "email" ? "Ask Trax to change this email…" : "Ask Trax to change this message…"}
            onSend={(text) => void send(text)}
          />
        ) : (
          <p className="px-3 py-2 text-[12px] text-muted-foreground">View only. Ask an admin to change this message.</p>
        )}
      </div>
    </section>
  );
}
