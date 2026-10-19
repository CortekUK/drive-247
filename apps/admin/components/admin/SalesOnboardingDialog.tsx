'use client';

/**
 * Onboarding — the full sales provisioning of a rental company, drawn as
 * Northwind's stepped "add" dialogs (portal add-vehicle / add-customer): one
 * small idea per screen, a picture, one line, two rows of fields
 * (components/admin/form-grid.tsx). The done screen is the hand-over.
 *
 * SAVES EXACTLY AS BEFORE: the same validation, the same name check, the same
 * create-sales-onboarding call and the same payment link. Only the
 * presentation is new (Ghulam, Oct 17 2026).
 */

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Copy, Loader2, Upload, X } from 'lucide-react';
import {
  CONTROL,
  Cell,
  ChipToggle,
  CopyRow,
  DoneScreen,
  FORM_DIALOG,
  FORM_DIALOG_WASH,
  Segmented,
  StepFooter,
  StepScreen,
  ToggleTile,
} from '@/components/admin/form-grid';
import { AddCustomerExtrasArt, AddCustomerWhoArt } from '@/components/admin/illustrations/scenes/add-customer';
import {
  AddVehicleAddedArt,
  AddVehicleBookingArt,
  AddVehicleCarArt,
  AddVehiclePhotosArt,
  AddVehicleRatesArt,
} from '@/components/admin/illustrations/scenes/add-vehicle';

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
  /** Payment link minted right after provisioning, so George can paste it
   *  into the call without leaving this pane. Undefined if minting failed —
   *  the onboarding itself still succeeded. */
  subscriptionLinkUrl?: string;
  subscriptionLinkError?: string;
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

/**
 * Logo upload limits. The `company-logos` bucket has NO server-side MIME or
 * size restriction (verified on prod: allowed_mime_types and file_size_limit
 * are both null), so these checks are the ONLY gate — not decoration.
 */
