'use client';

import { ExternalLink, Receipt } from 'lucide-react';
import type { TraxPaymentCard, TraxPaymentExplanation, TraxPaymentTotal } from '@/types/trax-support';
import { SIDEBAR_HIGHLIGHT_FOCUS, SIDEBAR_HIGHLIGHT_HOVER } from '@/components/ui-v2/sidebar';

const RESULT_LABEL = {
  verified: 'Verified in Stripe',
  discrepancy: 'Differences found',
  offline: 'Not a Stripe payment',
  unable: 'Could not verify',
} as const;
const RESULT_TONE = {
  verified: 'border-emerald-500/30 bg-emerald-500/5',
  discrepancy: 'border-amber-500/40 bg-amber-500/5',
  offline: 'border-border/60 bg-background/60',
  unable: 'border-amber-500/30 bg-background/60',
} as const;

/** Payment cards render only backend-verified values. Links are the server-built, hook-validated actions. */
export function PaymentEvidence({ cards, totals, explanations }: { cards: TraxPaymentCard[]; totals?: TraxPaymentTotal[]; explanations?: TraxPaymentExplanation[] }) {
  const facts = explanations?.filter((item) => item.kind === 'evidence') ?? [];
  const suggestions = explanations?.filter((item) => item.kind === 'suggestion') ?? [];
  return (
    <div className="w-full space-y-2 text-xs">
      {cards.map((card) => (
        <div key={card.paymentId} className={`rounded-lg border p-3 ${RESULT_TONE[card.verification.result]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Payment {card.reference.internal}</p>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-medium">{RESULT_LABEL[card.verification.result]}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {card.amount && (<><dt className="text-muted-foreground">Amount</dt><dd className="break-words">{card.amount.display}</dd></>)}
            {card.date && (<><dt className="text-muted-foreground">Date</dt><dd className="break-words">{card.date.display}</dd></>)}
            <dt className="text-muted-foreground">Drive247</dt><dd className="break-words">{card.drive247Status}</dd>
            {card.stripeStatus && (<><dt className="text-muted-foreground">Stripe</dt><dd className="break-words">{card.stripeStatus}</dd></>)}
            {card.account && (<><dt className="text-muted-foreground">Account</dt><dd className="break-words">{card.account.label} · {card.account.mode === 'live' ? 'Live' : 'Test'} mode</dd></>)}
            {card.reference.stripe && (<><dt className="text-muted-foreground">Stripe ref</dt><dd className="break-all font-mono text-[11px]">{card.reference.stripe}</dd></>)}
          </dl>
          <p className="mt-2">{card.verification.detail}</p>
          {card.limitation && <p className="mt-1 text-muted-foreground">{card.limitation}</p>}
          {card.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {card.actions.map((action) => (
                <a
                  key={action.href}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={action.note}
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${SIDEBAR_HIGHLIGHT_HOVER} ${SIDEBAR_HIGHLIGHT_FOCUS}`}
                >
                  {action.kind === 'receipt' ? <Receipt className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  {action.label}
                </a>
              ))}
            </div>
          )}
          {card.actions.filter((action) => action.kind === 'stripe_dashboard').map((action) => (
            <p key={`note-${action.href}`} className="mt-1 text-muted-foreground">{action.note}</p>
          ))}
        </div>
      ))}
      {!!totals?.length && (
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="font-medium">Verified in Stripe</p>
          <ul className="mt-1 space-y-1">
            {totals.map((total) => (
              <li key={total.currency}>{total.currency}: captured {total.captured} · refunded {total.refunded} · authorized, not captured {total.heldNotCaptured}</li>
            ))}
          </ul>
        </div>
      )}
      {facts.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="font-medium">What I verified</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{facts.map((item, index) => <li key={index}>{item.text}</li>)}</ul>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed border-border/60 p-3">
          <p className="font-medium">Things you can check</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{suggestions.map((item, index) => <li key={index}>{item.text}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
