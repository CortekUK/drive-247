'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Copy, CheckCircle, Loader2, PartyPopper } from 'lucide-react';

interface OnboardingResult {
  tenantId: string;
  slug: string;
  companyName: string;
  adminEmail: string;
  adminPassword: string;
  portalUrl: string;
  bookingUrl: string;
  subscriptionAmount: number; // cents
  subscriptionCurrency: string;
  /**
   * false => the tenant is live but their booking site is still rendering
   * Drive247's placeholder CMS copy. Optional because an older deployment of
   * create-sales-onboarding does not return the field — only an explicit
   * `false` means seeding actually failed.
   */
  contentSeeded?: boolean;
  /** IANA zone derived from the location, or null when it could not be worked out. */
  timezone?: string | null;
  message: string;
}

interface SalesOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

/** Exactly the options on the Google form. "Other" reveals a free-text box. */
const VEHICLE_TYPE_OPTIONS = ['Economy', 'Premium', 'Exotic and Luxury'] as const;

/** Monday-first, matching how operators describe a week. `col` is the tenants.* prefix. */
const DAY_OPTIONS = [
  { col: 'monday', short: 'Mon' },
  { col: 'tuesday', short: 'Tue' },
  { col: 'wednesday', short: 'Wed' },
  { col: 'thursday', short: 'Thu' },
  { col: 'friday', short: 'Fri' },
  { col: 'saturday', short: 'Sat' },
  { col: 'sunday', short: 'Sun' },
] as const;

/**
 * Half-hour slots for the whole day. Operators PICK a time instead of typing,
 * so we never have to guess what "9-6" or "nine am" meant. `value` is 24h
 * (what the DB stores); `label` is the 12h + AM/PM form the team asked for.
 */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2);
  const mins = i % 2 === 0 ? '00' : '30';
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { value: `${String(h24).padStart(2, '0')}:${mins}`, label: `${h12}:${mins} ${period}` };
});

// Fleet size is a count of vehicles: whole, positive, and sanity-capped so a
// mistyped "120000" cannot sail through.
const MIN_FLEET_SIZE = 1;
const MAX_FLEET_SIZE = 10_000;

const EMPTY_FORM = {
  firstName: '',
  companyName: '',
  slug: '',
  contactEmail: '',
  businessPhone: '',
  tenantType: 'production' as 'production' | 'test',
  subscriptionAmount: '',
  location: '',
  /** Multi-select, mirroring the Google form's checkboxes. */
  vehicleTypes: [] as string[],
  /** Only used when "Other" is ticked. */
  vehicleTypeOther: '',
  fleetSize: '',
  /** Structured opening hours — no free-text parsing guesswork. */
  hoursAlwaysOpen: false,
  hoursDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as string[],
  hoursOpen: '09:00',
  hoursClose: '18:00',
  businessColours: '',
  logoUrl: '',
  wantsMarketing: false,
  hasMetaAdAccount: false,
  metaDailyBudget: '',
  otherInfo: '',
};

const currencySymbol = (currency: string): string => {
  switch ((currency || 'usd').toLowerCase()) {
    case 'usd':
      return '$';
    case 'gbp':
      return '£';
    case 'eur':
      return '€';
    case 'aed':
      return 'AED ';
    default:
      return currency.toUpperCase() + ' ';
  }
};

// The subscription (what Drive247 charges the tenant) is billed in USD.
// This is NOT the tenant's rental currency — that stays on tenants.currency_code.
const SUBSCRIPTION_CURRENCY = 'usd';

// Stripe caps unit_amount at 99,999,999 cents; keep the form well inside it.
const MAX_SUBSCRIPTION_AMOUNT = 999_999;

/**
 * Canonical subdomain form — must match normalizeSlug() in the
 * create-sales-onboarding edge function, otherwise the preview shown to George
 * differs from the subdomain the tenant actually gets. Repeated/edge hyphens
 * are stripped because they are illegal DNS labels.
 */
const normalizeSlug = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Deliberately permissive: catch typos, never reject a legitimate address. */
const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/**
 * Digits only after an optional leading "+". 7–15 digits covers every E.164
 * number; the edge function normalises formatting separately.
 */
const isPhone = (value: string): boolean => {
  const digits = value.replace(/[^\d]/g, '');
  return /^\+?[\d\s()./-]+$/.test(value.trim()) && digits.length >= 7 && digits.length <= 15;
};