const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'];
const MAX_LOGO_MB = 5;
const MAX_LOGO_BYTES = MAX_LOGO_MB * 1024 * 1024;

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
  /**
   * Structured opening hours — no free-text parsing guesswork.
   * Starts EMPTY on purpose: hours aren't required on the Google form, and
   * pre-selecting Mon–Fri 9–6 would publish invented opening times on the
   * client's live booking site for any client who was never asked.
   */
  hoursAlwaysOpen: false,
  hoursDays: [] as string[],
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
  // Strip a trailing extension first ("x102", "ext. 4", "#9"). Business lines
  // are commonly written that way and the bare pattern rejected them outright,
  // which blocks a real sale — a false rejection costs more than a false accept.
  const base = value.trim().replace(/\s*(?:ext\.?|x|#)\s*\d{1,6}$/i, '').trim();
  const digits = base.replace(/[^\d]/g, '');
  return /^\+?[\d\s()./-]+$/.test(base) && digits.length >= 7 && digits.length <= 15;
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

type FormErrors = {
  companyName?: string;
  contactEmail?: string;
  businessPhone?: string;
  slug?: string;
  subscriptionAmount?: string;
  fleetSize?: string;
  vehicleTypeOther?: string;
  hours?: string;
  logoUrl?: string;
};

/** The screen each checked field lives on, and the order they are checked in. */
const FIELD_STEP: Record<keyof FormErrors, number> = {
  companyName: 0,
  contactEmail: 0,
  businessPhone: 0,
  slug: 1,
  subscriptionAmount: 1,
  fleetSize: 2,
  vehicleTypeOther: 2,
  hours: 3,
  logoUrl: 4,
};
const FIELD_ORDER = Object.keys(FIELD_STEP) as (keyof FormErrors)[];

const STEPS = ['The client', 'Address and plan', 'Their fleet', 'Opening hours', 'Their brand', 'Marketing'] as const;

export default function SalesOnboardingDialog({ open, onOpenChange, onCreated }: SalesOnboardingDialogProps) {
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [step, setStep] = useState(0);
  /** Set while we check the business name isn't already taken. */
  const [checkingName, setCheckingName] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  // Live preview of the subdomain the tenant will actually get.
  const previewSlug = normalizeSlug(formData.slug);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  /**
   * Upload the client's logo straight into the public `company-logos` bucket
   * and keep the resulting URL in `logoUrl`. The edge-function contract is
   * unchanged — it still just receives a URL — so nothing server-side moves.
   *
   * Uploading on SELECT (rather than at submit) means a failure surfaces while
   * the sales person is still on the logo field, not after they have filled in
   * the whole form.
   */
  const handleLogoSelect = async (file: File | null) => {
    if (!file) return;

    if (!LOGO_MIME_TYPES.includes(file.type)) {
      toast.error('Logo must be a PNG, JPG or JPEG image');
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(`Logo must be ${MAX_LOGO_MB}MB or smaller`);
      if (logoInputRef.current) logoInputRef.current.value = '';
      return;
    }

    setLogoUploading(true);
    try {
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      // Random name: two clients called "logo.png" must not overwrite each
      // other, and the bucket is shared across every tenant.
      const path = `onboarding/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('company-logos').getPublicUrl(path);
      setFormData((prev) => ({ ...prev, logoUrl: data.publicUrl }));
      setFormErrors((prev) => ({ ...prev, logoUrl: undefined }));
      toast.success('Logo uploaded');
    } catch (err: any) {
      toast.error(`Logo upload failed: ${err?.message || 'unknown error'}`);
    } finally {
      setLogoUploading(false);
      // Reset so re-picking the SAME file after a failure still fires onChange.
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

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

  /**
   * Every field check, in one place: Next runs it for the screen it is
   * leaving, and submit runs it for all of them.
   */
  const validate = () => {
    const slug = normalizeSlug(formData.slug);
    const slugError = validateSlug(slug);

    const amount = parseFloat(formData.subscriptionAmount);
    let amountError: string | null = null;
    if (!Number.isFinite(amount) || amount <= 0) {
      amountError = 'Enter a monthly amount greater than 0';
    } else if (amount > MAX_SUBSCRIPTION_AMOUNT) {
      amountError = `Amount must be ${MAX_SUBSCRIPTION_AMOUNT.toLocaleString()} or less`;
    }

    const companyNameError = formData.companyName.trim() ? null : 'Enter the business name';

    const email = formData.contactEmail.trim().toLowerCase();
    const emailError = !isEmail(email) ? 'Enter a valid email address' : null;

    // Phone is optional on the Google form, so only validate what was typed.
    const phone = formData.businessPhone.trim();
    const phoneError =
      phone && !isPhone(phone) ? 'Enter a valid phone number, including the country code' : null;

    // Fleet size is a vehicle COUNT. Must LOOK like a plain whole number, not
    // merely survive Number(): "1e3", "0x10", "5.0" and "+5" all parse to a
    // valid integer but are not counts. `\d+` also rejects negatives outright.
    const fleetRaw = formData.fleetSize.trim();
    let fleetError: string | null = null;
    let fleetValue: string | undefined;
    if (fleetRaw) {
      if (!/^\d+$/.test(fleetRaw)) {
        fleetError = 'Fleet size must be a whole number';
      } else {
        const n = Number(fleetRaw);
        if (n < MIN_FLEET_SIZE) {
          fleetError = `Fleet size must be at least ${MIN_FLEET_SIZE}`;
        } else if (n > MAX_FLEET_SIZE) {
          fleetError = `Fleet size must be ${MAX_FLEET_SIZE.toLocaleString()} or less`;
        } else {
          fleetValue = String(n); // normalised — never the raw typed string
        }
      }
    }

    // Ticking "Other" and leaving the box blank used to discard the whole
    // answer silently. Make it explicit instead.
    const vehicleOtherError =
      formData.vehicleTypes.includes('Other') && !formData.vehicleTypeOther.trim()
        ? 'Tell us what "Other" means, or untick it'
        : null;

    // Hours are NOT required on the Google form. No days + not 24/7 simply
    // means "they didn't say", and we send nothing rather than inventing a
    // schedule that would be published on the client's live website.
    const hoursGiven = formData.hoursAlwaysOpen || formData.hoursDays.length > 0;
    let hoursError: string | null = null;
    if (hoursGiven && !formData.hoursAlwaysOpen && formData.hoursOpen >= formData.hoursClose) {
      // "HH:MM" is zero-padded 24h, so a plain string compare orders correctly.
      hoursError = 'Closing time must be after opening time';
    }

    const logoUrl = formData.logoUrl.trim();
    const logoError = logoUrl && !isHttpUrl(logoUrl) ? 'Enter a full http(s) URL, e.g. https://…/logo.png' : null;

    const errors: FormErrors = {
      companyName: companyNameError || undefined,
      contactEmail: emailError || undefined,
      businessPhone: phoneError || undefined,
      slug: slugError || undefined,
      subscriptionAmount: amountError || undefined,
      fleetSize: fleetError || undefined,
      vehicleTypeOther: vehicleOtherError || undefined,
      hours: hoursError || undefined,
      logoUrl: logoError || undefined,
    };
    return { errors, slug, amount, email, phone, fleetValue, hoursGiven, logoUrl };
  };

  const handleSubmit = async () => {
    // Belt-and-braces for the disabled submit button: any other submit path
    // (implicit Enter-key submission, programmatic) must not race the upload
    // and provision a logo-less tenant.
    if (logoUploading) {
      toast.error('Your logo is still uploading — give it a second.');
      return;
    }

    const { errors, slug, amount, email, phone, fleetValue, hoursGiven, logoUrl } = validate();
    const firstKey = FIELD_ORDER.find((k) => errors[k]);
    if (firstKey) {
      setFormErrors(errors);
      // Back to the first screen holding a problem, so it is in view.
      setStep(FIELD_STEP[firstKey]);
      toast.error(errors[firstKey]!);
      return;
    }
    setFormErrors({});
    const companyName = formData.companyName.trim();

    // Business-name uniqueness. The edge function re-checks this atomically and
    // is the authority; doing it here just saves the sales person a round trip
    // and a scary error mid-call. A failure to check is deliberately non-fatal.
    setCheckingName(true);
    try {
      // Select the NAME too and re-verify it exactly, mirroring the server.
      // In ILIKE the pattern is raw operator input, so `_` and `%` are
      // wildcards: without this re-check "Rent_A_Car" falsely matches an
      // existing "RentXACar" and hard-blocks a legitimate submission that the
      // server would have allowed.
      const { data: clash } = await (supabase as any)
        .from('tenants')
        .select('id, company_name')
        .ilike('company_name', companyName);
      const taken = (clash || []).some(
        (t: { company_name: string | null }) =>
          (t.company_name || '').trim().toLowerCase() === companyName.toLowerCase(),
      );
      if (taken) {
        const msg = 'Another rental company already uses this name';
        setFormErrors({ companyName: msg });
        setStep(FIELD_STEP.companyName);
        toast.error(msg);
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
          // Normalised, never the raw typed string.
          fleetSize: fleetValue,
          location: formData.location.trim() || undefined,
          // Hours are only sent when the client actually gave them. Sending a
          // default would publish invented opening times on their live site.
          operatingHours: hoursGiven ? operatingHoursText || undefined : undefined,
          // ...plus the STRUCTURED values, so the edge function never has to
          // guess what free text meant. It writes the per-day open/close
          // columns straight from these.
          operatingSchedule: hoursGiven
            ? {
                alwaysOpen: formData.hoursAlwaysOpen,
                days: formData.hoursAlwaysOpen ? DAY_OPTIONS.map((d) => d.col) : formData.hoursDays,
                opensAt: formData.hoursAlwaysOpen ? '00:00' : formData.hoursOpen,
                closesAt: formData.hoursAlwaysOpen ? '23:59' : formData.hoursClose,
              }
            : undefined,
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

      // Mint the payment link straight away. The whole point of the meeting was
      // that George should not have to walk the client through logging in, so
      // the link has to be on screen at the same moment as the credentials.
      // Failure here is NON-FATAL: the tenant is provisioned either way, and the
      // tenant page still has a Generate button.
      try {
        const { data: linkData, error: linkError } = await supabase.functions.invoke(
          'create-subscription-link',
          { body: { tenantId: data.tenantId, kind: 'first' } },
        );
        if (linkError || !linkData?.url) {
          let why = linkError?.message || 'Could not generate a payment link';
          try {
            const b = await (linkError as any)?.context?.json?.();
            if (b?.error) why = b.error;
          } catch { /* keep the generic reason */ }
          setResult((r) => (r ? { ...r, subscriptionLinkError: why } : r));
        } else {
          setResult((r) => (r ? { ...r, subscriptionLinkUrl: linkData.url } : r));
        }
      } catch (e: any) {
        setResult((r) => (r ? { ...r, subscriptionLinkError: e?.message || 'Could not generate a payment link' } : r));
      }
      // The hand-over is the dialog's last screen, in the same frame.
      setFormData({ ...EMPTY_FORM });
      setStep(0);
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

  const last = step === STEPS.length - 1;
  const busy = creating || checkingName || logoUploading;

  /** Next: check only the screen being left, so a problem shows where it is. */
  const next = () => {
    const { errors } = validate();
    const here = FIELD_ORDER.filter((k) => FIELD_STEP[k] === step && errors[k]);
    if (here.length) {
      setFormErrors((prev) => ({ ...prev, ...Object.fromEntries(here.map((k) => [k, errors[k]])) }));
      return;
    }
    setStep(step + 1);
  };

  const close = () => {
    onOpenChange(false);
    setStep(0);
    setFormErrors({});
    setResult(null);
  };

  /** Field setter that also clears that field's error as it is corrected. */
  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K], clear?: keyof FormErrors) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (clear && formErrors[clear]) setFormErrors((prev) => ({ ...prev, [clear]: undefined }));
  };

  const text = (
    key: 'firstName' | 'companyName' | 'slug' | 'contactEmail' | 'businessPhone' | 'subscriptionAmount' | 'location' | 'fleetSize' | 'businessColours' | 'metaDailyBudget' | 'otherInfo' | 'vehicleTypeOther',
    placeholder: string,
    opts: { clear?: keyof FormErrors; type?: string; maxLength?: number; prefix?: string; disabled?: boolean } = {},
  ) => (
    <div className="relative">
      {opts.prefix && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {opts.prefix}
        </span>
      )}
      <input
        type={opts.type ?? 'text'}
        value={formData[key]}
        placeholder={placeholder}
        maxLength={opts.maxLength}
        disabled={opts.disabled}
        aria-invalid={(opts.clear && !!formErrors[opts.clear]) || undefined}
        onChange={(e) => set(key, e.target.value, opts.clear)}
        className={cn(
          CONTROL,
          opts.prefix && 'pl-8',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
        autoComplete="off"
      />
    </div>
  );

  const timeSelect = (key: 'hoursOpen' | 'hoursClose', label: string) => (
    <select
      aria-label={label}
      value={formData[key]}
      disabled={formData.hoursAlwaysOpen}
      onChange={(e) => set(key, e.target.value, 'hours')}
      className={cn(CONTROL, 'cursor-pointer')}
    >
      {TIME_OPTIONS.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
    </select>
  );

  const hoursText = buildOperatingHoursText(
    formData.hoursAlwaysOpen,
    formData.hoursDays,
    formData.hoursOpen,
    formData.hoursClose,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent
        className={FORM_DIALOG}
        style={FORM_DIALOG_WASH}
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input:not([type=hidden]):not([type=file])')?.focus();
        }}
      >
        <DialogTitle className="sr-only">Onboard a rental company</DialogTitle>
        <DialogDescription className="sr-only">
          {result ? `${result.companyName} is ready` : STEPS[step]}
        </DialogDescription>

        {result ? (
          /* Done: the hand-over. The password only ever shows here. */
          <div className="flex flex-col">
            <DoneScreen
              art={AddVehicleAddedArt}
              title={`${result.companyName} is ready.`}
              line="Their portal, booking site and paywall are live. Send them the details below; the password only shows here."
            >
              {result.contentSeeded === false && (
                <p className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-700 dark:text-amber-300">
                  Their website content did not seed, so the site still shows placeholder copy. Re-publish the pages
                  from {result.portalUrl} → CMS before you send this.
                </p>
              )}
              <div className="rounded-2xl border border-foreground/10 bg-background/80 px-4">
                {result.subscriptionLinkUrl ? (
                  <CopyRow
                    label="Payment link"
                    value={result.subscriptionLinkUrl}
                    onCopy={() => copyToClipboard(result.subscriptionLinkUrl!, 'Payment link')}
                  />
                ) : (
                  <div className="flex items-center gap-3 border-b border-border/60 py-2.5">
                    <span className="w-24 shrink-0 text-[13px] text-muted-foreground">Payment link</span>
                    <span className={cn('min-w-0 flex-1 text-[13px]', result.subscriptionLinkError ? 'text-destructive' : 'text-muted-foreground')}>
                      {result.subscriptionLinkError
                        ? `${result.subscriptionLinkError}. Generate one from the company's Subscription tab.`
                        : 'Generating…'}
                    </span>
                  </div>
                )}
                <CopyRow label="Email" value={result.adminEmail} onCopy={() => copyToClipboard(result.adminEmail, 'Email')} />
                <CopyRow label="Password" value={result.adminPassword} onCopy={() => copyToClipboard(result.adminPassword, 'Password')} />
                <CopyRow label="Portal" value={result.portalUrl} href={result.portalUrl} onCopy={() => copyToClipboard(result.portalUrl, 'Portal URL')} />
                <CopyRow label="Booking site" value={result.bookingUrl} href={result.bookingUrl} onCopy={() => copyToClipboard(result.bookingUrl, 'Booking URL')} />
                <CopyRow
                  label="Plan"
                  value={`${currencySymbol(result.subscriptionCurrency)}${(result.subscriptionAmount / 100).toFixed(2)}/month`}
                  onCopy={() =>
                    copyToClipboard(
                      `${currencySymbol(result.subscriptionCurrency)}${(result.subscriptionAmount / 100).toFixed(2)}/month`,
                      'Plan',
                    )
                  }
                />
              </div>
              {result.timezone !== undefined && (
                <p className="mt-2 px-1 text-xs text-muted-foreground">
                  {result.timezone
                    ? `Timezone set to ${result.timezone} from the location.`
                    : 'Timezone could not be worked out from the location, so it is America/New_York. Change it in Portal → Settings if that is wrong.'}
                </p>
              )}
            </DoneScreen>
            <div className="flex items-center justify-between gap-4 px-8 py-4">
              <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={close}>
                Done
              </Button>
              <Button type="button" className="h-10 rounded-full px-5" onClick={() => copyToClipboard(result.message, 'Client message')}>
                <Copy className="size-4" /> Copy client message
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (last) void handleSubmit();
              else next();
            }}
            className="flex flex-col"
          >
            {step === 0 && (
              <StepScreen
                stepKey={0}
                art={AddCustomerWhoArt}
                title="Who's the client?"
                line="The business and the person you're talking to. The name becomes their portal's name and their site's title."
              >
                <Cell label="First name">{text('firstName', 'e.g. George', { maxLength: 80 })}</Cell>
                <Cell label="Business name" required error={formErrors.companyName}>
                  {text('companyName', 'e.g. Acme Rentals', { clear: 'companyName', maxLength: 100 })}
                </Cell>
                <Cell label="Business email" required error={formErrors.contactEmail}>
                  {text('contactEmail', 'admin@acmerentals.com', { clear: 'contactEmail', type: 'email' })}
                </Cell>
                <Cell label="Business phone" error={formErrors.businessPhone} hint="With the country code">
                  {text('businessPhone', '+1 555 123 4567', { clear: 'businessPhone', type: 'tel', maxLength: 40 })}
                </Cell>
              </StepScreen>
            )}

            {step === 1 && (
              <StepScreen
                stepKey={1}
                art={AddVehicleRatesArt}
                title="Their address and plan"
                line={
                  formData.tenantType === 'production'
                    ? 'A real client: the paywall charges real money and e-signatures are legally binding.'
                    : 'A dry run: the paywall takes a Stripe test card and e-signatures are sandbox copies.'
                }
              >
                <Cell
                  label="Subdomain"
                  required
                  className="col-span-2"
                  error={formErrors.slug}
                  hint={`${previewSlug || 'slug'}.portal.drive-247.com · ${previewSlug || 'slug'}.drive-247.com`}
                >
                  {text('slug', 'acme-rentals', { clear: 'slug', maxLength: 50 })}
                </Cell>
                <Cell label="Type" required hint="Both start with 100 live + 1000 test credits">
                  <Segmented
                    value={formData.tenantType}
                    options={[
                      { value: 'production', label: 'Production' },
                      { value: 'test', label: 'Test' },
                    ]}
                    onChange={(v) => set('tenantType', v)}
                  />
                </Cell>
                <Cell label="Monthly subscription" required error={formErrors.subscriptionAmount} hint="Charged through the paywall">
                  {text('subscriptionAmount', '300', { clear: 'subscriptionAmount', type: 'number', prefix: '$' })}
                </Cell>
              </StepScreen>
            )}

            {step === 2 && (
              <StepScreen
                stepKey={2}
                art={AddVehicleCarArt}
                title="Their fleet"
                line="Where they rent and what they rent. Their website is written around it."
              >
                <Cell label="Location" hint="Sets their timezone">
                  {text('location', 'e.g. Los Angeles, CA', { maxLength: 120 })}
                </Cell>
                <Cell
                  label="Fleet size"
                  error={formErrors.fleetSize}
                  hint={`Number of vehicles, ${MIN_FLEET_SIZE}–${MAX_FLEET_SIZE.toLocaleString()}`}
                >
                  {text('fleetSize', '12', { clear: 'fleetSize', type: 'number' })}
                </Cell>
                <Cell label="Vehicle types" className="col-span-2" error={formErrors.vehicleTypeOther} hint="Pick all that apply">
                  <div className="flex h-11 items-center gap-2">
                    {[...VEHICLE_TYPE_OPTIONS, 'Other'].map((opt) => {
                      const selected = formData.vehicleTypes.includes(opt);
                      return (
                        <ChipToggle
                          key={opt}
                          on={selected}
                          className="shrink-0"
                          onClick={() => {
                            setFormData((prev) => ({
                              ...prev,
                              vehicleTypes: selected ? prev.vehicleTypes.filter((v) => v !== opt) : [...prev.vehicleTypes, opt],
                              // Drop stale text if "Other" is unticked.
                              vehicleTypeOther: selected && opt === 'Other' ? '' : prev.vehicleTypeOther,
                            }));
                            if (formErrors.vehicleTypeOther) setFormErrors((p) => ({ ...p, vehicleTypeOther: undefined }));
                          }}
                        >
                          {opt}
                        </ChipToggle>
                      );
                    })}
                    {formData.vehicleTypes.includes('Other') && (
                      <input
                        // 60, not 120: the value is JOINED with the ticked
                        // options and the server caps the combined string at 120.
                        maxLength={60}
                        value={formData.vehicleTypeOther}
                        placeholder="e.g. Vans"
                        aria-invalid={!!formErrors.vehicleTypeOther || undefined}
                        onChange={(e) => set('vehicleTypeOther', e.target.value, 'vehicleTypeOther')}
                        className={cn(CONTROL, 'h-9 min-w-0 flex-1')}
                        autoFocus
                      />
                    )}
                  </div>
                </Cell>
              </StepScreen>
            )}

            {step === 3 && (
              <StepScreen
                stepKey={3}
                art={AddVehicleBookingArt}
                title="When are they open?"
                line="Only if they said. Left empty, nothing is published, rather than hours we made up."
              >
                <Cell label="Open 24/7">
                  <ToggleTile
                    label="Open 24/7"
                    checked={formData.hoursAlwaysOpen}
                    on="Always open"
                    off="Set hours"
                    onChange={(v) => set('hoursAlwaysOpen', v, 'hours')}
                  />
                </Cell>
                <Cell label="Hours" error={formErrors.hours} hint={hoursText ? `Saved as: ${hoursText}` : 'Not given'}>
                  <div className={cn('flex items-center gap-2', formData.hoursAlwaysOpen && 'opacity-50')}>
                    {timeSelect('hoursOpen', 'Opening time')}
                    <span className="shrink-0 text-sm text-muted-foreground">to</span>
                    {timeSelect('hoursClose', 'Closing time')}
                  </div>
                </Cell>
                <Cell label="Days" className="col-span-2">
                  <div className={cn('flex h-11 items-center gap-1.5', formData.hoursAlwaysOpen && 'pointer-events-none opacity-50')}>
                    {DAY_OPTIONS.map((d) => {
                      const on = formData.hoursDays.includes(d.col);
                      return (
                        <ChipToggle
                          key={d.col}
                          on={on}
                          className="flex-1 px-0"
                          onClick={() =>
                            set(
                              'hoursDays',
                              on ? formData.hoursDays.filter((x) => x !== d.col) : [...formData.hoursDays, d.col],
                              'hours',
                            )
                          }
                        >
                          {d.short}
                        </ChipToggle>
                      );
                    })}
                  </div>
                </Cell>
              </StepScreen>
            )}

            {step === 4 && (
              <StepScreen
                stepKey={4}
                art={AddVehiclePhotosArt}
                title="Their brand"
                line="Their colours become a full palette, and the logo goes everywhere their name does."
              >
                <Cell label="Business colours" className="col-span-2" hint="Free text, e.g. black and gold, minimal">
                  {text('businessColours', 'e.g. Black and gold, minimalistic', { maxLength: 300 })}
                </Cell>
                <Cell
                  label="Logo"
                  className="col-span-2"
                  error={formErrors.logoUrl}
                  hint={`Optional. PNG or JPG, up to ${MAX_LOGO_MB}MB. They can change it later.`}
                >
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => void handleLogoSelect(e.target.files?.[0] ?? null)}
                  />
                  {formData.logoUrl ? (
                    <div className={cn(CONTROL, 'flex items-center gap-3 px-2')}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={formData.logoUrl} alt="Logo preview" className="size-8 rounded-md bg-muted object-contain" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                        Set as their logo, dark logo, login logo and favicon
                      </span>
                      <button
                        type="button"
                        aria-label="Remove logo"
                        onClick={() => set('logoUrl', '')}
                        className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={logoUploading}
                      onClick={() => logoInputRef.current?.click()}
                      className={cn(CONTROL, 'flex cursor-pointer items-center justify-center gap-2 border-dashed text-muted-foreground')}
                    >
                      {logoUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {logoUploading ? 'Uploading…' : 'Upload logo'}
                    </button>
                  )}
                </Cell>
              </StepScreen>
            )}

            {step === 5 && (
              <StepScreen
                stepKey={5}
                art={AddCustomerExtrasArt}
                title="Marketing, and anything else"
                line="Whether they want the paid marketing package, and anything worth noting for the team."
              >
                <Cell label="Marketing add-on">
                  <ToggleTile
                    label="Marketing add-on"
                    checked={formData.wantsMarketing}
                    on="Wants marketing"
                    off="No marketing"
                    onChange={(v) =>
                      setFormData((prev) => ({
                        ...prev,
                        wantsMarketing: v,
                        // A hidden budget was still submitted; clear it.
                        metaDailyBudget: v ? prev.metaDailyBudget : '',
                      }))
                    }
                  />
                </Cell>
                <Cell label="Meta ad account">
                  <ToggleTile
                    label="Has a Meta ad account"
                    checked={formData.hasMetaAdAccount}
                    on="Has one"
                    off="Doesn't have one"
                    onChange={(v) => set('hasMetaAdAccount', v)}
                  />
                </Cell>
                <Cell label="Meta daily budget" hint={formData.wantsMarketing ? undefined : 'With the marketing add-on'}>
                  {text('metaDailyBudget', '$50/day', { maxLength: 60, disabled: !formData.wantsMarketing })}
                </Cell>
                <Cell label="Anything else">
                  {text('otherInfo', 'Worth noting for this onboarding…', { maxLength: 5000 })}
                </Cell>
              </StepScreen>
            )}

            <StepFooter
              steps={STEPS}
              step={step}
              loading={busy}
              onBack={() => setStep(step - 1)}
              onCancel={close}
              finishLabel="Create company"
              busyLabel={checkingName ? 'Checking name…' : logoUploading ? 'Uploading logo…' : 'Provisioning…'}
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
