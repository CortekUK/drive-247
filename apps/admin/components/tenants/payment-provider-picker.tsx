'use client';

/**
 * Payment provider choice at TENANT CREATION time.
 *
 * WHY THIS COMPONENT EXISTS AT ALL
 * --------------------------------
 * `tenants.payment_provider` is NOT NULL DEFAULT 'stripe' and carries an
 * IMMUTABILITY TRIGGER in production: once a tenant row is written, the value
 * can never be updated. There is no runtime toggle, no settings switch, and no
 * migration path — a wrong choice is only fixable by deleting the tenant and
 * creating it again, which throws away its slug, its admin user, its branding
 * and anything already booked against it.
 *
 * That makes tenant creation the ONLY moment this decision can be made, and it
 * makes an ordinary two-option radio group actively dangerous. Hence: Stripe is
 * pre-selected, Square is unreachable until a supported country is chosen, and
 * Square cannot be committed at all until the operator ticks an acknowledgement
 * that names, in product terms, the four things the client will not get.
 *
 * WHY COUNTRY AND PROVIDER ARE ONE CONTROL
 * ----------------------------------------
 * Production CHECK constraint `tenants_square_country_supported_check`:
 *
 *   CHECK (payment_provider = 'stripe'
 *          OR (country IS NOT NULL AND country IN
 *              ('AU','CA','FR','IE','JP','ES','GB','US')))
 *
 * A form that captured the provider without the country would produce a raw
 * Postgres 23514 mid-onboarding, after the slug check has already passed. The
 * two fields are one decision, so they are one component.
 *
 * `tenants_country_iso3166_check` additionally requires `^[A-Z]{2}$`, so every
 * code emitted here is UPPERCASE. All 52 live tenants currently have
 * country = NULL, so nothing existing is affected by introducing the field.
 *
 * WHY THE CAPABILITY DATA IS MIRRORED, NOT IMPORTED
 * -------------------------------------------------
 * The authority is SQUARE_CAPABILITIES in
 * supabase/functions/_shared/payments/capabilities.ts. That module is a Deno
 * module: it imports its siblings with explicit `.ts` specifiers and pulls
 * supabase-js from esm.sh, neither of which resolves under this app's Next.js /
 * tsconfig (`allowImportingTsExtensions` is off and the path lies outside the
 * app root). Importing it would break the admin build. The values below are a
 * deliberate mirror, and each is annotated with the capability flag it comes
 * from so a future change to the manifest has an obvious second home.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Check, CreditCard, Globe, Info, Lock, Store, X } from 'lucide-react';

/**
 * Mirror of `ProviderId` in supabase/functions/_shared/payments/types.ts and of
 * the `tenants_payment_provider_check` CHECK constraint.
 */
export type PaymentProviderId = 'stripe' | 'square';

/**
 * Everything tenant creation needs to carry about payment processing.
 *
 * `permanenceAcknowledged` lives in the value rather than in component state on
 * purpose: the submitting form has to be able to BLOCK on it, and hidden
 * internal state cannot be validated by a parent.
 */
export interface PaymentProviderSelection {
  paymentProvider: PaymentProviderId;
  /** ISO-3166-1 alpha-2, uppercase. Null = not stated yet. */
  country: string | null;
  /** True once the operator has explicitly confirmed the permanence warning. */
  permanenceAcknowledged: boolean;
}

/** Stripe is the native rail and always the starting point. */
export const DEFAULT_PAYMENT_PROVIDER_SELECTION: PaymentProviderSelection = {
  paymentProvider: 'stripe',
  country: null,
  permanenceAcknowledged: false,
};

interface CountryOption {
  code: string;
  name: string;
}

/**
 * The eight countries in `SQUARE_CAPABILITIES.supportedCountries`, which is also
 * exactly the list inside `tenants_square_country_supported_check`. Keep the two
 * in lockstep — a code here that the constraint does not know about turns into a
 * 23514 at insert time.
 */
const SQUARE_COUNTRY_OPTIONS: readonly CountryOption[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'FR', name: 'France' },
  { code: 'IE', name: 'Ireland' },
  { code: 'JP', name: 'Japan' },
  { code: 'ES', name: 'Spain' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
];

