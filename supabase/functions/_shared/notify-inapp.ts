// Shared helper: create in-app (portal bell) notifications from edge functions.
//
// This writes a BROADCAST notification row (user_id = null) into the
// `notifications` table so every operator of the tenant sees it. The portal
// bell reads rows matching `tenant_id` AND (`user_id = appUser.id` OR
// `user_id IS NULL`), so a null user_id fans the alert out to all staff.
//
// USAGE
// -----
//   import { notifyOperatorsInApp } from "../_shared/notify-inapp.ts";
//
//   await notifyOperatorsInApp({
//     tenantId,
//     type: "payment_received",
//     title: "Payment received",
//     message: `Payment of ${amount} for booking ${ref}`,
//     link: `/rentals/${rentalId}`,
//     metadata: { rental_id: rentalId, payment_id: paymentId, amount },
//     dedupeKey: paymentId, // optional — guards cron/webhook retries
//   });
//
// CONTRACT / GUARANTEES
// ---------------------
//   - The `notifications` table columns are EXACTLY: id, user_id, title,
//     message, type, is_read, link, metadata, created_at, tenant_id. There is
//     NO `data` column — payload always goes in `metadata`.
//   - The insert is UNCONDITIONAL. Portal bell notifications are always-on for
//     every tenant; do NOT gate on any tenant setting/toggle. Email is a
//     separate concern handled elsewhere — this helper never sends email.
//   - When `dedupeKey` is provided, an existing broadcast row of the same
//     `type` carrying that key short-circuits the insert (idempotent for
//     webhook/cron retries).
//   - NEVER THROWS. Any failure is logged and swallowed so a notification
//     problem can never break the flow that triggered it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export interface NotifyOperatorsInAppParams {
  /** Tenant whose operators should receive the bell. Required. */
  tenantId: string;
  /** Notification type slug, e.g. "payment_received", "refund_processed". */
  type: string;
  /** Short bell title. */
  title: string;
  /** Bell body message. */
  message: string;
  /** Optional portal-relative link, e.g. `/rentals/${id}`. */
  link?: string;
  /** Optional structured payload stored in the `metadata` jsonb column. */
  metadata?: Record<string, unknown>;
  /**
   * Optional idempotency key. When set, a matching broadcast row of the same
   * type already carrying this key suppresses a duplicate insert.
   */
  dedupeKey?: string;
}

export async function notifyOperatorsInApp(
  params: NotifyOperatorsInAppParams,
): Promise<void> {
  const { tenantId, type, title, message, link, metadata, dedupeKey } = params;

  try {
    if (!tenantId) {
      console.error("[notify-inapp] missing tenantId, skipping notification");
      return;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // DEDUP: if a broadcast row of this type already carries the dedupe key for
    // this tenant, do not insert again (guards webhook/cron retries).
    if (dedupeKey) {
      const { data: existing, error: dedupeError } = await supabase
        .from("notifications")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("type", type)
        .is("user_id", null)
        .contains("metadata", { dedupe_key: dedupeKey })
        .limit(1);

      if (dedupeError) {
        // Fail open: if the dedupe check itself errors, still attempt the
        // insert rather than silently dropping the notification.
        console.error(
          "[notify-inapp] dedupe check failed, proceeding with insert:",
          dedupeError.message,
        );
      } else if (existing && existing.length > 0) {
        console.log(
          `[notify-inapp] duplicate ${type} for dedupe_key ${dedupeKey} — skipping`,
        );
        return;
      }
    }

    const finalMetadata: Record<string, unknown> = {
      ...(metadata ?? {}),
      ...(dedupeKey ? { dedupe_key: dedupeKey } : {}),
    };

    const { error: insertError } = await supabase.from("notifications").insert({
      tenant_id: tenantId,
      user_id: null, // broadcast: visible to all operators of the tenant
      type,
      title,
      message,
      link: link ?? null,
      metadata: finalMetadata,
      is_read: false,
    });

    if (insertError) {
      console.error(
        "[notify-inapp] failed to insert notification:",
        insertError.message,
      );
      return;
    }

    console.log(
      `[notify-inapp] broadcast notification created for tenant ${tenantId} (type: ${type})`,
    );
  } catch (err) {
    // NEVER THROW — a notification failure must not break the triggering flow.
    console.error("[notify-inapp] unexpected error, swallowing:", err);
    return;
  }
}
