// Booking email outbox — the durability layer between "money landed" and
// "the customer got an email".
//
// THE TWO HOLES THIS CLOSES
//
// booking-settlement.ts used to decide whether to email by reading the payments
// row (~:210) and then writing it (~:240). That is a non-atomic read-then-write,
// so two overlapping Stripe deliveries — which are routine, Stripe redelivers
// ~15 times and does not order events — BOTH read "not settled" and BOTH sent.
// Worse in the other direction: the row flips to settled BEFORE the notify call,
// so a crash in between loses the email permanently, with nothing in the product
// that would ever notice.
//
// So dispatch is routed through public.booking_email_dispatch instead:
//
//   * ENQUEUE is an upsert on a UNIQUE idempotency_key with ignoreDuplicates.
//     A redelivery inserts nothing. The database, not a prior read, is what
//     decides. Modelled on ghl-strategy-call-webhook/index.ts:258-290.
//   * CLAIM is a compare-and-swap: the UPDATE carries its own status filter, so
//     exactly one concurrent worker can move a row to 'sending'. The FILTER is
//     what serialises, not the values. Modelled on
//     send-strategy-call-email/index.ts:252-262.
//   * FAILURE parks the row at 'failed', which is a DRAINABLE state. The sweeper
//     picks it up again. Nothing is ever stranded.
//
// The enqueue is one DB write and no HTTP, because it runs inside a Stripe
// webhook. Stripe abandons a delivery around 30s and retries — which would
// manufacture the very duplicate this file exists to prevent.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

/** Every email this outbox knows how to send. Adding one means adding a
 *  dispatch branch in sweep-booking-emails AND a default template in
 *  _shared/email-template-service.ts — see the warning on that map. */
export type BookingEmailKey =
  | 'booking_pending'
  | 'booking_documents_required'
  | 'booking_documents_received';

/** Row shape of public.booking_email_dispatch. */
export interface BookingEmailRow {
  id: string;
  tenant_id: string;
  rental_id: string;
  email_key: BookingEmailKey;
  idempotency_key: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';
  attempts: number;
  payload: Record<string, unknown>;
  last_error: string | null;
  provider_message_id: string | null;
  claimed_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The CANONICAL key: one email of each kind per rental, forever.
 *
 * booking-documents-link's resend path deliberately does NOT use this — it
 * appends ':resend:<minute>' precisely so it gets its own row instead of being
 * swallowed by this one's UNIQUE constraint. See handleResend there.
 */
export function outboxKey(emailKey: BookingEmailKey, rentalId: string): string {
  return `${emailKey}:${rentalId}`;
}

/**
 * Queue an email. Safe to call on every webhook delivery.
 *
 * NEVER THROWS. It is called from a path that has already taken the customer's
 * money; a queue hiccup must not turn a successful charge into a failed webhook
 * that Stripe then retries.
 */
export async function enqueueBookingEmail(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    rentalId: string;
    emailKey: BookingEmailKey;
    payload?: Record<string, unknown>;
  },
): Promise<{ enqueued: boolean }> {
  const idempotencyKey = outboxKey(args.emailKey, args.rentalId);
  try {
    const { error } = await supabase.from('booking_email_dispatch').upsert(
      {
        tenant_id: args.tenantId,
        rental_id: args.rentalId,
        email_key: args.emailKey,
        idempotency_key: idempotencyKey,
        payload: args.payload ?? {},
        // No trigger maintains updated_at on this table, so writers set it.
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    if (error) {
      console.error('[email-outbox] enqueue failed:', idempotencyKey, error);
      return { enqueued: false };
    }
    // `enqueued: true` means "a row for this key exists", not "this call
    // inserted it" — ignoreDuplicates makes the two indistinguishable without a
    // second round-trip, and no caller needs to tell them apart.
    return { enqueued: true };
  } catch (error) {
    console.error('[email-outbox] enqueue threw:', idempotencyKey, error);
    return { enqueued: false };
  }
}

/**
 * Take exclusive ownership of a queued email.
 *
 * A returned ROW means you won and you must send. NULL means someone else holds
 * it, or it is already 'sent'/'suppressed' — do nothing and do not treat it as
 * an error.
 *
 * `staleAfterMs` is the crash window: a row left at 'sending' by a worker that
 * died is re-claimable after five minutes. That is what stops an isolated
 * timeout from parking an email forever.
 *
 * Note the two statements. supabase-js cannot express `attempts = attempts + 1`
 * in an .update(), so the current value is read first. That read is NOT the
 * safety mechanism and does not need to be atomic — the .or() filter on the
 * UPDATE is, and it is evaluated by Postgres under row lock. The worst a stale
 * read costs is an attempts counter that under-counts by one.
 */
export async function claimBookingEmail(
  supabase: SupabaseClient,
  idempotencyKey: string,
  staleAfterMs = 300_000,
): Promise<BookingEmailRow | null> {
  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - staleAfterMs).toISOString();

  const { data: current, error: readError } = await supabase
    .from('booking_email_dispatch')
    .select('attempts')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (readError) {
    console.error('[email-outbox] claim pre-read failed:', idempotencyKey, readError);
    return null;
  }
  if (!current) return null;

  const { data, error } = await supabase
    .from('booking_email_dispatch')
    .update({
      status: 'sending',
      claimed_at: nowIso,
      attempts: (current.attempts ?? 0) + 1,
      updated_at: nowIso,
    })
    .eq('idempotency_key', idempotencyKey)
    .or(`status.in.(pending,failed),and(status.eq.sending,claimed_at.lt.${staleCutoff})`)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[email-outbox] claim failed:', idempotencyKey, error);
    return null;
  }
  return (data as BookingEmailRow | null) ?? null;
}

/** Close a row out as delivered. Filtered on 'sending' so only the holder of
 *  the claim can do it. */
export async function markBookingEmailSent(
  supabase: SupabaseClient,
  idempotencyKey: string,
  providerMessageId: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('booking_email_dispatch')
    .update({
      status: 'sent',
      sent_at: nowIso,
      provider_message_id: providerMessageId,
      last_error: null,
      updated_at: nowIso,
    })
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'sending');
  if (error) console.error('[email-outbox] mark sent failed:', idempotencyKey, error);
}

/**
 * Park a row as failed.
 *
 * 'failed' IS DRAINABLE BY DESIGN — the sweeper's next pass re-claims it. That
 * is the whole point: a send that blew up is retried rather than lost, which is
 * the hole the old settle-then-notify ordering left open.
 */
export async function markBookingEmailFailed(
  supabase: SupabaseClient,
  idempotencyKey: string,
  errorMessage: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('booking_email_dispatch')
    .update({
      status: 'failed',
      last_error: String(errorMessage).slice(0, 2000),
      updated_at: nowIso,
    })
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'sending');
  if (error) console.error('[email-outbox] mark failed failed:', idempotencyKey, error);
}