/**
 * Markets we sell into that Square cannot serve. Not an exhaustive ISO list on
 * purpose — 249 entries would bury the eight that change the outcome. Add on
 * demand; anything here is Stripe-only by construction.
 */
const OTHER_COUNTRY_OPTIONS: readonly CountryOption[] = [
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'IN', name: 'India' },
  { code: 'IT', name: 'Italy' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
];

/** Codes only — the shape `isCountrySupported()` compares against. */
export const SQUARE_SUPPORTED_COUNTRIES: readonly string[] = SQUARE_COUNTRY_OPTIONS.map(
  (c) => c.code,
);

/**
 * A product fact a salesperson must not contradict, and the capability flag it
 * is derived from. Stating the flag keeps these honest: if the manifest ever
 * gains a capability, the copy that promised its absence is easy to find.
 */
interface ProviderLimitation {
  /** Flag name in capabilities.ts this fact comes from. */
  capability: string;
  headline: string;
  detail: string;
}

interface ProviderOption {
  id: PaymentProviderId;
  name: string;
  tagline: string;
  icon: typeof CreditCard;
  /**
   * Mirror of `supportedCountries`. `null` means the processor imposes no
   * country constraint we gate on — the same semantics as capabilities.ts, so
   * the enable/disable rule here is capability-driven rather than name-driven.
   */
  supportedCountries: readonly string[] | null;
  /** The pre-selected, zero-risk option. Exactly one option carries this. */
  isDefault: boolean;
  /** True when choosing this option must be explicitly acknowledged. */
  requiresPermanenceAck: boolean;
  limitations: readonly ProviderLimitation[];
  /** Things that DO work, so the warning does not read as "Square is broken". */
  retained: readonly string[];
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    tagline: 'The default. Every feature in the product is available.',
    icon: CreditCard,
    supportedCountries: null,
    isDefault: true,
    requiresPermanenceAck: false,
    limitations: [],
    retained: [
      'Installment plans, auto-extend auto-charge, saved-card charging and deposit authorization holds',
      'Instant refunds, partial captures and Stripe Connect payouts',
    ],
  },
  {
    id: 'square',
    name: 'Square',
    tagline: 'Link-based payments only. Choose this only if the client already runs on Square.',
    icon: Store,
    supportedCountries: SQUARE_SUPPORTED_COUNTRIES,
    isDefault: false,
    requiresPermanenceAck: true,
    limitations: [
      {
        capability: 'supportsStoredCredential = false',
        headline: 'No installment plans',
        detail:
          'Square hosted checkout cannot store a card for later use, so a booking cannot be split into scheduled installments. The full amount is taken at checkout, or collected with a fresh link each time.',
      },
      {
        capability: 'canChargeOffSession = false',
        headline: 'No auto-extend auto-charge',
        detail:
          'An auto-extending rental can only send the renter a payment link they have to open. Nothing can be charged in the background overnight, so extensions depend on the renter acting.',
      },
      {
        capability: 'supportsStoredCredential = false',
        headline: 'No saved-card charging from the portal',
        detail:
          'Staff cannot charge a card on file for damage, fuel, fines or an outstanding balance. Every charge needs the renter to open a link and pay.',
      },
      {
        capability: 'supportsAuthorizationHold = false',
        headline: 'No deposit authorization holds',
        detail:
          'A security deposit cannot be held and released. It can only be taken as a real charge and refunded afterwards, which means the money actually leaves the renter account.',
      },
    ],
    retained: [
      'Booking checkout, pay-by-link collection and auto-extend link mode all work normally',
      'Refunds work: full or partial, up to 20 per payment, for 365 days — but they settle asynchronously rather than instantly',
      'The client must finish Square OAuth from their portal and pick a Square location before any payment can be taken. That location fixes the currency, and it is never converted.',
    ],
  },
];

/** `capabilities.ts::isCountrySupported`, restated for the browser. */
function isCountrySupported(option: ProviderOption, country: string | null): boolean {
  if (!option.supportedCountries) return true; // no country constraint for this processor
  if (!country) return false; // constrained processor + unknown country = refuse
  return option.supportedCountries.includes(country.toUpperCase());
}

