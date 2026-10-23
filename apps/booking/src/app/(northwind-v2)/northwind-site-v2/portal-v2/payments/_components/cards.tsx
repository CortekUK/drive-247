'use client';

/**
 * Card management on Finances — the operator's (billing-page-v2.tsx +
 * card-manager-dialog-v2.tsx), for the customer's own cards:
 *
 *   - the default card drawn as the operator's 3D card face, which opens
 *     "Cards" (or an "Add a card" face when there is none);
 *   - the Cards dialog: one row per card (thumbnail, "Visa •••• 4242",
 *     "Expires 12/29 · Name"), Remove, and the star that marks — and makes —
 *     the default; "Add card" at its foot;
 *   - Add card: the operator's two columns, the card face on the left and the
 *     form on the right. The form is Stripe's Payment Element, not raw inputs:
 *     the card number never touches our code.
 *
 * Data: `useCustomerCards` → the `customer-cards` edge function, which works
 * out the customer from the sign-in. The default card is the one the tenant's
 * charges and instalment plans use.
 */

import { useEffect, useMemo, useState } from 'react';
import { CardCvcElement, CardExpiryElement, CardNumberElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';

import { Dialog } from '@nw/components/ui/dialog';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerCards, type CardSetup, type CustomerCard } from '@nw/hooks/use-customer-cards';
import { getStripeForAccount } from '@nw/lib/stripe/load-stripe';
import { cn } from '@nw/lib/utils';
import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';
import { resolvePvColours, V2_ELEMENTS_FONTS } from '@nw/site-v2/booking/payment-panel';
import { FEATURED_SHELL_CLASS } from '@portal-v2-shared/featured-card';
import { cardBrandLabel } from '@portal-v2-shared/payment-card/card-brand-icon';
import { CardThumb, PaymentCard3D } from '@portal-v2-shared/payment-card/payment-card-3d';

const LINK =
  'cursor-pointer text-sm text-pv-link transition-opacity duration-200 ease-out hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const PRIMARY_BUTTON =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-pv-primary px-4 text-sm font-medium text-pv-primary-fg transition-colors duration-200 hover:bg-pv-primary/85 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

const QUIET_BUTTON =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-pv-border px-4 text-sm font-medium text-pv-fg transition-colors duration-200 hover:bg-pv-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

function expiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null;
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

/**
 * The card on file, in the hero row's featured slot: the default card's face,
 * which opens "Cards", or an "Add a card" face when there is none.
 *
 * The slot is the operator's featured card (FeaturedCardShell, passed
 * `lg:min-h-0` as finances-overview.tsx passes FeaturedDeck): a panel that
 * fills the row from the top of the graph's header line to the bottom of the
 * plot, so its edges ARE the graph's edges. The card face sits inside it,
 * sized to the room left (`fit`, as Billing does).
 */
