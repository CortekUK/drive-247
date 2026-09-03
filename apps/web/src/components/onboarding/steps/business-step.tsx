"use client";

/**
 * Step 3 of the self-serve signup dialog — the answers that actually configure
 * the tenant.
 *
 * Every field here maps onto something `signup-provision` writes: the location
 * derives the timezone that drives every pickup time and overdue cron, the
 * schedule becomes the per-day opening-hours columns the booking site reads,
 * and the colour description is fed to the brand-palette builder.
 *
 * Two things dominate the design:
 *
 * 1. **The card is already charged when this renders.** There is no "back", and
 *    a validation failure here must never be a dead end — so every rule is
 *    checked client-side against the SAME logic the server enforces
 *    (`lib/signup-validation.ts`), and every message names a way forward.
 * 2. **The operator no longer picks a web address.** The subdomain is derived
 *    from the business name and told to them afterwards, so there is no field
 *    to type it into and no availability check while typing. The draft still
 *    carries a derived `slug` because the provider posts one; see
 *    `BusinessDraft.slug`. The server can still refuse the derived address,
 *    which is why SLUG_* codes get their own banner at the top of this form —
 *    the dialog shell lists them in INLINE_ONLY_CODES and will not paint them.
 */

import * as React from "react";
import {
  Building2,
  Car,
  Clock,
  ImageIcon,
  Loader2,
  MapPin,
  Palette,
  Phone,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { useOnboardingShell } from "@/components/onboarding/onboarding-provider";
import type { BusinessStepProps } from "@/components/onboarding/onboarding-types";
import {
  DAY_OPTIONS,
  SIGNUP_ERROR_COPY,
  TIME_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/components/onboarding/onboarding-types";
import {
  BUSINESS_FIELD_ORDER,
  deriveSlugFromCompanyName,
  FIELD_MAX,
  firstErrorField,
  fleetNeedsSalesCall,
  validateBusiness,
  type BusinessField,
  type FieldErrors,
} from "@/lib/signup-validation";

/**
 * Logo upload limits, deliberately identical to the admin Sales onboarding
 * dialog (apps/admin/components/admin/SalesOnboardingDialog.tsx) so a tenant
 * created either way lands in the same bucket under the same rules.
 */
const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"] as const;
const MAX_LOGO_MB = 5;
const MAX_LOGO_BYTES = MAX_LOGO_MB * 1024 * 1024;

/** Server codes that belong under a specific input rather than in the banner. */
const SERVER_FIELD_ERRORS: Partial<Record<string, BusinessField>> = {
  TERMS_NOT_ACCEPTED: "acceptedTerms",
};

/**
 * Slug verdicts have nowhere to land now that the field is gone, and the dialog
 * shell deliberately suppresses them (INLINE_ONLY_CODES) on the assumption that
 * this step renders them. It does — here, in the step's own banner — rewritten
 * to talk about the business name, which is the only thing the operator can
 * actually change to fix them.
 */
const SLUG_BANNER_COPY: Partial<Record<string, string>> = {
  SLUG_INVALID:
    "We couldn't create a web address from that business name. Try a slightly different name.",
  SLUG_RESERVED:
    "The web address that business name produces is one we keep for ourselves. Try a slightly different name.",
  SLUG_TAKEN:
    "The web address that business name produces is already in use. Try a slightly different name.",
};

export function BusinessStep({
  plan,
  value,
  busy,
  error,
  onChange,
  onSubmit,
}: BusinessStepProps) {
  const [errors, setErrors] = React.useState<FieldErrors<BusinessField>>({});

  // The catalogue the pricing cards were rendered from. Both fleet-size answers
  // this step can give — "you'll need Scale" and "fleets over N need our team" —
  // are only true relative to a specific set of `maxVehicles` values, so they
  // have to be computed from the same list the operator was quoted from rather
  // than from the hardcoded copy in lib/plans.ts.
  const { plans } = useOnboardingShell();

  const companyNameRef = React.useRef<HTMLInputElement>(null);
  const locationRef = React.useRef<HTMLInputElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const coloursRef = React.useRef<HTMLInputElement>(null);
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = React.useState(false);

  const scheduleRef = React.useRef<HTMLDivElement>(null);
  const termsRef = React.useRef<HTMLButtonElement>(null);
  const fleetRef = React.useRef<HTMLInputElement>(null);
  const vehicleRef = React.useRef<HTMLButtonElement>(null);

  // A server error describes the values that produced it; the moment anything
  // is edited it stops being shown under a field.
  const [staleServerError, setStaleServerError] = React.useState(false);
  React.useEffect(() => {
    setStaleServerError(false);
  }, [error]);

  const patch = React.useCallback(
    (next: Parameters<typeof onChange>[0]) => {
      if (!staleServerError) setStaleServerError(true);
      onChange(next);
    },
    [onChange, staleServerError],
  );

  /**
   * Upload straight to Supabase Storage and keep the PUBLIC URL in the draft.
   *
   * The draft field stays a URL string, so nothing downstream changes:
   * `signup-provision` still receives `logoUrl` and still validates it as an
   * http(s) URL. Only the way the operator produces that URL has changed.
   *
   * Errors are reported into the form's own field-error channel rather than a
   * toast — this dialog has no toaster, and a failure the user cannot see would
   * leave them believing a logo was attached when none was.
   */
  const handleLogoSelect = React.useCallback(
    async (file: File | null) => {
      if (!file) return;
      const reset = () => {
        if (logoInputRef.current) logoInputRef.current.value = "";
      };

      if (!LOGO_MIME_TYPES.includes(file.type as (typeof LOGO_MIME_TYPES)[number])) {
        setErrors((prev) => ({ ...prev, logoUrl: "Logo must be a PNG or JPG image." }));
        reset();
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        setErrors((prev) => ({
          ...prev,
          logoUrl: `Logo must be ${MAX_LOGO_MB}MB or smaller.`,
        }));
        reset();
        return;
      }

      setLogoUploading(true);
      setErrors((prev) => ({ ...prev, logoUrl: undefined }));
      try {
        const ext = file.type === "image/png" ? "png" : "jpg";
        // Random object name: two operators both uploading "logo.png" must not
        // overwrite each other, and this bucket is shared across every tenant.
        const path = `signup/${crypto.randomUUID()}.${ext}`;
        const supabase = getBrowserSupabase();

        const { error: uploadError } = await supabase.storage
          .from("company-logos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
        patch({ logoUrl: data.publicUrl });
      } catch (e) {
        console.error("[signup] logo upload failed:", e);
        setErrors((prev) => ({
          ...prev,
          logoUrl: "We couldn't upload that image. Please try again.",
        }));
      } finally {
        setLogoUploading(false);
        // Reset so re-picking the SAME file after a failure still fires onChange.
        reset();
      }
    },
    [patch],
  );

  const serverError = staleServerError ? null : error;

  const serverFieldError = (field: BusinessField): string | undefined => {
    if (!serverError) return undefined;
    if (SERVER_FIELD_ERRORS[serverError.code] === field) {
      return SIGNUP_ERROR_COPY[serverError.code] ?? serverError.message;
    }
    if (
      serverError.code === "VALIDATION_FAILED" &&
      serverError.detail?.field === field
    ) {
      return serverError.message;
    }
    return undefined;
  };

  const fieldError = (field: BusinessField): string | undefined =>
    errors[field] ?? serverFieldError(field);

  /** A slug verdict the server sent back, phrased as a business-name problem. */
  const slugBannerMessage = serverError
    ? SLUG_BANNER_COPY[serverError.code]
    : undefined;

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextErrors = validateBusiness(value, plan, plans);

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      focusField(firstErrorField(nextErrors, BUSINESS_FIELD_ORDER));
      return;
    }

    onSubmit();
  };

  const focusField = (field: BusinessField | null) => {
    const target: HTMLElement | null =
      field === "companyName"
        ? companyNameRef.current
        : field === "location"
          ? locationRef.current
          : field === "businessPhone"
            ? phoneRef.current
            : field === "fleetSize"
              ? fleetRef.current
              : field === "vehicleType"
                ? vehicleRef.current
                : field === "businessColours"
                  ? coloursRef.current
                  : field === "logoUrl"
                    ? logoInputRef.current
                    : field === "schedule"
                      ? scheduleRef.current
                      : field === "acceptedTerms"
                        ? termsRef.current
                        : null;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  };

  const clearError = (field: BusinessField) =>
    setErrors((prev) => ({ ...prev, [field]: undefined }));

  const schedule = value.schedule;
  const hoursDisabled = busy || schedule.alwaysOpen;

  const toggleDay = (day: string) => {
    const next = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day];
    clearError("schedule");
    patch({ schedule: { ...schedule, days: next } });
  };

  return (
    <form
      id="signup-business-form"
      onSubmit={handleSubmit}
      noValidate
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    >
      {/* Alert carries role="alert", so a slug verdict that arrives after a
          failed provision is announced without us wiring a second live region. */}
      {slugBannerMessage ? (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert />
          <AlertTitle>We couldn&apos;t continue</AlertTitle>
          <AlertDescription className="text-red-600 dark:text-red-400">
            {slugBannerMessage}
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm leading-relaxed text-muted-foreground">
        These answers set up your booking site and your portal. You can change
        all of it later from your portal.
      </p>

      {/* ---------------------------------------------------------------- */}
      <SectionHeading
        icon={<Building2 className="h-3.5 w-3.5" />}
        className="mt-6"
      >
        Your business
      </SectionHeading>

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="signup-company-name">
            Business name
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <Input
            ref={companyNameRef}
            id="signup-company-name"
            name="companyName"
            autoFocus
            autoComplete="organization"
            placeholder="Elite Motors"
            value={value.companyName}
            disabled={busy}
            maxLength={FIELD_MAX.companyName}
            aria-invalid={Boolean(fieldError("companyName"))}
            aria-describedby={
              fieldError("companyName")
                ? "signup-company-name-error"
                : "signup-company-name-help"
            }
            onChange={(e) => {
              const companyName = e.target.value;
              clearError("companyName");
              // The web address is no longer asked for, but the draft still has
              // to carry one: `onboarding-provider.tsx` posts `slug` and refuses
              // to start provisioning when it is malformed. Deriving it here —
              // with the same rule the server uses — keeps that guard satisfied
              // without putting a field in front of the operator.
              patch({
                companyName,
                slug: deriveSlugFromCompanyName(companyName),
              });
            }}
            className="mt-1.5 h-10"
          />
          {fieldError("companyName") ? (
            <FieldError id="signup-company-name-error">
              {fieldError("companyName")}
            </FieldError>
          ) : (
            <p
              id="signup-company-name-help"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              We build your booking site and portal addresses from this name and
              send them to you once your portal is ready.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="signup-location">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            City / area
          </Label>
          <Input
            ref={locationRef}
            id="signup-location"
            name="location"
            autoComplete="address-level2"
            placeholder="Dubai, UAE"
            value={value.location}
            disabled={busy}
            maxLength={FIELD_MAX.location}
            aria-invalid={Boolean(fieldError("location"))}
            aria-describedby={
              fieldError("location")
                ? "signup-location-error"
                : "signup-location-help"
            }
            onChange={(e) => {
              clearError("location");
              patch({ location: e.target.value });
            }}
            className="mt-1.5 h-10"
          />
          {fieldError("location") ? (
            <FieldError id="signup-location-error">
              {fieldError("location")}
            </FieldError>
          ) : (
            <p
              id="signup-location-help"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              We use this to set your time zone and site copy.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="signup-phone">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            Business phone
          </Label>
          <Input
            ref={phoneRef}
            id="signup-phone"
            name="businessPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+971 50 123 4567"
            value={value.businessPhone}
            disabled={busy}
            maxLength={FIELD_MAX.phone}
            aria-invalid={Boolean(fieldError("businessPhone"))}
            aria-describedby={
              fieldError("businessPhone")
                ? "signup-phone-error"
                : "signup-phone-help"
            }
            onChange={(e) => {
              clearError("businessPhone");
              patch({ businessPhone: e.target.value });
            }}
            className="mt-1.5 h-10"
          />
          {fieldError("businessPhone") ? (
            <FieldError id="signup-phone-error">
              {fieldError("businessPhone")}
            </FieldError>
          ) : (
            <p
              id="signup-phone-help"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              Include your country code.
            </p>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Separator className="my-6" />
      <SectionHeading icon={<Car className="h-3.5 w-3.5" />}>
        Your fleet
      </SectionHeading>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="signup-fleet-size">
            Vehicles you run
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          {/* A number, not a band. The old dropdown's bands did not share a
              single boundary with the plan bands, so "does this fleet fit the
              plan they just paid for" was unanswerable; one integer makes it a
              comparison. Kept as text with `inputMode="numeric"` rather than
              type="number": a number input brings spinners, a scroll-wheel that
              silently changes the value, and locale-dependent empty-string
              behaviour we would have to undo anyway. */}
          <Input
            ref={fleetRef}
            id="signup-fleet-size"
            name="fleetSize"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="8"
            value={value.fleetSize}
            disabled={busy}
            maxLength={5}
            aria-invalid={Boolean(fieldError("fleetSize"))}
            aria-describedby={
              fieldError("fleetSize")
                ? "signup-fleet-size-error signup-fleet-size-help"
                : "signup-fleet-size-help"
            }
            onChange={(e) => {
              clearError("fleetSize");
              // Digits only. Stripping on the way in means the draft never
              // holds "12 cars" or "1,2" for the validator to unpick.
              patch({ fleetSize: e.target.value.replace(/\D/g, "") });
            }}
            className="mt-1.5 h-10"
          />
          <p
            id="signup-fleet-size-help"
            className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
          >
            {plan.name} covers up to {plan.maxVehicles} vehicles.
          </p>
          <FieldError id="signup-fleet-size-error">
            {fieldError("fleetSize") ? (
              <>
                {fieldError("fleetSize")}
                {/* Only the "no plan is big enough" verdict gets a link — it is
                    the one failure the operator cannot fix inside this form. */}
                {fleetNeedsSalesCall(value.fleetSize, plans) ? (
                  <>
                    {" "}
                    <a
                      href="/strategy-call"
                      className="font-medium underline underline-offset-4"
                    >
                      Book a strategy call
                    </a>
                    .
                  </>
                ) : null}
              </>
            ) : null}
          </FieldError>
        </div>

        <div>
          <Label htmlFor="signup-vehicle-type">Vehicle type</Label>
          <input type="hidden" name="vehicleType" value={value.vehicleType} />
          <Select
            value={value.vehicleType}
            disabled={busy}
            onValueChange={(v) => {
              clearError("vehicleType");
              patch({ vehicleType: v });
            }}
          >
            <SelectTrigger
              ref={vehicleRef}
              id="signup-vehicle-type"
              className="mt-1.5"
            >
              <SelectValue placeholder="Select vehicle type" />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Separator className="my-6" />
      <SectionHeading icon={<Clock className="h-3.5 w-3.5" />}>
        Opening hours
      </SectionHeading>

      <div ref={scheduleRef} tabIndex={-1} className="mt-4 outline-none">
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="signup-always-open"
            checked={schedule.alwaysOpen}
            disabled={busy}
            onCheckedChange={(checked) => {
              clearError("schedule");
              patch({ schedule: { ...schedule, alwaysOpen: checked === true } });
            }}
          />
          <Label htmlFor="signup-always-open">Open 24/7</Label>
        </div>

        <div
          className={cn(
            "mt-4 space-y-4 transition-opacity",
            schedule.alwaysOpen && "pointer-events-none opacity-50",
          )}
          // Hidden from assistive tech when 24/7 is on: the controls are inert
          // and reading out seven disabled day buttons is pure noise.
          aria-hidden={schedule.alwaysOpen ? "true" : undefined}
        >
          <fieldset disabled={hoursDisabled} className="min-w-0">
            <legend className="text-xs text-muted-foreground">
              Days you&apos;re open
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((day) => {
                const on = schedule.days.includes(day.value);
                return (
                  <Button
                    key={day.value}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                      "min-w-[3.25rem]",
                      on &&
                        "bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600",
                    )}
                  >
                    {day.label}
                  </Button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="signup-opens-at">Opens</Label>
              <input type="hidden" name="opensAt" value={schedule.opensAt} />
              <Select
                value={schedule.opensAt}
                disabled={hoursDisabled}
                onValueChange={(v) =>
                  patch({ schedule: { ...schedule, opensAt: v } })
                }
              >
                <SelectTrigger id="signup-opens-at" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="signup-closes-at">Closes</Label>
              <input type="hidden" name="closesAt" value={schedule.closesAt} />
              <Select
                value={schedule.closesAt}
                disabled={hoursDisabled}
                onValueChange={(v) =>
                  patch({ schedule: { ...schedule, closesAt: v } })
                }
              >
                <SelectTrigger id="signup-closes-at" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <FieldError id="signup-schedule-error">
          {fieldError("schedule")}
        </FieldError>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Separator className="my-6" />
      <SectionHeading icon={<Palette className="h-3.5 w-3.5" />}>
        Your brand
      </SectionHeading>

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="signup-colours">Brand colours</Label>
          <Input
            ref={coloursRef}
            id="signup-colours"
            name="businessColours"
            placeholder="e.g. navy blue and gold"
            value={value.businessColours}
            disabled={busy}
            maxLength={FIELD_MAX.colours}
            aria-invalid={Boolean(fieldError("businessColours"))}
            aria-describedby={
              fieldError("businessColours")
                ? "signup-colours-error"
                : "signup-colours-help"
            }
            onChange={(e) => {
              clearError("businessColours");
              patch({ businessColours: e.target.value });
            }}
            className="mt-1.5 h-10"
          />
          {fieldError("businessColours") ? (
            <FieldError id="signup-colours-error">
              {fieldError("businessColours")}
            </FieldError>
          ) : (
            <p
              id="signup-colours-help"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              Describe your colours in plain English. We&apos;ll build your
              palette from it, and you can change everything later in your
              portal.
            </p>
          )}
        </div>

        {/*
          A real file upload, not a URL box.

          Asking a marketing-site visitor to paste "a direct link to your logo
          image" asks them to already be hosting it somewhere — most operators
          have the file on their laptop, so the field was reliably left empty and
          the tenant launched with no brand mark. This mirrors the admin Sales
          onboarding dialog exactly (same `company-logos` bucket, same random
          object name, same size/type gate), so both paths produce identical URLs.

          The upload is possible here because by the Business step the user has a
          session — the bucket's INSERT policy requires `authenticated`, which an
          anonymous marketing visitor would not satisfy.
        */}
        <div>
          <Label htmlFor="signup-logo">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Logo (optional)
          </Label>

          <input
            ref={logoInputRef}
            id="signup-logo"
            type="file"
            accept={LOGO_MIME_TYPES.join(",")}
            className="sr-only"
            disabled={busy || logoUploading}
            onChange={(e) => void handleLogoSelect(e.target.files?.[0] ?? null)}
          />

          <div className="mt-1.5 flex items-center gap-3">
            {value.logoUrl ? (
              // A just-uploaded Supabase Storage URL is not a build-time known
              // host, so next/image cannot optimise it without a remotePatterns
              // entry per project. This is a 48px preview thumbnail, so the
              // optimiser would buy nothing anyway.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value.logoUrl}
                alt="Your uploaded logo"
                className="h-12 w-12 shrink-0 rounded-md border object-contain"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-dashed">
                <ImageIcon
                  className="h-5 w-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              disabled={busy || logoUploading}
              onClick={() => logoInputRef.current?.click()}
            >
              {logoUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  {value.logoUrl ? "Replace logo" : "Upload logo"}
                </>
              )}
            </Button>

            {value.logoUrl && !logoUploading && (
              <Button
                type="button"
                variant="link"
                disabled={busy}
                onClick={() => {
                  clearError("logoUrl");
                  patch({ logoUrl: "" });
                }}
                className="text-muted-foreground"
              >
                Remove
              </Button>
            )}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {logoUploading
              ? "Uploading your logo."
              : value.logoUrl
                ? "Logo uploaded."
                : ""}
          </p>

          {fieldError("logoUrl") ? (
            <FieldError id="signup-logo-error">
              {fieldError("logoUrl")}
            </FieldError>
          ) : (
            <p
              id="signup-logo-help"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              PNG or JPG, up to {MAX_LOGO_MB}MB. You can change it later in your
              portal.
            </p>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Separator className="my-6" />

      <div className="flex items-start gap-2.5">
        <Checkbox
          ref={termsRef}
          id="signup-terms"
          checked={value.acceptedTerms}
          disabled={busy}
          aria-invalid={Boolean(fieldError("acceptedTerms"))}
          aria-describedby={
            fieldError("acceptedTerms") ? "signup-terms-error" : undefined
          }
          onCheckedChange={(checked) => {
            clearError("acceptedTerms");
            patch({ acceptedTerms: checked === true });
          }}
          className="mt-0.5"
        />
        <Label
          htmlFor="signup-terms"
          className="flex-wrap gap-1 text-sm leading-relaxed font-normal"
        >
          <span>
            I agree to the{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
            >
              Privacy Policy
            </a>
            .
          </span>
        </Label>
      </div>
      <FieldError id="signup-terms-error">
        {fieldError("acceptedTerms")}
      </FieldError>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/**
 * The icon is passed as a rendered element rather than as a component type.
 * apps/web resolves two copies of `@types/react` (its own 19.x plus the
 * hoisted 18.x at the monorepo root), which makes `ComponentType<…>` props
 * incompatible with lucide's `ForwardRefExoticComponent` — the exact error
 * `problem-section.tsx` and `product-showcase.tsx` already carry. Taking a
 * `ReactNode` sidesteps it entirely.
 */
function SectionHeading({
  icon,
  className,
  children,
}: {
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      className={cn(
        "flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {icon}
      {children}
    </h3>
  );
}

function FieldError({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}
