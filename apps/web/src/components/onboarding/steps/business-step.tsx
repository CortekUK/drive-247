"use client";

/**
 * Step 3 of the self-serve signup dialog — the answers that actually configure
 * the tenant.
 *
 * Every field here maps onto something `signup-provision` writes: the slug
 * becomes two live hostnames, the location derives the timezone that drives
 * every pickup time and overdue cron, the schedule becomes the per-day
 * opening-hours columns the booking site reads, and the colour description is
 * fed to the brand-palette builder.
 *
 * Two things dominate the design:
 *
 * 1. **The card is already charged when this renders.** There is no "back", and
 *    a validation failure here must never be a dead end — so every rule is
 *    checked client-side against the SAME logic the server enforces
 *    (`lib/signup-validation.ts`), and the one field that can genuinely fail
 *    server-side, the slug, is checked live against the database while typing.
 * 2. **The slug can never be changed afterwards.** Nothing in the platform
 *    renames a tenant slug, so the field says so out loud rather than letting
 *    someone discover it later.
 */

import * as React from "react";
import {
  Building2,
  Car,
  Check,
  Clock,
  Globe,
  ImageIcon,
  Loader2,
  MapPin,
  Palette,
  Phone,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import type {
  BusinessStepProps,
  SlugCheckResult,
} from "@/components/onboarding/onboarding-types";
import {
  DAY_OPTIONS,
  FLEET_SIZE_OPTIONS,
  SIGNUP_ERROR_COPY,
  TIME_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/components/onboarding/onboarding-types";
import {
  BUSINESS_FIELD_ORDER,
  checkSlugShape,
  deriveSlugFromCompanyName,
  FIELD_MAX,
  firstErrorField,
  normalizeSlugClient,
  sanitizeSlugInput,
  validateBusiness,
  type BusinessField,
  type FieldErrors,
} from "@/lib/signup-validation";

/**
 * Long enough that a normal typist finishes a word before we ask the server,
 * short enough that the answer feels immediate. Also the value the spec pins,
 * so the server-side rate limit (60 slug checks per user per hour) is sized for
 * it.
 */
const SLUG_DEBOUNCE_MS = 450;

type SlugStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "invalid"; message: string }
  | { kind: "available"; slug: string }
  | { kind: "unavailable"; slug: string; message: string; suggestions: string[] }
  | { kind: "error" };

/** Server codes that belong under a specific input rather than in the banner. */
const SERVER_FIELD_ERRORS: Partial<Record<string, BusinessField>> = {
  SLUG_INVALID: "slug",
  SLUG_RESERVED: "slug",
  SLUG_TAKEN: "slug",
  TERMS_NOT_ACCEPTED: "acceptedTerms",
};

export function BusinessStep({
  plan,
  value,
  busy,
  error,
  onChange,
  onCheckSlug,
  onSubmit,
}: BusinessStepProps) {
  const [errors, setErrors] = React.useState<FieldErrors<BusinessField>>({});
  const [slugStatus, setSlugStatus] = React.useState<SlugStatus>({
    kind: "idle",
  });

  const companyNameRef = React.useRef<HTMLInputElement>(null);
  const slugRef = React.useRef<HTMLInputElement>(null);
  const locationRef = React.useRef<HTMLInputElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const coloursRef = React.useRef<HTMLInputElement>(null);
  const logoRef = React.useRef<HTMLInputElement>(null);
  const scheduleRef = React.useRef<HTMLDivElement>(null);
  const termsRef = React.useRef<HTMLButtonElement>(null);
  const fleetRef = React.useRef<HTMLButtonElement>(null);
  const vehicleRef = React.useRef<HTMLButtonElement>(null);

  /**
   * `onCheckSlug` is recreated by the provider on most renders. Holding it in a
   * ref keeps it out of the debounce effect's dependency array — otherwise the
   * timer would be torn down and restarted on every parent render and the
   * request would never actually fire.
   */
  const checkSlugRef = React.useRef(onCheckSlug);
  React.useEffect(() => {
    checkSlugRef.current = onCheckSlug;
  }, [onCheckSlug]);

  /** Monotonic id so a slow earlier response can never overwrite a newer one. */
  const requestIdRef = React.useRef(0);

  const rawSlug = value.slug;

  React.useEffect(() => {
    const shape = checkSlugShape(rawSlug);

    // Nothing typed yet: stay quiet rather than showing a red field before the
    // user has had a chance to fill anything in.
    if (shape.problem === "empty") {
      requestIdRef.current += 1;
      setSlugStatus({ kind: "idle" });
      return;
    }

    // Shape and reserved-list problems are decidable locally — no round trip.
    if (!shape.ok) {
      requestIdRef.current += 1;
      setSlugStatus({ kind: "invalid", message: shape.message ?? "" });
      return;
    }

    const requestId = ++requestIdRef.current;
    setSlugStatus({ kind: "checking" });

    const timer = window.setTimeout(() => {
      checkSlugRef
        .current(shape.slug)
        .then((result: SlugCheckResult) => {
          if (requestId !== requestIdRef.current) return;
          setSlugStatus(toSlugStatus(result));
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          // Availability is a convenience. If the check itself fails we do NOT
          // block the form — the server re-checks on provision and returns a
          // recoverable SLUG_TAKEN, which routes back here with suggestions.
          setSlugStatus({ kind: "error" });
        });
    }, SLUG_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [rawSlug]);

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

  const serverError = staleServerError ? null : error;

  const serverFieldError = (field: BusinessField): string | undefined => {
    if (!serverError) return undefined;
    if (SERVER_FIELD_ERRORS[serverError.code] === field) {
      // Row 20: a slug lost in the race between the availability check and the
      // insert needs its own sentence — "already taken" reads like the user
      // ignored a warning they were never given.
      if (serverError.code === "SLUG_TAKEN") {
        return "That web address was taken while you were filling this in. Try one of these:";
      }
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

  /** Suggestions can arrive from the live check or from a failed provision. */
  const suggestions: string[] = React.useMemo(() => {
    const fromServer = serverError?.detail?.suggestions;
    if (Array.isArray(fromServer)) {
      return fromServer.filter((s): s is string => typeof s === "string");
    }
    return slugStatus.kind === "unavailable" ? slugStatus.suggestions : [];
  }, [serverError, slugStatus]);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextErrors = validateBusiness(value);

    // The live check knows things `validateBusiness` cannot — availability and
    // the server's own view of the reserved list. Fold it in so we never post a
    // slug we already know will be rejected.
    if (!nextErrors.slug) {
      if (slugStatus.kind === "invalid") {
        nextErrors.slug = slugStatus.message;
      } else if (slugStatus.kind === "unavailable") {
        nextErrors.slug = slugStatus.message;
      }
    }

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
        : field === "slug"
          ? slugRef.current
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
                      ? logoRef.current
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

  const previewHost = `${checkSlugShape(value.slug).slug || "yourcompany"}.drive-247.com`;

  return (
    <form
      id="signup-business-form"
      onSubmit={handleSubmit}
      noValidate
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        These answers set up your booking site and your portal. Everything here
        can be changed later from your portal &mdash; except your web address.
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
                : undefined
            }
            onChange={(e) => {
              const companyName = e.target.value;
              clearError("companyName");
              // The slug tracks the business name until the user takes it over.
              // Once they have edited it by hand we never overwrite it again —
              // silently rewriting a hostname someone has chosen is unforgivable.
              patch(
                value.slugTouched
                  ? { companyName }
                  : {
                      companyName,
                      slug: deriveSlugFromCompanyName(companyName),
                    },
              );
            }}
            className="mt-1.5 h-10"
          />
          <FieldError id="signup-company-name-error">
            {fieldError("companyName")}
          </FieldError>
        </div>

        {/* Web address ---------------------------------------------------- */}
        <div>
          <Label htmlFor="signup-slug">
            Web address
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <div
            className={cn(
              "mt-1.5 flex items-stretch overflow-hidden rounded-md border",
              "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
              fieldError("slug") && "border-destructive",
              busy && "opacity-50",
            )}
          >
            <span
              aria-hidden="true"
              className="flex shrink-0 items-center bg-muted px-2.5 text-sm text-muted-foreground sm:px-3"
            >
              https://
            </span>
            <Input
              ref={slugRef}
              id="signup-slug"
              name="slug"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="elite-motors"
              value={value.slug}
              disabled={busy}
              aria-invalid={Boolean(fieldError("slug"))}
              aria-describedby="signup-slug-status signup-slug-help"
              onChange={(e) => {
                clearError("slug");
                // Lenient sanitising while typing: lowercase and map illegal
                // characters, but keep a trailing hyphen so "acme-" can become
                // "acme-cars". Full normalisation happens on blur.
                patch({
                  slug: sanitizeSlugInput(e.target.value),
                  slugTouched: true,
                });
              }}
              onBlur={() => {
                const normalized = normalizeSlugClient(value.slug);
                if (normalized !== value.slug) patch({ slug: normalized });
              }}
              className="h-10 min-w-0 rounded-none border-0 shadow-none focus-visible:ring-0"
            />
            <span
              aria-hidden="true"
              className="flex shrink-0 items-center bg-muted px-2.5 text-sm text-muted-foreground sm:px-3"
            >
              .drive-247.com
            </span>
          </div>

          {/* Live status. One polite live region so the availability answer is
              announced without stealing focus from the field. */}
          <div id="signup-slug-status" aria-live="polite" className="mt-1.5">
            <SlugStatusLine
              status={slugStatus}
              overrideMessage={serverFieldError("slug")}
            />
          </div>

          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Badge key={s} asChild variant="outline">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      clearError("slug");
                      patch({ slug: s, slugTouched: true });
                      slugRef.current?.focus();
                    }}
                    className="cursor-pointer transition-colors hover:border-indigo-600/40 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-indigo-400"
                  >
                    {s}
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <p
            id="signup-slug-help"
            className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
          >
            This becomes your booking site and your portal address. You
            can&apos;t change it later.
            <span className="mt-1 block break-all font-medium text-foreground">
              {previewHost}
            </span>
          </p>
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
          <Label htmlFor="signup-fleet-size">Fleet size</Label>
          {/* Radix Select renders a button, not a <select> — it posts nothing.
              The paired hidden input is the existing app pattern (see
              strategy-call/page.tsx) and keeps the DOM honest. */}
          <input type="hidden" name="fleetSize" value={value.fleetSize} />
          <Select
            value={value.fleetSize || undefined}
            disabled={busy}
            onValueChange={(v) => {
              clearError("fleetSize");
              patch({ fleetSize: v });
            }}
          >
            <SelectTrigger
              ref={fleetRef}
              id="signup-fleet-size"
              className="mt-1.5"
            >
              <SelectValue placeholder="Select fleet size" />
            </SelectTrigger>
            <SelectContent>
              {FLEET_SIZE_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            You picked {plan.name}, sized for {plan.fleetBand}.
          </p>
        </div>

        <div>
          <Label htmlFor="signup-vehicle-type">Vehicle type</Label>
          <input type="hidden" name="vehicleType" value={value.vehicleType} />
          <Select
            value={value.vehicleType || undefined}
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

        <div>
          <Label htmlFor="signup-logo">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            Logo URL (optional)
          </Label>
          <Input
            ref={logoRef}
            id="signup-logo"
            name="logoUrl"
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="https://…"
            value={value.logoUrl}
            disabled={busy}
            aria-invalid={Boolean(fieldError("logoUrl"))}
            aria-describedby={
              fieldError("logoUrl") ? "signup-logo-error" : "signup-logo-help"
            }
            onChange={(e) => {
              clearError("logoUrl");
              patch({ logoUrl: e.target.value });
            }}
            className="mt-1.5 h-10"
          />
          {fieldError("logoUrl") ? (
            <FieldError id="signup-logo-error">
              {fieldError("logoUrl")}
            </FieldError>
          ) : (
            <p
              id="signup-logo-help"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              A direct link to your logo image. You can upload one from your
              portal instead.
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
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-600">
      {children}
    </p>
  );
}

/**
 * The line under the web-address field. `overrideMessage` wins because a server
 * verdict (a slug lost in the insert race) is newer and more authoritative than
 * whatever the last debounced check said.
 */
function SlugStatusLine({
  status,
  overrideMessage,
}: {
  status: SlugStatus;
  overrideMessage?: string;
}) {
  if (overrideMessage) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-red-600">
        <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {overrideMessage}
      </p>
    );
  }

  switch (status.kind) {
    case "checking":
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Checking availability…
        </p>
      );
    case "available":
      return (
        <p className="flex items-start gap-1.5 text-sm text-green-600 dark:text-green-500">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">
            {status.slug}.drive-247.com is available
          </span>
        </p>
      );
    case "invalid":
      return (
        <p className="flex items-start gap-1.5 text-sm text-red-600">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {status.message}
        </p>
      );
    case "unavailable":
      return (
        <p className="flex items-start gap-1.5 text-sm text-red-600">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {status.message}
        </p>
      );
    case "error":
      return (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          We couldn&apos;t check that address just now. You can still continue
          &mdash; we&apos;ll confirm it when you finish.
        </p>
      );
    case "idle":
    default:
      return null;
  }
}

function toSlugStatus(result: SlugCheckResult): SlugStatus {
  if (result.available) return { kind: "available", slug: result.slug };

  const message =
    result.reason === "reserved"
      ? SIGNUP_ERROR_COPY.SLUG_RESERVED
      : result.reason === "invalid"
        ? SIGNUP_ERROR_COPY.SLUG_INVALID
        : SIGNUP_ERROR_COPY.SLUG_TAKEN;

  return {
    kind: "unavailable",
    slug: result.slug,
    message,
    suggestions: result.suggestions ?? [],
  };
}
