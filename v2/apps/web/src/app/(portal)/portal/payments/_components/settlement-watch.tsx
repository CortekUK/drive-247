'use client';

/**
 * Watching a card payment turn into a settled balance.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * Stripe answering `succeeded` and the customer's balance going down are two
 * different events separated by a webhook. `stripe-webhook-test` is what marks
 * the payments row Completed, flips `rentals.payment_status` and drops
 * `ledger_entries.remaining_amount`. Until it lands, the page still shows the
 * old balance — so a customer who has just paid would watch their money leave
 * and the amount owed stay exactly where it was.
 *
 * The honest fix is to say which of the two has happened. This component
 * reports three states and never guesses:
 *
 *   watching — the card was charged; we are waiting for settlement to show up
 *   settled  — we have SEEN the balance drop, not assumed it
 *   slow     — we stopped waiting. The money is taken and settlement will
 *              follow; we simply will not pretend to know when.
 *
 * ── WHY POLLING, NOT REALTIME ───────────────────────────────────────────────
 * Supabase Realtime is the obvious tool and it does not work here: STAGING'S
 * `supabase_realtime` PUBLICATION IS EMPTY, so no table emits anything and a
 * subscription would sit silent forever while looking perfectly healthy. That
 * is the worst failure mode available — a spinner that never resolves — so this
 * polls instead. Polling is also the more robust choice on its own merits: it
 * survives a dropped socket, and it costs four cached queries every few seconds
 * for at most half a minute.
 *
 * ── WHY NOT WRITE THE RESULT FROM THE BROWSER ───────────────────────────────
 * Nothing here writes. The browser has no business marking a payment settled:
 * it does not know whether the charge actually cleared, and a client that
 * writes payment state is a client that can be made to lie. The webhook is the
 * only writer; this component's entire job is to notice what it did. That is
 * also why the runtime check for this feature closes the browser tab BEFORE
 * verifying the database — settlement must not depend on anyone watching.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/** How often to re-read the balance while waiting. */
const POLL_MS = 3_000;

/**
 * How long to keep waiting before saying so.
 *
 * A test-mode webhook normally lands in under five seconds. Thirty is generous
 * enough that reaching it means something is genuinely wrong (a webhook
 * misrouted, a signature rejected) rather than merely slow — and at that point
 * the truthful thing is to stop spinning and say the money is taken.
 */
const GIVE_UP_MS = 30_000;

export type SettlementPhase = 'watching' | 'settled' | 'slow';

/**
 * Poll until the balance moves.
 *
 * `settled` is supplied by the caller rather than computed here, because only
 * the page knows what "moved" means for the booking being watched — see
 * `PaymentsPage`, which compares the booking's current payable amount against
 * the amount that was actually charged. Passing the answer in keeps this
 * component ignorant of the ledger, and keeps the comparison in the one place
 * that has both numbers.
 */
export function useSettlementWatch(
  active: boolean,
  settled: boolean,
  refetch: () => Promise<void>,
): SettlementPhase {
  const [phase, setPhase] = useState<SettlementPhase>('watching');

  // The refetch identity is not guaranteed stable across renders; holding it in
  // a ref keeps it out of the effect's deps so a re-render cannot restart the
  // timer and reset the give-up clock.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!active) {
      setPhase('watching');
      return;
    }
    if (settled) {
      setPhase('settled');
      return;
    }

    setPhase('watching');
    const startedAt = Date.now();
    let stopped = false;

    const timer = window.setInterval(() => {
      if (stopped) return;
      if (Date.now() - startedAt >= GIVE_UP_MS) {
        setPhase('slow');
        window.clearInterval(timer);
        return;
      }
      // Errors are swallowed on purpose: a failed poll is not news the customer
      // can act on, and the next tick retries. A genuine load failure is already
      // reported by the page's own error panel.
      void refetchRef.current().catch(() => undefined);
    }, POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, settled, refetch]);

  return phase;
}

/**
 * The three states, rendered the same whether they appear inside the payment
 * dialog or on the page after the customer has closed it.
 */
export function SettlementNotice({
  phase,
  className,
}: {
  phase: SettlementPhase;
  className?: string;
}) {
  if (phase === 'settled') {
    return (
      <div
        className={cn(
          'flex items-start gap-2.5 rounded-[12px] border border-success-med bg-success-light px-3 py-2.5 text-left',
          className,
        )}
      >
        <CheckCircle2
          aria-hidden
          strokeWidth={1.75}
          className="mt-px size-4 shrink-0 text-success"
        />
        <p className="text-xs leading-relaxed text-brand-text-soft">
          Your balance has been updated — this booking is now settled.
        </p>
      </div>
    );
  }

  if (phase === 'slow') {
    return (
      <div
        className={cn(
          'flex items-start gap-2.5 rounded-[12px] border border-brand-border-soft bg-brand-stone/45 px-3 py-2.5 text-left',
          className,
        )}
      >
        <Clock
          aria-hidden
          strokeWidth={1.75}
          className="mt-px size-4 shrink-0 text-brand-text-subtle"
        />
        <p className="text-xs leading-relaxed text-brand-text-soft">
          Your payment went through, but your balance has not updated yet. This
          usually catches up within a few minutes — there is nothing more to do,
          and you will not be charged twice. Contact us if it is still showing
          tomorrow.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[12px] border border-brand-border-soft bg-brand-stone/45 px-3 py-2.5 text-left',
        className,
      )}
    >
      <Loader2
        aria-hidden
        strokeWidth={1.75}
        className="mt-px size-4 shrink-0 animate-spin text-brand-text-subtle"
      />
      <p className="text-xs leading-relaxed text-brand-text-soft">
        Updating your balance…
      </p>
    </div>
  );
}