export function CardsFeatured() {
  const { cards, isLoading, isError, error } = useCustomerCards();
  const [open, setOpen] = useState(false);
  const primary = cards.find((card) => card.isDefault) ?? cards[0] ?? null;

  return (
    <div className={cn(FEATURED_SHELL_CLASS, 'items-center justify-center p-4 lg:min-h-0')}>
      <div className="flex w-full min-h-0 flex-1 items-center justify-center md:[container-type:size]">
      {isLoading ? (
        <div className="aspect-[1.586] w-full max-w-[440px] animate-pulse rounded-2xl bg-pv-muted" aria-hidden />
      ) : isError ? (
        <p className="text-sm text-pv-danger">{error?.message ?? 'Your cards could not be loaded.'}</p>
      ) : primary && primary.last4 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Manage cards"
          className="group block w-full max-w-[440px] cursor-pointer rounded-2xl text-left md:w-fit md:max-w-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 focus-visible:ring-offset-2"
        >
          <PaymentCard3D
            brand={primary.brand}
            last4={primary.last4}
            expMonth={primary.expMonth}
            expYear={primary.expYear}
            name={primary.name}
            isPrimary={primary.isDefault}
            actionLabel={cards.length > 1 ? `Manage ${cards.length} cards` : 'Manage card'}
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex aspect-[1.586] w-full max-w-[440px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-pv-border bg-pv-card text-center transition-colors duration-200 hover:border-pv-primary/40 hover:bg-pv-hover/40 motion-reduce:transition-none"
        >
          <span className="text-[15px] font-semibold text-pv-link">Add a card</span>
          <span className="text-[13px] text-pv-muted-fg">No card on file yet</span>
        </button>
      )}
      </div>
      <CardManagerDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** "Cards": the list, and Add card in the same dialog. */
export function CardManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { cards, setDefault, remove } = useCustomerCards();
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = setDefault.isPending || remove.isPending;
  const defaultCard = cards.find((card) => card.isDefault && card.last4) ?? null;

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setAdding(false);
      setProblem(null);
    }
  };

  const run = (promise: Promise<unknown>) => {
    setProblem(null);
    promise.catch((err: unknown) => setProblem(err instanceof Error ? err.message : 'That did not work. Please try again.'));
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <PvDialogContent className={cn('max-h-[85vh] gap-0 overflow-hidden p-0 sm:p-0', adding ? 'sm:max-w-4xl' : 'sm:max-w-2xl')}>
        <PvDialogHeader
          className="shrink-0 px-8 pb-3 pt-8 text-left"
          title={adding ? 'Add card' : 'Cards'}
          description={adding ? 'Card details go straight to Stripe. We never see the number.' : 'The starred card is the one we charge.'}
          status={
            adding ? (
              <PvStatus tone="info">Secured by Stripe</PvStatus>
            ) : defaultCard ? (
              <PvStatus tone="success">Default card</PvStatus>
            ) : (
              <PvStatus tone="neutral">No card</PvStatus>
            )
          }
        />

        {adding ? (
          <AddCardForm
            hasCards={cards.length > 0}
            onCancel={() => setAdding(false)}
            onAdded={() => setAdding(false)}
          />
        ) : (
          <>
            <div className="min-h-0 overflow-y-auto px-8 pb-2 pt-2">
              {cards.length === 0 ? (
                <p className="py-6 text-sm text-pv-muted-fg">No card on file yet. Add one so your bookings can be charged.</p>
              ) : (
                <ul className="divide-y divide-pv-border/60">
                  {cards.map((card) => (
                    <CardRow
                      key={card.id}
                      card={card}
                      busy={busy}
                      onMakeDefault={() => run(setDefault.mutateAsync(card.id))}
                      onRemove={() => run(remove.mutateAsync(card.id))}
                    />
                  ))}
                </ul>
              )}
              {problem ? <p className="pb-3 text-[13px] text-pv-danger">{problem}</p> : null}
            </div>
            {/* The footer: the note left, the one action right (the dialog's button row). */}
            <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-pv-border px-8 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-pv-muted-fg">Card details are handled securely by Stripe.</p>
              <button type="button" onClick={() => setAdding(true)} disabled={busy} className={cn(PRIMARY_BUTTON, 'w-full sm:w-auto')}>
                Add card
              </button>
            </div>
          </>
        )}
      </PvDialogContent>
    </Dialog>
  );
}

