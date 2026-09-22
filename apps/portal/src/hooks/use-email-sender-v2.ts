import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { EMAIL_SENDER_DOMAIN, type EmailSenderSettings } from "@/lib/notifications-v2/types";
import { isValidEmail, isValidLocalPart } from "@/lib/notifications-v2/settings-model";
import {
  NotificationStorageMissingError,
  isMissingTableError,
  toOperatorError,
} from "@/hooks/use-notification-settings-v2";

/**
 * Notifications v2: who the tenant's emails come from (table
 * public.tenant_email_sender, one row per tenant; ops/notifications_v2.sql).
 *
 * The domain is fixed (@drive-247.com); the tenant chooses the display name,
 * the part before the @ (which must be their slug or start with it), and an
 * optional reply-to. NULL = today's default, "{company_name} <{slug}@drive-247.com>"
 * (settings-model `senderAddress`). CC is not built (build-spec D13).
 *
 * Nothing sends with these settings yet except Send test (build-spec D18).
 * Same rules as use-notification-settings-v2: tenant filter on every query,
 * `{ error }` checked, a missing table is `tableMissing`, not an error.
 */

export const EMAIL_SENDER_V2_TABLE = "tenant_email_sender";
export const EMAIL_SENDER_NAME_MAX = 100;

export const emailSenderV2QueryKey = (tenantId: string | null | undefined) => ["email-sender-v2", tenantId] as const;

/** No row, or every field at its default. */
export const EMPTY_EMAIL_SENDER: EmailSenderSettings = Object.freeze({
  from_name: null,
  from_local_part: null,
  reply_to: null,
});

interface SenderData {
  sender: EmailSenderSettings;
  tableMissing: boolean;
}

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * What will be stored: trimmed, blanks as NULL (= default), checked the same
 * way the table's CHECKs and trigger check it so the operator gets a sentence
 * instead of a constraint name. Throws an Error with an operator-facing message.
 */
export function prepareEmailSender(
  settings: Partial<EmailSenderSettings> | null | undefined,
  slug: string | null | undefined,
): EmailSenderSettings {
  const fromName = textOrNull(settings?.from_name);
  const local = textOrNull(settings?.from_local_part);
  const replyTo = textOrNull(settings?.reply_to);

  if (fromName !== null) {
    if (/[\x00-\x1f\x7f]/.test(fromName)) throw new Error("Keep the sender name on one line.");
    if (fromName.length > EMAIL_SENDER_NAME_MAX) {
      throw new Error(`Keep the sender name to ${EMAIL_SENDER_NAME_MAX} characters or fewer.`);
    }
  }
  if (local !== null) {
    const check = isValidLocalPart(local, slug);
    if (!check.ok) throw new Error(check.reason ?? `Check the part before @${EMAIL_SENDER_DOMAIN}.`);
  }
  if (replyTo !== null && !isValidEmail(replyTo)) {
    throw new Error("Enter one reply-to address, like name@example.com.");
  }
  return { from_name: fromName, from_local_part: local, reply_to: replyTo };
}

export function useEmailSenderV2() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id ?? null;
  const queryKey = emailSenderV2QueryKey(tenantId);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<SenderData> => {
      const { data, error } = await (supabase as any)
        .from(EMAIL_SENDER_V2_TABLE)
        .select("from_name, from_local_part, reply_to")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) return { sender: EMPTY_EMAIL_SENDER, tableMissing: true };
        throw toOperatorError(error, "Couldn't load your email sender. Try again in a moment.");
      }
      return {
        sender: data
          ? {
              from_name: typeof data.from_name === "string" ? data.from_name : null,
              from_local_part: typeof data.from_local_part === "string" ? data.from_local_part : null,
              reply_to: typeof data.reply_to === "string" ? data.reply_to : null,
            }
          : EMPTY_EMAIL_SENDER,
        tableMissing: false,
      };
    },
    enabled: !!tenant,
    retry: 1,
  });

  const saveMutation = useMutation({
    mutationFn: async (settings: Partial<EmailSenderSettings>) => {
      if (!tenantId) throw new Error("Your account details haven't loaded yet. Try again in a moment.");
      const row = { tenant_id: tenantId, ...prepareEmailSender(settings, tenant?.slug) };
      try {
        // The row carries this tenant's id and the upsert is keyed on it, so it
        // can only ever write this tenant's sender.
        const { data, error } = await (supabase as any)
          .from(EMAIL_SENDER_V2_TABLE)
          .upsert(row, { onConflict: "tenant_id" })
          .select("tenant_id");
        if (error) {
          if (isMissingTableError(error)) throw new NotificationStorageMissingError();
          // The trigger's slug rule (23514 on tes_from_local_part_slug).
          if (error.code === "23514" && /slug/i.test(String(error.message ?? "") + String(error.details ?? ""))) {
            const slug = String(tenant?.slug ?? "").toLowerCase();
            throw new Error(`Start the address with "${slug}", then a dot or an underscore if you add more, for example ${slug} or ${slug}.bookings.`);
          }
          throw toOperatorError(error, "Couldn't save your email sender. Try again in a moment.");
        }
        if (!Array.isArray(data) || data.length !== 1) {
          throw new Error("Your email sender wasn't saved. Refresh the page and try again.");
        }
      } finally {
        await queryClient.invalidateQueries({ queryKey: emailSenderV2QueryKey(tenantId) });
      }
    },
  });

  const { mutateAsync } = saveMutation;
  /** Saves the sender. Blank fields go back to the default. Rejects with an operator-facing message. */
  const save = useCallback((settings: Partial<EmailSenderSettings>): Promise<void> => mutateAsync(settings), [mutateAsync]);

  return {
    /** The saved sender (all NULL = default); null until it has loaded. */
    sender: query.data?.sender ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    tableMissing: query.data?.tableMissing === true,
    refetch: query.refetch,
    save,
    isSaving: saveMutation.isPending,
  };
}