const timeLabel = (value: string): string =>
  TIME_OPTIONS.find((t) => t.value === value)?.label ?? value;

/**
 * Human-readable opening hours for `tenants.business_hours` and the booking
 * site. The structured day/time values are ALSO sent to the edge function, so
 * this string is for display only — nothing has to parse it back.
 * Collapses a run of consecutive days into "Mon–Fri" the way an operator writes it.
 */
const buildOperatingHoursText = (
  alwaysOpen: boolean,
  days: string[],
  open: string,
  close: string,
): string => {
  if (alwaysOpen) return 'Open 24/7';
  const picked = DAY_OPTIONS.filter((d) => days.includes(d.col));
  if (picked.length === 0) return '';
  const idx = picked.map((d) => DAY_OPTIONS.findIndex((o) => o.col === d.col));
  const consecutive = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1);
  const label =
    picked.length === 7
      ? 'Mon–Sun'
      : consecutive && picked.length > 1
        ? `${picked[0].short}–${picked[picked.length - 1].short}`
        : picked.map((d) => d.short).join(', ');
  return `${label} ${timeLabel(open)}–${timeLabel(close)}`;
};

export default function SalesOnboardingDialog({ open, onOpenChange, onCreated }: SalesOnboardingDialogProps) {
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<{
    slug?: string;
    subscriptionAmount?: string;
    logoUrl?: string;
    companyName?: string;
    contactEmail?: string;
    businessPhone?: string;
    fleetSize?: string;
    hours?: string;
  }>({});
  /** Set while we check the business name isn't already taken. */
  const [checkingName, setCheckingName] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Live preview of the subdomain the tenant will actually get.
  const previewSlug = normalizeSlug(formData.slug);

  const validateSlug = (slug: string): string | null => {
    if (slug.length < 3) return 'Slug must be at least 3 characters long';
    if (slug.length > 50) return 'Slug must be 50 characters or less';
    if (!/^[a-z][a-z0-9-]*$/.test(slug))
      return 'Slug must start with a letter and contain only letters, numbers, and hyphens';
    // The client's first-login password is derived from the slug's
    // alphanumerics; too few and the generated password is rejected by auth.
    if (slug.replace(/[^a-z0-9]/g, '').length < 3)
      return 'Slug must contain at least 3 letters or numbers';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const slug = normalizeSlug(formData.slug);
    const slugError = validateSlug(slug);

    const amount = parseFloat(formData.subscriptionAmount);
    let amountError: string | null = null;
    if (!Number.isFinite(amount) || amount <= 0) {
      amountError = 'Enter a monthly amount greater than 0';
    } else if (amount > MAX_SUBSCRIPTION_AMOUNT) {
      amountError = `Amount must be ${MAX_SUBSCRIPTION_AMOUNT.toLocaleString()} or less`;
    }

    const companyName = formData.companyName.trim();

    const email = formData.contactEmail.trim().toLowerCase();
    const emailError = !isEmail(email) ? 'Enter a valid email address' : null;

    // Phone is optional on the Google form, so only validate what was typed.
    const phone = formData.businessPhone.trim();
    const phoneError =
      phone && !isPhone(phone) ? 'Enter a valid phone number, including the country code' : null;

    // Fleet size is a vehicle COUNT: whole and positive. Explicitly rejects
    // negatives and decimals rather than silently coercing them.
    const fleetRaw = formData.fleetSize.trim();
    let fleetError: string | null = null;
    if (fleetRaw) {
      const n = Number(fleetRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        fleetError = 'Fleet size must be a whole number';
      } else if (n < MIN_FLEET_SIZE) {
        fleetError = `Fleet size must be at least ${MIN_FLEET_SIZE}`;
      } else if (n > MAX_FLEET_SIZE) {
        fleetError = `Fleet size must be ${MAX_FLEET_SIZE.toLocaleString()} or less`;
      }
    }

    // "HH:MM" is zero-padded 24h, so a plain string compare orders correctly.
    // Overnight shifts aren't representable per-day — those are "Open 24/7".
    let hoursError: string | null = null;
    if (!formData.hoursAlwaysOpen) {
      if (formData.hoursDays.length === 0) {
        hoursError = 'Pick at least one opening day, or choose Open 24/7';
      } else if (formData.hoursOpen >= formData.hoursClose) {
        hoursError = 'Closing time must be after opening time (use Open 24/7 for overnight)';
      }
    }

    const logoUrl = formData.logoUrl.trim();
    const logoError = logoUrl && !isHttpUrl(logoUrl) ? 'Enter a full http(s) URL, e.g. https://…/logo.png' : null;

    if (slugError || amountError || emailError || phoneError || fleetError || hoursError || logoError) {
      setFormErrors({
        slug: slugError || undefined,
        subscriptionAmount: amountError || undefined,
        contactEmail: emailError || undefined,
        businessPhone: phoneError || undefined,
        fleetSize: fleetError || undefined,
        hours: hoursError || undefined,
        logoUrl: logoError || undefined,
      });
      return;
    }
    setFormErrors({});

    // Business-name uniqueness. The edge function re-checks this atomically and
    // is the authority; doing it here just saves the sales person a round trip
    // and a scary error mid-call. A failure to check is deliberately non-fatal.
    setCheckingName(true);
    try {
      const { data: clash } = await (supabase as any)
        .from('tenants')
        .select('id')
        .ilike('company_name', companyName)
        .limit(1);
      if (clash && clash.length > 0) {
        setFormErrors({ companyName: 'Another rental company already uses this name' });
        return;
      }
    } catch {
      // Let the edge function have the final say.
    } finally {
      setCheckingName(false);
    }

    setCreating(true);

    // Ticked options, with the free-text "Other" substituted in for the literal
    // word "Other" so the stored value reads like something a human wrote.
    const vehicleTypeValue = [
      ...formData.vehicleTypes.filter((v) => v !== 'Other'),
      ...(formData.vehicleTypes.includes('Other') && formData.vehicleTypeOther.trim()
        ? [formData.vehicleTypeOther.trim()]
        : []),
    ].join(', ');

    const operatingHoursText = buildOperatingHoursText(
      formData.hoursAlwaysOpen,
      formData.hoursDays,
      formData.hoursOpen,
      formData.hoursClose,
    );

    try {
      const { data, error } = await supabase.functions.invoke('create-sales-onboarding', {
        body: {
          companyName,
          firstName: formData.firstName.trim() || undefined,
          slug,
          contactEmail: email,
          businessPhone: phone || undefined,
          // Selected options plus whatever they typed under "Other", as one
          // comma-separated string (what the column and the CMS copy expect).
          vehicleType: vehicleTypeValue || undefined,
          fleetSize: fleetRaw || undefined,
          location: formData.location.trim() || undefined,
          // Display string for tenants.business_hours...
          operatingHours: operatingHoursText || undefined,
          // ...plus the STRUCTURED values, so the edge function never has to
          // guess what free text meant. It writes the per-day open/close
          // columns straight from these.
          operatingSchedule: {
            alwaysOpen: formData.hoursAlwaysOpen,
            days: formData.hoursAlwaysOpen ? DAY_OPTIONS.map((d) => d.col) : formData.hoursDays,
            opensAt: formData.hoursAlwaysOpen ? '00:00' : formData.hoursOpen,
            closesAt: formData.hoursAlwaysOpen ? '23:59' : formData.hoursClose,
          },
          businessColours: formData.businessColours.trim() || undefined,
          logoUrl: logoUrl || undefined,
          wantsMarketing: formData.wantsMarketing,
          hasMetaAdAccount: formData.hasMetaAdAccount,
          metaDailyBudget: formData.metaDailyBudget.trim() || undefined,
          otherInfo: formData.otherInfo.trim() || undefined,
          tenantType: formData.tenantType,
          // Round to whole cents — Stripe rejects fractional cents.
          subscriptionAmount: Math.round(amount * 100) / 100,
          subscriptionCurrency: SUBSCRIPTION_CURRENCY,
        },
      });

      // supabase-js collapses EVERY non-2xx into a generic FunctionsHttpError
      // ("Edge Function returned a non-2xx status code") and hides the response
      // body — which is where create-sales-onboarding puts the actionable reason
      // ("Slug already taken", "An account already exists for this email",
      // validation failures, or the underlying Postgres/Stripe error). Read the
      // body back so the operator sees what actually went wrong.
      if (error) {
        let detail = error.message;
        const res = (error as any)?.context;
        if (res && typeof res.json === 'function') {
          try {
            const body = await res.clone().json();
            if (body?.error) detail = String(body.error);
          } catch {
            // not JSON (e.g. a gateway/boot failure) — keep the generic message
          }
        }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.success) throw new Error('Onboarding failed — no data returned');

      setResult({
        tenantId: data.tenantId,
        slug: data.slug,
        companyName: data.companyName,
        adminEmail: data.adminEmail,
        adminPassword: data.adminPassword,
        portalUrl: data.portalUrl,
        bookingUrl: data.bookingUrl,
        subscriptionAmount: data.subscriptionAmount,
        subscriptionCurrency: data.subscriptionCurrency,
        // CMS seeding is deliberately non-fatal on the server, so the only way
        // George learns it failed is by carrying the flag through to the pane.
        contentSeeded: typeof data.contentSeeded === 'boolean' ? data.contentSeeded : undefined,
        timezone: typeof data.timezone === 'string' ? data.timezone : data.timezone === null ? null : undefined,
        message: data.message,
      });
      setShowResult(true);
      onOpenChange(false);
      setFormData({ ...EMPTY_FORM });
      onCreated?.();
    } catch (err: any) {
      toast.error(`Onboarding failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  // writeText REJECTS in a non-secure context, when the document isn't focused,
  // or when permission is denied. Toasting success without awaiting means the
  // sales person pastes stale clipboard content to a client believing the copy
  // worked — and this is now the only copy control in the pane.
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard!`);
    } catch {
      toast.error('Could not copy — select the text and copy it manually.');
    }
  };

  return (
    <>
      {/* Onboarding form */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Onboarding</DialogTitle>
            <DialogDescription>
              Provision a new rental company — creates their portal, branding, credits and paywall in one step.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">First Name</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="George"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Rental Business Name *</Label>
                <Input
                  required
                  maxLength={100}
                  value={formData.companyName}
                  onChange={(e) => {
                    setFormData({ ...formData, companyName: e.target.value });
                    if (formErrors.companyName) setFormErrors({ ...formErrors, companyName: undefined });
                  }}
                  className={formErrors.companyName ? 'border-destructive' : ''}
                  placeholder="Acme Rentals"
                />
                {formErrors.companyName ? (
                  <p className="text-xs text-destructive mt-1">{formErrors.companyName}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Used as the portal app name, page titles and SEO for their site.
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block">Slug (subdomain) *</Label>
              <Input
                required
                minLength={3}
                maxLength={50}
                value={formData.slug}
                onChange={(e) => {
                  setFormData({ ...formData, slug: e.target.value });
                  if (formErrors.slug && !validateSlug(normalizeSlug(e.target.value))) {
                    setFormErrors({ ...formErrors, slug: undefined });
                  }
                }}
                className={formErrors.slug ? 'border-destructive' : ''}
                placeholder="acme-rentals"
              />
              {formErrors.slug ? (
                <p className="text-xs text-destructive mt-1">{formErrors.slug}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Portal: {previewSlug || 'slug'}.portal.drive-247.com | Booking: {previewSlug || 'slug'}.drive-247.com
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Business Email *</Label>
                <Input
                  type="email"
                  required
                  value={formData.contactEmail}
                  onChange={(e) => {
                    setFormData({ ...formData, contactEmail: e.target.value });
                    if (formErrors.contactEmail) setFormErrors({ ...formErrors, contactEmail: undefined });
                  }}
                  className={formErrors.contactEmail ? 'border-destructive' : ''}
                  placeholder="admin@acmerentals.com"
                />
                {formErrors.contactEmail && (
                  <p className="text-xs text-destructive mt-1">{formErrors.contactEmail}</p>
                )}
              </div>
              <div>
                <Label className="mb-1.5 block">Business Phone</Label>
                <Input
                  type="tel"
                  maxLength={40}
                  value={formData.businessPhone}
                  onChange={(e) => {
                    setFormData({ ...formData, businessPhone: e.target.value });
                    if (formErrors.businessPhone) setFormErrors({ ...formErrors, businessPhone: undefined });
                  }}
                  className={formErrors.businessPhone ? 'border-destructive' : ''}
                  placeholder="+1 555 123 4567"
                />
                {formErrors.businessPhone ? (
                  <p className="text-xs text-destructive mt-1">{formErrors.businessPhone}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Include the country code — it&apos;s never guessed for you.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Tenant Type *</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formData.tenantType === 'production' ? 'default' : 'outline'}
                    onClick={() => setFormData({ ...formData, tenantType: 'production' })}
                    className={cn('flex-1', formData.tenantType === 'production' && 'bg-success hover:bg-success/90')}
                  >
                    Production
                  </Button>
                  <Button
                    type="button"
                    variant={formData.tenantType === 'test' ? 'default' : 'outline'}
                    onClick={() => setFormData({ ...formData, tenantType: 'test' })}
                    className={cn(
                      'flex-1',
                      formData.tenantType === 'test' && 'bg-warning hover:bg-warning/90 text-warning-foreground',
                    )}
                  >
                    Test
                  </Button>
                </div>
                {/* This toggle silently decided BoldSign live-vs-sandbox and
                    whether the paywall charges real money, which repeatedly
                    read as "BoldSign isn't going live / the paywall is broken"
                    when a Test tenant was used. Spell out exactly what changes.
                    Kept accurate to the edge function: ONLY these two modes
                    differ — stripe_mode (booking payments) and bonzah_mode stay
                    on 'test' for BOTH types, because live Stripe Connect and
                    live Bonzah each need their own per-tenant onboarding. */}
                {formData.tenantType === 'production' ? (
                  <p className="text-xs text-success mt-1">
                    <span className="font-semibold">Real client.</span> The paywall charges{' '}
                    <span className="font-semibold">real money</span>, and e-signatures are legally
                    binding (BoldSign live).
                  </p>
                ) : (
                  <p className="text-xs text-warning mt-1">
                    <span className="font-semibold">Safe dry run.</span> Paywall uses a Stripe test
                    card (no real charge) and e-signatures are watermarked sandbox docs that
                    auto-delete after 14 days.
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Either way they get 100 live + 1000 test credits, branding, and their website
                  content. Stripe Connect and Bonzah always start in test — the client turns those
                  on themselves from Portal → Settings.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">Subscription Amount ($/month) *</Label>
                <Input
                  type="number"
                  required
                  min="1"
                  max={MAX_SUBSCRIPTION_AMOUNT}
                  step="0.01"
                  value={formData.subscriptionAmount}
                  onChange={(e) => {
                    setFormData({ ...formData, subscriptionAmount: e.target.value });
                    if (formErrors.subscriptionAmount) setFormErrors({ ...formErrors, subscriptionAmount: undefined });
                  }}
                  className={formErrors.subscriptionAmount ? 'border-destructive' : ''}
                  placeholder="300"
                />
                {formErrors.subscriptionAmount ? (
                  <p className="text-xs text-destructive mt-1">{formErrors.subscriptionAmount}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Charged monthly through the paywall.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Location / Territory</Label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Los Angeles, CA"
                />
              </div>
              {/* Multi-select, mirroring the Google form's checkboxes. "Other"
                  reveals a free-text box instead of forcing a fixed option. */}
              <div>
                <Label className="mb-1.5 block">Vehicle Type</Label>
                <div className="flex flex-wrap gap-2">
                  {[...VEHICLE_TYPE_OPTIONS, 'Other'].map((opt) => {
                    const selected = formData.vehicleTypes.includes(opt);
                    return (
                      <Button
                        key={opt}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        aria-pressed={selected}
                        onClick={() =>
                          setFormData({
                            ...formData,
                            vehicleTypes: selected
                              ? formData.vehicleTypes.filter((v) => v !== opt)
                              : [...formData.vehicleTypes, opt],
                            // Drop stale text if "Other" is unticked.
                            vehicleTypeOther:
                              selected && opt === 'Other' ? '' : formData.vehicleTypeOther,
                          })
                        }
                      >
                        {opt}
                      </Button>
                    );
                  })}
                </div>
                {formData.vehicleTypes.includes('Other') && (
                  <Input
                    className="mt-2"
                    maxLength={120}
                    value={formData.vehicleTypeOther}
                    onChange={(e) => setFormData({ ...formData, vehicleTypeOther: e.target.value })}
                    placeholder="e.g. Vans, Motorhomes"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-1">Pick all that apply.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-1.5 block">Fleet Size</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_FLEET_SIZE}
                  max={MAX_FLEET_SIZE}
                  step={1}
                  value={formData.fleetSize}
                  onChange={(e) => {
                    setFormData({ ...formData, fleetSize: e.target.value });
                    if (formErrors.fleetSize) setFormErrors({ ...formErrors, fleetSize: undefined });
                  }}
                  className={formErrors.fleetSize ? 'border-destructive' : ''}
                  placeholder="12"
                />
                {formErrors.fleetSize ? (
                  <p className="text-xs text-destructive mt-1">{formErrors.fleetSize}</p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    Whole number of vehicles ({MIN_FLEET_SIZE}–{MAX_FLEET_SIZE.toLocaleString()}).
                  </p>
                )}
              </div>
            </div>

            {/* Structured opening hours. Days are picked, times are picked from
                half-hour slots in 12h + AM/PM — nothing is typed, so there is
                nothing to mis-parse later. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>Operating Hours</Label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-muted-foreground">Open 24/7</span>
                  <Switch
                    checked={formData.hoursAlwaysOpen}
                    onCheckedChange={(v) => {
                      setFormData({ ...formData, hoursAlwaysOpen: v });
                      if (formErrors.hours) setFormErrors({ ...formErrors, hours: undefined });
                    }}
                  />
                </label>
              </div>

              {!formData.hoursAlwaysOpen && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_OPTIONS.map((d) => {
                      const on = formData.hoursDays.includes(d.col);
                      return (
                        <Button
                          key={d.col}
                          type="button"
                          size="sm"
                          variant={on ? 'default' : 'outline'}
                          aria-pressed={on}
                          className="w-16"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              hoursDays: on
                                ? formData.hoursDays.filter((x) => x !== d.col)
                                : [...formData.hoursDays, d.col],
                            });
                            if (formErrors.hours) setFormErrors({ ...formErrors, hours: undefined });
                          }}
                        >
                          {d.short}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Opening time"
                      value={formData.hoursOpen}
                      onChange={(e) => {
                        setFormData({ ...formData, hoursOpen: e.target.value });
                        if (formErrors.hours) setFormErrors({ ...formErrors, hours: undefined });
                      }}
                      className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-muted-foreground shrink-0">to</span>
                    <select
                      aria-label="Closing time"
                      value={formData.hoursClose}
                      onChange={(e) => {
                        setFormData({ ...formData, hoursClose: e.target.value });
                        if (formErrors.hours) setFormErrors({ ...formErrors, hours: undefined });
                      }}
                      className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {formErrors.hours ? (
                <p className="text-xs text-destructive mt-1">{formErrors.hours}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Saved as:{' '}
                  <span className="font-medium">
                    {buildOperatingHoursText(
                      formData.hoursAlwaysOpen,
                      formData.hoursDays,
                      formData.hoursOpen,
                      formData.hoursClose,
                    ) || '—'}
                  </span>
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Business Colours (for website)</Label>
              <Input
                maxLength={300}
                value={formData.businessColours}
                onChange={(e) => setFormData({ ...formData, businessColours: e.target.value })}
                placeholder="Black and Gold, minimalistic"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Free text — turned into a full brand palette automatically.
              </p>
            </div>

            <div>
              <Label className="mb-1.5 block">Logo URL</Label>
              <Input
                type="url"
                maxLength={2048}
                value={formData.logoUrl}
                onChange={(e) => {
                  setFormData({ ...formData, logoUrl: e.target.value });
                  if (formErrors.logoUrl) setFormErrors({ ...formErrors, logoUrl: undefined });
                }}
                className={formErrors.logoUrl ? 'border-destructive' : ''}
                placeholder="https://example.com/logo.png"
              />
              {formErrors.logoUrl ? (
                <p className="text-xs text-destructive mt-1">{formErrors.logoUrl}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Optional — the client can upload their own later.</p>
              )}
            </div>

            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Marketing add-on</Label>
                  <p className="text-xs text-muted-foreground">Client wants the paid marketing package.</p>
                </div>
                <Switch
                  checked={formData.wantsMarketing}
                  onCheckedChange={(v) => setFormData({ ...formData, wantsMarketing: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Has Meta ad account</Label>
                  <p className="text-xs text-muted-foreground">Already has a Facebook / Instagram ad account.</p>
                </div>
                <Switch
                  checked={formData.hasMetaAdAccount}
                  onCheckedChange={(v) => setFormData({ ...formData, hasMetaAdAccount: v })}
                />
              </div>
              {formData.hasMetaAdAccount && (
                <div>
                  <Label className="mb-1.5 block">Meta daily budget</Label>
                  <Input
                    value={formData.metaDailyBudget}
                    onChange={(e) => setFormData({ ...formData, metaDailyBudget: e.target.value })}
                    placeholder="$50/day"
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Any other info</Label>
              <Textarea
                rows={3}
                maxLength={5000}
                value={formData.otherInfo}
                onChange={(e) => setFormData({ ...formData, otherInfo: e.target.value })}
                placeholder="Anything else worth noting for this onboarding..."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  setFormErrors({});
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || checkingName}>
                {(creating || checkingName) && <Loader2 className="h-4 w-4 animate-spin" />}
                {checkingName
                  ? 'Checking name...'
                  : creating
                    ? 'Provisioning...'
                    : 'Create Onboarding'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send to client dialog */}
      <Dialog
        open={showResult}
        onOpenChange={(o) => {
          if (!o) {
            setShowResult(false);
            setResult(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-success" />
              {result?.companyName} is ready — send to client
            </DialogTitle>
            <DialogDescription>
              Copy this message and send it to the client. Their password only shows here — it is not stored.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <>
              {/* Website content did not seed — the site is live on placeholder copy. */}
              {result.contentSeeded === false && (
                <Card className="border-warning/50 bg-warning/10">
                  <CardContent className="p-4 flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">Website content did not seed</h3>
                      <p className="text-xs text-muted-foreground">
                        {result.companyName}&apos;s portal and booking site are live, but the site is still
                        rendering Drive247&apos;s placeholder content — our contact email, a promo badge and
                        Drive247 wording on their privacy page.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Fix it before you send this message: open{' '}
                        <span className="font-medium text-foreground">{result.portalUrl}</span> → CMS and
                        re-publish the pages.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Copy-paste message. The only copy control lives in the sticky
                  footer beside Done, so both of the sales person's actions sit
                  together and stay reachable without scrolling this long pane. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Client message</Label>
                </div>
                <Textarea
                  readOnly
                  value={result.message}
                  rows={12}
                  className="font-mono text-xs leading-relaxed"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>

              {/* Read-only recap — no copy buttons here on purpose, "Copy all details"
                  above is the single copy control. Text stays selectable. */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Details</h3>
                  {[
                    ['Email', result.adminEmail],
                    ['Password', result.adminPassword],
                    ['Portal URL', result.portalUrl],
                    ['Booking URL', result.bookingUrl],
                    [
                      'Subscription',
                      `${currencySymbol(result.subscriptionCurrency)}${(result.subscriptionAmount / 100).toFixed(2)}/month`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <code className="block bg-muted/40 px-3 py-2 rounded-md border border-border text-sm font-mono break-all select-all">
                        {value}
                      </code>
                    </div>
                  ))}
                  {result.timezone !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {result.timezone
                        ? `Timezone set to ${result.timezone} from the location you entered.`
                        : 'Timezone could not be worked out from the location — the tenant is on the America/New_York default. Change it in Portal → Settings if that is wrong.'}
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* STICKY on purpose. DialogContent scrolls (max-h-[90vh]
              overflow-y-auto) and DialogFooter is a plain flex div, so a normal
              footer would sit below the whole details list — the sales person
              would have to scroll to the bottom just to copy the handover
              message. Negative margins bleed it to the DialogContent p-6 edges.
              Copy is last so it is rightmost on desktop and, because the footer
              is flex-col-reverse on mobile, topmost there. */}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t bg-background px-6 py-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowResult(false);
                setResult(null);
              }}
            >
              <CheckCircle className="h-4 w-4" />
              Done
            </Button>
            {/* The only copy control in this pane — the message already carries
                the email, password, both URLs and the monthly amount.
                Guarded on `result`: this footer sits OUTSIDE the `result &&`
                block, and Done sets result to null while the dialog is still
                mounted for its close animation, so an unguarded result.message
                would throw during that frame. */}
            {result && (
              <Button onClick={() => copyToClipboard(result.message, 'All details')}>
                <Copy className="h-4 w-4" />
                Copy all details
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
