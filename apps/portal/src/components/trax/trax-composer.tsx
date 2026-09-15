"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AlertCircle, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import type { ChatAttachment, TraxAttachmentCapability } from "@/types/chat";
import { ATTACH_EXTENSIONS, AttachmentChip, prepareAttachments } from "./trax-attachments";

/**
 * The Trax composer — one large rounded card, Claude-style.
 *
 * Inside, top to bottom: attached files, the auto-growing textarea, and a row
 * with the attach button on the left and send on the right. Nothing underneath
 * it: the "Trax can make mistakes…" / keyboard-hint line was removed on the
 * lead's instruction, and it is not to come back as helper text.
 *
 * THE AI VIBE, KEPT TO TWO GRADIENTS: a soft iridescent ring and glow that
 * appear only while the composer has focus, and the send button. Both are
 * `--chart-2` / `--primary` / `--chart-4`, so they follow the tenant's brand,
 * and the fade is dropped under reduced motion.
 *
 * ATTACHMENTS ARE GATED ON THE RUNNING FUNCTION (see trax-attachments.tsx):
 * with no capability the + button is visibly switched off and explains why,
 * paste falls through to plain text, and a dropped file is swallowed rather
 * than navigating the tab away.
 */

export interface TraxComposerProps {
  density: "sheet" | "page";
  busy: boolean;
  capability: TraxAttachmentCapability | null;
  capabilityResolved: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  className?: string;
}

/** Tailwind `max-h-60` — the textarea grows to this, then scrolls. */
const MAX_TEXTAREA_PX = 240;

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function TraxComposer({
  density,
  busy,
  capability,
  capabilityResolved,
  autoFocus = false,
  placeholder = "Ask Trax anything…",
  onSend,
  className,
}: TraxComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  /* Adds are chained, and each reads the latest list from this ref, so two
     quick pastes cannot race and overwrite each other's files. */
  const attachmentsRef = useRef<ChatAttachment[]>(attachments);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const page = density === "page";
  const canAttach = !!capability;
  const canSend = !busy && !preparing && (draft.trim().length > 0 || attachments.length > 0);

  const replaceAttachments = (next: ChatAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  /* Grow with the text up to MAX_TEXTAREA_PX, then scroll inside. */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [draft]);

  /* Focus when the surface opens — but only where a keyboard is the main
     input. On a phone it would throw the on-screen keyboard over the greeting
     the moment Trax opens. */
  useEffect(() => {
    if (!autoFocus) return;
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: fine)").matches) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!capability || files.length === 0) return;
      queueRef.current = queueRef.current.then(async () => {
        setPreparing(true);
        try {
          const { next, errors: problems } = await prepareAttachments(files, attachmentsRef.current, capability);
          replaceAttachments(next);
          setErrors(problems);
        } finally {
          setPreparing(false);
        }
      });
    },
    [capability],
  );

  const removeAttachment = (id: string) => {
    replaceAttachments(attachmentsRef.current.filter((a) => a.id !== id));
    setErrors([]);
  };

  const submit = () => {
    if (!canSend) return;
    onSend(draft.trim(), attachments);
    setDraft("");
    replaceAttachments([]);
    setErrors([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    /* Enter sends, Shift+Enter breaks the line. `isComposing` guards IME input:
       without it, committing a character with Enter would send a half-typed
       message for anyone typing a non-Latin script. */
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttach) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    /* A copied spreadsheet range arrives as text AND as a picture of that
       text. The text is what the operator meant; let it paste normally. */
    if (e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    addFiles(files);
  };

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!canAttach) return;
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canAttach ? "copy" : "none";
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e) || !canAttach) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    /* Always swallowed: an unhandled file drop makes the browser open the file
       in place of the portal. */
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!canAttach) return;
    addFiles(Array.from(e.dataTransfer.files));
  };

  const attachHint = canAttach
    ? "Attach images or text files"
    : capabilityResolved
      ? "File attachments aren't switched on yet"
      : "Checking whether Trax can take files…";

  return (
    <div
      data-slot="trax-composer"
      data-dragging={dragging ? "true" : undefined}
      className={cn("group/composer relative w-full", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Glow: an iridescent blur behind the card, only while focused. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-1 rounded-[1.75rem] blur-xl transition-opacity duration-500 motion-reduce:transition-none",
          "bg-[linear-gradient(135deg,hsl(var(--chart-2)/0.5),hsl(var(--primary)/0.3),hsl(var(--chart-4)/0.45))]",
          dragging ? "opacity-100" : "opacity-0 group-focus-within/composer:opacity-70",
        )}
      />

      <div className="relative rounded-[calc(1.5rem+1.5px)] p-[1.5px]">
        {/* Ring: the same gradient, 1.5px around the card, only while focused. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300 motion-reduce:transition-none",
            "bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)),hsl(var(--chart-4)))]",
            dragging ? "opacity-100" : "opacity-0 group-focus-within/composer:opacity-100",
          )}
        />

        <div
          className={cn(
            "relative rounded-3xl bg-card shadow-[0_10px_36px_-14px_hsl(var(--primary)/0.35)]",
            "dark:shadow-[0_10px_36px_-14px_hsl(var(--chart-2)/0.3)]",
          )}
        >
          {(attachments.length > 0 || preparing) && (
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
              {preparing && (
                <span className="inline-flex h-9 items-center gap-1.5 rounded-2xl bg-muted/70 px-3 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                  Preparing…
                </span>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <div role="alert" className="flex items-start gap-2 px-4 pt-3 text-[12px] leading-5 text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                {errors.map((msg, i) => (
                  <p key={i}>{msg}</p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setErrors([])}
                aria-label="Dismiss"
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={placeholder}
            aria-label="Ask Trax"
            className={cn(
              "no-scrollbar block max-h-60 w-full resize-none overflow-y-auto bg-transparent px-4 text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground",
              page ? "min-h-[52px] pb-1 pt-4" : "min-h-10 pb-1 pt-3",
            )}
          />

          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                {/* aria-disabled, not disabled: a disabled button swallows the
                    hover and focus the tooltip needs to explain itself. */}
                <button
                  type="button"
                  aria-label={canAttach ? "Attach files" : attachHint}
                  aria-disabled={canAttach ? undefined : true}
                  onClick={() => {
                    if (canAttach) fileInputRef.current?.click();
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    canAttach ? "hover:bg-muted hover:text-foreground" : "cursor-not-allowed opacity-50",
                  )}
                >
                  <Plus className="size-[18px]" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{attachHint}</TooltipContent>
            </Tooltip>

            {capability && (
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                tabIndex={-1}
                accept={[...capability.imageTypes, ...capability.textTypes, ...ATTACH_EXTENSIONS].join(",")}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  addFiles(files);
                }}
              />
            )}

            {page && (
              <span className="ml-auto hidden items-center gap-1.5 pr-1 text-[11px] text-muted-foreground sm:inline-flex">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)))]"
                />
                Live business data
              </span>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={busy ? "Trax is replying" : "Send"}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,color,box-shadow]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                !page && "ml-auto",
                page && "max-sm:ml-auto",
                canSend
                  ? "bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)))] text-primary-foreground shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.6)] hover:brightness-110"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
              )}
            </button>
          </div>

          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl bg-card/90 text-[13px] font-medium text-primary dark:text-[hsl(var(--chart-1))]">
              Drop to attach
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