function CardRow({
  card,
  busy,
  onMakeDefault,
  onRemove,
}: {
  card: CustomerCard;
  busy: boolean;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  const exp = expiry(card.expMonth, card.expYear);
  return (
    <li className="py-4">
      <div className="flex items-center gap-4">
        <CardThumb brand={card.brand} last4={card.last4 ?? '····'} />
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-sm font-medium text-pv-fg">
            {cardBrandLabel(card.brand)} •••• {card.last4}
          </p>
          <p className="mt-0.5 truncate text-xs text-pv-muted-fg">
            {[exp ? `Expires ${exp}` : null, card.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            className={cn(LINK, '!text-pv-muted-fg')}
            onClick={onRemove}
            disabled={busy || card.isDefault}
            title={card.isDefault ? 'Make another card the default before removing this one' : undefined}
          >
            Remove
          </button>
          {/* The star IS the default marker: filled on the card we charge, an
              outline on the others — press one to make it the default. */}
          <button
            type="button"
            onClick={card.isDefault ? undefined : onMakeDefault}
            disabled={!card.isDefault && busy}
            aria-label={card.isDefault ? 'Default card' : 'Make default'}
            aria-pressed={card.isDefault}
            title={card.isDefault ? 'Default card' : 'Make default'}
            className={cn(
              'rounded-md p-1 transition-colors duration-200 ease-out motion-reduce:transition-none',
              card.isDefault
                ? 'cursor-default text-pv-primary'
                : 'cursor-pointer text-pv-muted-fg/60 hover:text-pv-primary disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill={card.isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
              <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}

/* ─────────────────────────────── add a card ──────────────────────────────── */

/**
 * The operator's Add card form: the card face on the left, live as it is
 * typed (the brand as soon as Stripe knows it, the name), and on the right the
 * name, number, expiry and CVC — the number, expiry and CVC being Stripe's own
 * fields, so card data never touches our code.
 */
function AddCardForm({ hasCards, onCancel, onAdded }: { hasCards: boolean; onCancel: () => void; onAdded: () => void }) {
  const { startSetup } = useCustomerCards();
  const [setup, setSetup] = useState<CardSetup | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // One SetupIntent per opening of the form.
  useEffect(() => {
    let live = true;
    startSetup()
      .then((value) => live && setSetup(value))
      .catch((err: unknown) => live && setFailed(err instanceof Error ? err.message : 'The card form could not be opened.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stripePromise = useMemo(
    () => (setup ? getStripeForAccount(setup.publishableKey, setup.connectAccountId) : null),
    [setup],
  );

  if (failed) {
    return (
      <div className="flex flex-col gap-4 px-8 pb-6 pt-4">
        <p className="text-sm text-pv-danger">{failed}</p>
        <div>
          <button type="button" onClick={onCancel} className={QUIET_BUTTON}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return stripePromise && setup ? (
    <Elements stripe={stripePromise} options={{ fonts: [...V2_ELEMENTS_FONTS] }}>
      <SetupForm clientSecret={setup.clientSecret} hasCards={hasCards} onCancel={onCancel} onAdded={onAdded} />
    </Elements>
  ) : (
    <div className="grid gap-6 px-8 pb-6 pt-4 sm:grid-cols-[320px_minmax(0,1fr)]" aria-busy aria-label="Preparing a secure form">
      <div className="hidden aspect-[1.586] animate-pulse rounded-2xl bg-pv-muted sm:block" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-[10px] bg-pv-muted" />
        ))}
      </div>
    </div>
  );
}

/**
 * Stripe's fields, painted like the portal's inputs. The colours are resolved
 * to literals first (resolvePvColours): Stripe rejects the raw `--pv-*`
 * values, which are hsl() expressions over other custom properties.
 */
function useFieldStyle() {
  return useMemo(() => {
    const c = resolvePvColours(['--pv-fg', '--pv-muted-fg', '--pv-danger']);
    return {
      base: {
        fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif',
        fontSize: '14px',
        color: c?.['--pv-fg'] ?? '#0f172a',
        '::placeholder': { color: c?.['--pv-muted-fg'] ?? '#737373' },
      },
      invalid: { color: c?.['--pv-danger'] ?? '#dc2626' },
    };
  }, []);
}

const FIELD_BOX =
  'flex h-11 items-center rounded-[10px] border border-pv-border bg-pv-card px-3 transition-colors duration-200 focus-within:border-pv-primary focus-within:ring-[3px] focus-within:ring-pv-primary/15 motion-reduce:transition-none';
const LABEL = 'mb-1.5 block text-[12px] font-medium text-pv-fg';

function SetupForm({
  clientSecret,
  hasCards,
  onCancel,
  onAdded,
}: {
  clientSecret: string;
  hasCards: boolean;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const style = useFieldStyle();
  const { setDefault, invalidate } = useCustomerCards();
  const { displayName } = useCustomer();
  const [name, setName] = useState(displayName ?? '');
  const [brand, setBrand] = useState<string | null>(null);
  const [complete, setComplete] = useState({ number: false, expiry: false, cvc: false });
  // The first card is the default whatever this says; after that it is a choice.
  const [makeDefault, setMakeDefault] = useState(!hasCards);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = complete.number && complete.expiry && complete.cvc && name.trim() !== '';

  const save = async () => {
    const number = elements?.getElement(CardNumberElement);
    if (!stripe || !number) return;
    setSaving(true);
    setProblem(null);
    const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card: number, billing_details: { name: name.trim() } },
    });
    if (error) {
      setSaving(false);
      setProblem(error.message ?? 'The card was not accepted.');
      return;
    }
    const paymentMethodId = typeof setupIntent?.payment_method === 'string' ? setupIntent.payment_method : setupIntent?.payment_method?.id;
    try {
      if (paymentMethodId && (makeDefault || !hasCards)) await setDefault.mutateAsync(paymentMethodId);
      else await invalidate();
      onAdded();
    } catch (err) {
      setProblem(
        err instanceof Error
          ? `The card was saved, but it could not be made the default: ${err.message}`
          : 'The card was saved, but could not be made the default.',
      );
      void invalidate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="grid min-h-0 gap-6 overflow-y-auto px-8 pb-8 pt-4 sm:grid-cols-[320px_minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="hidden sm:block">
        <PaymentCard3D
          brand={brand}
          last4="····"
          expMonth={null}
          expYear={null}
          name={name.trim() || null}
          isPrimary={makeDefault || !hasCards}
          fit={false}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <label htmlFor="card-name" className={LABEL}>
            Name on card
          </label>
          <input
            id="card-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="cc-name"
            className={cn(FIELD_BOX, 'w-full text-sm text-pv-fg outline-none placeholder:text-pv-muted-fg')}
            placeholder="As printed on the card"
          />
        </div>
        <div>
          <span className={LABEL}>Card number</span>
          <div className={FIELD_BOX}>
            <CardNumberElement
              className="w-full"
              options={{ style, showIcon: true, disableLink: true }}
              onChange={(event) => {
                setBrand(event.brand && event.brand !== 'unknown' ? event.brand : null);
                setComplete((c) => ({ ...c, number: event.complete }));
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={LABEL}>Expiry</span>
            <div className={FIELD_BOX}>
              <CardExpiryElement className="w-full" options={{ style }} onChange={(event) => setComplete((c) => ({ ...c, expiry: event.complete }))} />
            </div>
          </div>
          <div>
            <span className={LABEL}>CVC</span>
            <div className={FIELD_BOX}>
              <CardCvcElement className="w-full" options={{ style }} onChange={(event) => setComplete((c) => ({ ...c, cvc: event.complete }))} />
            </div>
          </div>
        </div>
        {hasCards ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-pv-fg">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(event) => setMakeDefault(event.target.checked)}
              className="size-4 accent-[var(--pv-primary)]"
            />
            Make this my default card
          </label>
        ) : null}
        {problem ? <p className="text-[13px] text-pv-danger">{problem}</p> : null}
        <div className="flex items-center justify-end gap-2 border-t border-pv-border pt-5">
          <button type="button" onClick={onCancel} disabled={saving} className={QUIET_BUTTON}>
            Back
          </button>
          <button type="submit" disabled={!stripe || !ready || saving} className={PRIMARY_BUTTON}>
            {saving ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </div>
    </form>
  );
}
