import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * OPERATOR/ADMIN email notification preferences.
 *
 * Reads/writes:
 *  - tenants.email_notifications_enabled  (master switch)
 *  - tenants.notification_recipient_email (editable recipient; blank => defaults
 *    at send-time to contact_email -> admin_email -> env ADMIN_EMAIL)
 *  - email_notification_prefs rows, one per category (missing row = disabled)
 *
 * This ONLY controls operator/admin emails. Customer emails and the always-on
 * in-app bell are untouched.
 */

export const EMAIL_NOTIFICATION_CATEGORIES = [
  "bookings",
  "payments",
  "insurance",
  "returns",
  "verification",
  "fines",
] as const;

export type EmailNotificationCategory =
  (typeof EMAIL_NOTIFICATION_CATEGORIES)[number];

export interface EmailNotificationPrefs {
  masterEnabled: boolean;
  recipientEmail: string;
  contactEmail: string;
  categories: Record<EmailNotificationCategory, boolean>;
}

function emptyCategories(): Record<EmailNotificationCategory, boolean> {
  return EMAIL_NOTIFICATION_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = false;
      return acc;
    },
    {} as Record<EmailNotificationCategory, boolean>
  );
}

export function useEmailNotificationPrefs() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["email-notification-prefs", tenant?.id];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<EmailNotificationPrefs> => {
      const tenantId = tenant!.id;

      const [tenantRes, prefsRes] = await Promise.all([
        (supabase as any)
          .from("tenants")
          .select(
            "email_notifications_enabled, notification_recipient_email, contact_email"
          )
          .eq("id", tenantId)
          .single(),
        (supabase as any)
          .from("email_notification_prefs")
          .select("category, is_enabled")
          .eq("tenant_id", tenantId),
      ]);

      if (tenantRes.error) throw tenantRes.error;
      if (prefsRes.error) throw prefsRes.error;

      const categories = emptyCategories();
      for (const row of (prefsRes.data || []) as Array<{
        category: string;
        is_enabled: boolean;
      }>) {
        if ((EMAIL_NOTIFICATION_CATEGORIES as readonly string[]).includes(row.category)) {
          categories[row.category as EmailNotificationCategory] =
            row.is_enabled === true;
        }
      }

      return {
        masterEnabled: tenantRes.data?.email_notifications_enabled === true,
        recipientEmail: tenantRes.data?.notification_recipient_email ?? "",
        contactEmail: tenantRes.data?.contact_email ?? "",
        categories,
      };
    },
    enabled: !!tenant,
    staleTime: 30_000,
  });

  const setMasterEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await (supabase as any)
        .from("tenants")
        .update({ email_notifications_enabled: enabled })
        .eq("id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const setRecipientEmail = useMutation({
    mutationFn: async (email: string) => {
      const trimmed = email.trim();
      const { error } = await (supabase as any)
        .from("tenants")
        .update({ notification_recipient_email: trimmed === "" ? null : trimmed })
        .eq("id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const setCategoryEnabled = useMutation({
    mutationFn: async ({
      category,
      enabled,
    }: {
      category: EmailNotificationCategory;
      enabled: boolean;
    }) => {
      const { error } = await (supabase as any)
        .from("email_notification_prefs")
        .upsert(
          {
            tenant_id: tenant!.id,
            category,
            is_enabled: enabled,
          },
          { onConflict: "tenant_id,category" }
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    prefs: query.data,
    isLoading: query.isLoading,
    error: query.error,
    setMasterEnabled,
    setRecipientEmail,
    setCategoryEnabled,
  };
}
