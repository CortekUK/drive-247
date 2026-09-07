"use client";

/**
 * Attachments on a message.
 *
 * ── why a click and not an href ─────────────────────────────────────────────
 *
 * `chat-attachments` is a PRIVATE bucket, so there is no URL to put in an href.
 * Each row mints a short-lived signed URL when it is clicked. Signing every
 * attachment at render would be dozens of requests for links nobody opens, and
 * each one would start expiring the moment it was created — so by the time
 * somebody scrolled back and clicked, half of them would be dead.
 *
 * Rendered inside ChatMessageBubble, which is shared with the customer-facing
 * side, so this reads its input defensively: every other consumer of that
 * metadata predates the attachments field.
 */

import { useState } from "react";
import { Download, FileText, ImageIcon, Loader2 } from "lucide-react";
import { signedAttachmentUrl, type ChatAttachment } from "@/components/messages-v2/use-chat-attachments";

function prettySize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentList({
  attachments,
  isOwnMessage,
}: {
  attachments: ChatAttachment[];
  isOwnMessage: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function open(a: ChatAttachment) {
    setBusy(a.path);
    setFailed(null);
    const url = await signedAttachmentUrl(a.path);
    setBusy(null);
    if (!url) {
      // Never fail silently: a dead click on a file somebody sent you is the
      // kind of thing that gets reported as "the message is broken".
      setFailed(a.path);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {attachments.map((a) => {
        const isImage = a.mime?.startsWith("image/");
        const Icon = isImage ? ImageIcon : FileText;
        return (
          <button
            key={a.path}
            type="button"
            onClick={() => open(a)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
              isOwnMessage
                ? "bg-primary-foreground/10 hover:bg-primary-foreground/20"
                : "bg-foreground/5 hover:bg-foreground/10"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">{a.name}</span>
              {prettySize(a.size) && (
                <span className="block text-[10px] opacity-60">{prettySize(a.size)}</span>
              )}
            </span>
            {busy === a.path ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
            )}
          </button>
        );
      })}
      {failed && (
        <p className="px-1 text-[10px] text-destructive">
          That file could not be opened. It may have been removed.
        </p>
      )}
    </div>
  );
}
