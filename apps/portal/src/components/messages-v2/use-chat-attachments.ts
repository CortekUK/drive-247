"use client";

/**
 * Chat attachments — upload, and read back.
 *
 * ── the bucket ──────────────────────────────────────────────────────────────
 *
 * `chat-attachments`, private, 10MB, with the same shape every other private
 * bucket in this project uses: THE FIRST PATH SEGMENT IS THE TENANT ID, and all
 * four storage policies check it —
 *
 *   (storage.foldername(name))[1] = get_user_tenant_id()  OR  is_super_admin()
 *
 * so one tenant cannot read another's files while holding a perfectly valid
 * session. That is copied from `expense-receipts` rather than invented, because
 * a bespoke rule on one bucket is how a gap appears in the one nobody re-reads.
 *
 * ── why signed URLs and not a public bucket ─────────────────────────────────
 *
 * Half the buckets here are public, which is fine for vehicle photos. These are
 * files an operator and a customer exchanged; a public URL is a bearer token
 * that never expires and leaks through logs, referrers and screenshots. Reads
 * go through short-lived signed URLs instead, minted on demand.
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export const CHAT_BUCKET = "chat-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The outcome of an upload. See the note on `upload` for why it is one shape. */
export interface UploadResult {
  ok: boolean;
  attachments?: ChatAttachment[];
  error?: string;
}

/** What rides along on the message. Paths, never URLs — see above. */
export interface ChatAttachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

/** Storage object keys must be predictable and collision-free. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export function useChatAttachments() {
  const { tenant } = useTenant();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  /**
   * Upload every file, or fail the whole send.
   *
   * Deliberately all-or-nothing: a message that arrives naming three files and
   * carrying two is worse than one that did not send, because nobody can tell
   * which is missing. The caller keeps the composer contents on failure.
   */
  const upload = useCallback(
    /* ONE SHAPE, not a discriminated union. This portal compiles with
       `strict: false`, where narrowing a union on a boolean-literal
       discriminant does not reliably apply — `if (!up.ok)` left the caller
       still holding the whole union and unable to read `error`. A single
       optional-field result sidesteps the question, and matches SendResult. */
    async (channelId: string, files: File[]): Promise<UploadResult> => {
      if (!files.length) return { ok: true, attachments: [] };
      if (!tenant?.id) return { ok: false, error: "No account context — reload and try again." };

      const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
      if (tooBig) {
        return {
          ok: false,
          error: `"${tooBig.name}" is larger than 10MB. The bucket refuses it, so it is caught here with a sentence instead.`,
        };
      }

      setUploading(true);
      setProgress({ done: 0, total: files.length });
      const done: ChatAttachment[] = [];
      try {
        for (const file of files) {
          const path = `${tenant.id}/${channelId}/${crypto.randomUUID()}-${safeName(file.name)}`;
          const { error } = await supabase.storage
            .from(CHAT_BUCKET)
            .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
          if (error) {
            /* Roll back what already landed. Orphaned objects in a private
               bucket are invisible and bill forever. */
            if (done.length) {
              await supabase.storage.from(CHAT_BUCKET).remove(done.map((a) => a.path));
            }
            return { ok: false, error: `"${file.name}" could not be uploaded: ${error.message}` };
          }
          done.push({
            name: file.name,
            path,
            size: file.size,
            mime: file.type || "application/octet-stream",
          });
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
        return { ok: true, attachments: done };
      } finally {
        setUploading(false);
      }
    },
    [tenant?.id],
  );

  return { upload, uploading, progress };
}

/**
 * A short-lived link to one attachment.
 *
 * Minted per click rather than per render: signing every attachment in a long
 * conversation would be dozens of requests for links nobody opens, and each one
 * would start expiring the moment it was created.
 */
export async function signedAttachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(path, 300);
  if (error) {
    console.error("[chat-attachments] could not sign", path, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Read attachments off a message's metadata, tolerating anything else there. */
export function attachmentsFrom(metadata: unknown): ChatAttachment[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is ChatAttachment =>
      !!a && typeof a === "object" &&
      typeof (a as ChatAttachment).path === "string" &&
      typeof (a as ChatAttachment).name === "string",
  );
}