function optionFor(provider: PaymentProviderId): ProviderOption {
  // Fail safe toward Stripe, matching coerceProvider() in resolve.ts: an
  // unrecognised value must never present itself as the Square rail.
  return PROVIDER_OPTIONS.find((o) => o.id === provider) ?? PROVIDER_OPTIONS[0];
}

/**
 * Everything that would otherwise surface as a raw Postgres CHECK violation,
 * plus the acknowledgement gate.
 *
 * Call this before submitting. Returns null when the selection is safe to
 * insert, otherwise a message fit to show the operator.
 */
export function validatePaymentProviderSelection(
  value: PaymentProviderSelection,
): string | null {
  const option = optionFor(value.paymentProvider);

  // Required for every tenant, not just Square ones: the field is what makes the
  // provider gate meaningful, and a null country silently re-opens the question
  // later for anyone who wants to move this tenant onto Square.
  if (!value.country) {
    return 'Select the country this company operates in.';
  }

  if (!/^[A-Z]{2}$/.test(value.country)) {
    // tenants_country_iso3166_check
    return 'Country must be a two-letter ISO-3166-1 code.';
  }

  if (!isCountrySupported(option, value.country)) {
    // tenants_square_country_supported_check
    return `${option.name} cannot process payments for a tenant in this country. Choose a supported country or use Stripe.`;
  }

  if (option.requiresPermanenceAck && !value.permanenceAcknowledged) {
    return `Confirm you understand that choosing ${option.name} is permanent before creating this company.`;
  }

  return null;
}

/**
 * The exact tenants columns to write. Exported so no call site has to remember
 * the column names.
 *
 * `square_mode` is deliberately NOT included: it is NOT NULL DEFAULT 'test', and
 * a brand new Square tenant must start in sandbox. Square sandbox and production
 * are physically separate hosts with non-interchangeable credentials, so the
 * flip to live belongs to the OAuth connection flow, not to a creation form.
 */
export function paymentProviderTenantColumns(value: PaymentProviderSelection): {
  payment_provider: PaymentProviderId;
  country: string | null;
} {
  return {
    payment_provider: value.paymentProvider,
    country: value.country,
  };
}

export interface PaymentProviderPickerProps {
  value: PaymentProviderSelection;
  onChange: (next: PaymentProviderSelection) => void;
  /** Disable the whole control, e.g. while the create request is in flight. */
  disabled?: boolean;
  /** Server-side or submit-time error to render under the picker. */
  error?: string | null;
  className?: string;
}

export default function PaymentProviderPicker({
  value,
  onChange,
  disabled = false,
  error = null,
  className,
}: PaymentProviderPickerProps) {
  /**
   * Set when a country change forced the provider back to Stripe. Rendered once
   * so the change is never silent — an operator who picked Square and then
   * corrected the country must see that their provider choice went with it.
   */
  const [revertedFrom, setRevertedFrom] = useState<string | null>(null);

  const selected = optionFor(value.paymentProvider);

  const countryLabel = useMemo(() => {
    if (!value.country) return null;
    const match = [...SQUARE_COUNTRY_OPTIONS, ...OTHER_COUNTRY_OPTIONS].find(
      (c) => c.code === value.country,
    );
    return match?.name ?? value.country;
  }, [value.country]);

  const handleCountryChange = (code: string) => {
    const next = code.toUpperCase();

    // If the country the operator just chose puts the CURRENT provider outside
    // its supported list, the row would fail tenants_square_country_supported_check
    // at insert. Fall back to the native rail here rather than at the database.
    if (!isCountrySupported(selected, next)) {
      setRevertedFrom(selected.name);
      onChange({
        paymentProvider: 'stripe',
        country: next,
        permanenceAcknowledged: false,
      });
      return;
    }

    setRevertedFrom(null);
    onChange({ ...value, country: next });
  };

  const handleProviderChange = (option: ProviderOption) => {
    if (disabled) return;
    if (!isCountrySupported(option, value.country)) return; // the card is already disabled

    setRevertedFrom(null);
    onChange({
      paymentProvider: option.id,
      country: value.country,
      // Switching provider always re-arms the acknowledgement. Ticking it for
      // Square, flipping to Stripe and flipping back must not carry consent
      // across — the operator has to affirm the current choice.
      permanenceAcknowledged: false,
    });
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* ---- Permanence warning: always visible, before the choice is made ---- */}
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3 flex gap-3">
        <Lock className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-warning">
            The payment processor is permanent
          </p>
          <p className="text-xs text-warning/90">
            It is locked to this company the moment it is created. There is no toggle in Settings
            and no migration. Correcting a mistake means deleting the company and starting again,
            which loses the subdomain, the admin login and anything already booked.
          </p>
        </div>
      </div>

      {/* ---- Country FIRST: it decides whether Square is reachable at all ---- */}
      <div>
        <Label className="mb-1.5 block">Operating country *</Label>
        <Select
          value={value.country ?? ''}
          onValueChange={handleCountryChange}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select the country this company operates in" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Stripe or Square</SelectLabel>
              {SQUARE_COUNTRY_OPTIONS.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Stripe only</SelectLabel>
              {OTHER_COUNTRY_OPTIONS.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
          <Globe className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Where the business is registered for payments. Square can only take money in{' '}
            {SQUARE_SUPPORTED_COUNTRIES.join(', ')} — everywhere else is Stripe.
          </span>
        </p>
      </div>

      {revertedFrom && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 flex gap-2.5">
          <Info className="h-4 w-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-sky-300">
            Switched back to Stripe: {revertedFrom} cannot process payments in{' '}
            {countryLabel ?? 'the country you selected'}.
          </p>
        </div>
      )}

      {/* ---- Provider choice ---- */}
      <div>
        <Label className="mb-1.5 block">Payment processor *</Label>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Payment processor">
          {PROVIDER_OPTIONS.map((option) => {
            const isSelected = option.id === value.paymentProvider;
            const countryOk = isCountrySupported(option, value.country);
            const isDisabled = disabled || !countryOk;
            const OptionIcon = option.icon;

            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={isDisabled}
                onClick={() => handleProviderChange(option)}
                className={cn(
                  'text-left rounded-md border p-3 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-input bg-background hover:border-primary/40',
                  isDisabled && 'opacity-50 cursor-not-allowed hover:border-input',
                )}
              >
                <div className="flex items-center gap-2">
                  <OptionIcon
                    className={cn('h-4 w-4', isSelected ? 'text-primary' : 'text-muted-foreground')}
                  />
                  <span className="text-sm font-semibold">{option.name}</span>
                  {option.isDefault && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Default
                    </span>
                  )}
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary ml-auto" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{option.tagline}</p>
                {!countryOk && (
                  <p className="text-xs text-warning mt-1.5">
                    {value.country
                      ? `Not available in ${countryLabel}. Square supports ${SQUARE_SUPPORTED_COUNTRIES.join(', ')} only.`
                      : 'Choose an operating country first — Square is only available in some countries.'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Consequences of the non-default choice, plus the consent gate ---- */}
      {selected.requiresPermanenceAck && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-3">
          <div className="flex gap-2.5">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-400">
                A {selected.name} company permanently loses these features
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                These are product facts, not settings. Do not promise any of them to this client.
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {selected.limitations.map((limitation) => (
              <li key={limitation.headline} className="flex gap-2">
                <X className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">{limitation.headline}</p>
                  <p className="text-xs text-muted-foreground">{limitation.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="border-t border-destructive/20 pt-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Everything else still works</p>
            <ul className="space-y-1.5">
              {selected.retained.map((item) => (
                <li key={item} className="flex gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-destructive/20 pt-3 flex items-start gap-2.5">
            <Checkbox
              id="payment-provider-permanence-ack"
              checked={value.permanenceAcknowledged}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ ...value, permanenceAcknowledged: checked })
              }
              className="mt-0.5"
            />
            <Label
              htmlFor="payment-provider-permanence-ack"
              className="text-xs font-normal leading-relaxed cursor-pointer"
            >
              I have confirmed with this client that they do not need installment plans,
              auto-extend auto-charge, saved-card charging or deposit holds, and I understand
              that {selected.name} cannot be changed after the company is created.
            </Label>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
