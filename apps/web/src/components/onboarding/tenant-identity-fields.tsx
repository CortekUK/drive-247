"use client";

/**
 * Business name + web address + terms — the three answers `signup-provision`
 * actually requires from the operator. With `askCityState`, "City and state"
 * sits under the business name: a signup answer for the team, not part of the
 * tenant (see `BusinessDraft.cityState`).
 *
 * They live in their own component because two places render them: the account
 * step (the normal path, before any money moves) and the boot screen's "that
 * address was taken while you were paying" panel. A second copy of a field whose
 * verdicts, debounce and suggestion list all have to agree is how the two
 * surfaces end up disagreeing about whether an address is free.
 *
 * WHY THE OPERATOR PICKS THE ADDRESS AGAIN
 * ----------------------------------------
 * The previous design derived the subdomain from the business name and told
 * nobody until it was over. That is defensible when the only alternative is
 * asking for it AFTER the card is charged — a "that address is taken" at that
 * point is a dead end. Asking BEFORE payment removes the reason: the operator
 * sees the address, sees it is free, and can change it for nothing. Nothing in
 * the platform renames a tenant slug afterwards, so this is the only moment the
 * question can honestly be asked.
 */

import * as React from "react";
import { Check, Info, Loader2, TriangleAlert } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  checkSlugShape,
  deriveSlugFromCompanyName,
  FIELD_MAX,
  sanitizeSlugInput,
  type AccountField,
  type FieldErrors,
} from "@/lib/signup-validation";

import type { BusinessDraft, SlugCheckResult } from "./onboarding-types";
import { BrandLookField } from "./brand-look-field";
import { CityStateField } from "./city-state-field";
import { FieldError, RequiredMark, SIGNUP_INPUT, SIGNUP_LABEL } from "./signup-ui";

/**
 * Long enough that a normal typist finishes a word first, short enough that the
 * verdict feels attached to what they typed. The server rate-limits this at 60
 * checks/hour per user, which ~450 ms comfortably respects.
 */
const SLUG_DEBOUNCE_MS = 450;

/** The visible half of the hostname. Purely presentational — never sent. */
const SLUG_SUFFIX = ".drive-247.com";

/**
 * Whether a change came from a keystroke (typing, deleting, pasting,
 * dictation, a keyboard's autocorrect) rather than from autofill.
 *
 * Browsers send typed edits as an `InputEvent` carrying an `inputType`.
 * Autofill sets the value and fires a plain `input` event with none. On
 * 21 Nov a phone's autofill wrote into "Web address" twice without a keystroke
 * (PostHog autocapture), and because every change counted as the operator's
 * own choice, the address stopped following the business name.
 */
export function isTypedChange(event: Event): boolean {
  const inputType = (event as Partial<InputEvent>).inputType;
  return typeof inputType === "string" && inputType.length > 0;
}

/**
 * Placeholders are examples, marked "e.g.", never something that reads as an
 * answer. "Acme Car Rentals" in grey looked like a filled-in name: Orlando
 * (21 Nov) never tapped the field, and PostHog's Replay Vision also read it as
 * typed text. Under an error the example goes, so the box looks as empty as
 * it is.
 */
const examplePlaceholder = (example: string, error: string | undefined, empty: boolean) =>
  error && empty ? "" : `e.g. ${example}`;

export type SlugState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; slug: string }
  /** The lookup itself failed. Not a verdict — see `SlugCheckResult.reason`. */
  | { kind: "unchecked" }
  | { kind: "unavailable"; reason: "taken" | "reserved" | "invalid"; suggestions: string[] };

export interface TenantIdentityFieldsProps {
  value: BusinessDraft;
  busy: boolean;
  errors: FieldErrors<AccountField>;
  onChange(patch: Partial<BusinessDraft>): void;
  /** Clears the inline error for a field the operator has just edited. */
  onClearError(field: AccountField): void;
  onCheckSlug(slug: string): Promise<SlugCheckResult>;
  /** Reported upward so the submit handler can refuse a known-taken address. */
  onSlugStateChange?(state: SlugState): void;
  companyNameRef?: React.RefObject<HTMLInputElement | null>;
  slugRef?: React.RefObject<HTMLInputElement | null>;
  termsRef?: React.RefObject<HTMLButtonElement | null>;
  /** Autofocus the business name. False when this sits below other fields. */
  autoFocusCompanyName?: boolean;
  /**
   * Ask "City and state" under the business name. On wherever the signup asks
   * for the business; off on the build screen's "pick another address" panel,
   * which is only about the web address.
   */
  askCityState?: boolean;
  cityStateRef?: React.RefObject<HTMLInputElement | null>;
  /**
   * Offer the brand colour and the booking site's light or dark under the web
   * address. On wherever the signup asks for the business; off on the build
   * screen's "pick another address" panel.
   */
  askLook?: boolean;
}

export function TenantIdentityFields({
  value,
  busy,
  errors,
  onChange,
  onClearError,
  onCheckSlug,
  onSlugStateChange,
  companyNameRef,
  slugRef,
  termsRef,
  autoFocusCompanyName = false,
  askCityState = false,
  cityStateRef,
  askLook = false,
}: TenantIdentityFieldsProps) {
  const [slugState, setSlugState] = React.useState<SlugState>({ kind: "idle" });

  React.useEffect(() => {
    onSlugStateChange?.(slugState);
  }, [slugState, onSlugStateChange]);

  /**
   * Every check is stamped with the slug it was issued for, and a reply is
   * dropped unless it still matches what is in the box.
   *
   * Without this, typing "acme" then "acmecars" can render "acme is taken" under
   * "acmecars" — responses do not come back in the order they were sent, and a
   * stale verdict about a different string is worse than no verdict.
   */
  const requestedRef = React.useRef<string>("");

  const runCheck = React.useCallback(
    async (slug: string) => {
      requestedRef.current = slug;
      setSlugState({ kind: "checking" });
      try {
        const result = await onCheckSlug(slug);
        if (requestedRef.current !== slug) return;
        if (result.reason === "unknown") {
          setSlugState({ kind: "unchecked" });
          return;
        }
        if (result.available) {
          setSlugState({ kind: "available", slug: result.slug });
          return;
        }
        setSlugState({
          kind: "unavailable",
          reason: result.reason === "ok" ? "taken" : result.reason,
          suggestions: result.suggestions,
        });
      } catch {
        if (requestedRef.current !== slug) return;
        setSlugState({ kind: "unchecked" });
      }
    },
    [onCheckSlug],
  );

  /**
   * Debounced availability, driven by the value in state rather than by the
   * change handler — so a slug that arrives from anywhere else (a recovered
   * draft, a clicked suggestion, the business name deriving it) is checked too,
   * and the field never shows a green tick it did not earn.
   */
  const currentSlug = value.slug;
  React.useEffect(() => {
    const shape = checkSlugShape(currentSlug);
    if (!shape.ok) {
      requestedRef.current = "";
      // "Empty" is the untouched state, not a failure to report at.
      setSlugState(
        shape.problem === "empty"
          ? { kind: "idle" }
          : {
              kind: "unavailable",
              reason: shape.problem === "reserved" ? "reserved" : "invalid",
              suggestions: [],
            },
      );
      return;
    }
    const id = window.setTimeout(() => void runCheck(shape.slug), SLUG_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [currentSlug, runCheck]);

  const setCompanyName = (raw: string) => {
    onClearError("companyName");
    // The address tracks the name until the operator edits it themselves. After
    // that it is theirs, and renaming the business must not quietly move the
    // hostname they have already decided on.
    const patch: Partial<BusinessDraft> = { companyName: raw };
    if (!value.slugTouched) {
      patch.slug = deriveSlugFromCompanyName(raw);
      onClearError("slug");
    }
    onChange(patch);
  };

  const setSlug = (raw: string, typed: boolean) => {
    onClearError("slug");
    // Autofill may still write the box, but it does not make the address the
    // operator's choice: the next business-name edit, or Continue, rebuilds it.
    onChange({ slug: sanitizeSlugInput(raw), slugTouched: typed || value.slugTouched });
  };

  const slugError = errors.slug;
  const showSuggestions =
    !slugError && slugState.kind === "unavailable" && slugState.suggestions.length > 0;

  return (
    <>
      <div>
        <Label htmlFor="signup-company-name" className={SIGNUP_LABEL}>
          Business name
          <RequiredMark />
        </Label>
        <Input
          ref={companyNameRef}
          id="signup-company-name"
          name="companyName"
          type="text"
          autoComplete="organization"
          autoFocus={autoFocusCompanyName}
          placeholder={examplePlaceholder("Acme Car Rentals", errors.companyName, !value.companyName)}
          value={value.companyName}
          disabled={busy}
          maxLength={FIELD_MAX.companyName}
          aria-invalid={Boolean(errors.companyName)}
          aria-describedby={
            errors.companyName ? "signup-company-name-error" : "signup-company-name-help"
          }
          onChange={(e) => setCompanyName(e.target.value)}
          className={cn(SIGNUP_INPUT, "mt-1")}
        />
        {errors.companyName ? (
          <FieldError id="signup-company-name-error">{errors.companyName}</FieldError>
        ) : (
          // Left out in a very short window, so the screen fits without scrolling.
          <p id="signup-company-name-help" className="mt-1.5 text-[13px] text-muted-foreground [@media(max-height:619px)]:hidden">
            How customers will see you. You can change it later.
          </p>
        )}
      </div>

      {askCityState && (
        <div>
          <Label htmlFor="signup-city-state" className={SIGNUP_LABEL}>
            City and state
            <RequiredMark />
          </Label>
          {/* Pick from the list as you type (Ghulam, 2026-11-23). */}
          <CityStateField
            id="signup-city-state"
            inputRef={cityStateRef}
            placeholder={examplePlaceholder("Houston, TX", errors.cityState, !value.cityState)}
            value={value.cityState ?? ""}
            busy={busy}
            maxLength={FIELD_MAX.cityState}
            invalid={Boolean(errors.cityState)}
            describedBy={errors.cityState ? "signup-city-state-error" : undefined}
            onChange={(next) => {
              onClearError("cityState");
              onChange({ cityState: next });
            }}
            className={cn(SIGNUP_INPUT, "mt-1")}
          />
          {errors.cityState && (
            <FieldError id="signup-city-state-error">{errors.cityState}</FieldError>
          )}
        </div>
      )}

      {/* The full width of the grid: a hostname needs the room. `col-span-full`,
          not `col-span-2`, which forced a second column into the one-column
          screens. */}
      <div className="col-span-full">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="signup-slug" className={SIGNUP_LABEL}>
            Web address
            <RequiredMark />
          </Label>
          {/* Review 1 (V7): an "i" that explains the address on hover, focus or
              tap, instead of a line of text under the field. */}
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label="About your web address"
              aria-describedby="signup-slug-info"
              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-indigo-500 max-sm:size-7"
            >
              <Info className="size-3.5" aria-hidden="true" />
            </button>
            <span
              id="signup-slug-info"
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-60 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-[12px] leading-snug text-background opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:left-0 max-sm:translate-x-0"
            >
              You can change this address later. You can also attach your own domain.
            </span>
          </span>
        </div>

        {/*
          The suffix is rendered INSIDE the field rather than as a hint below it.
          What the operator is choosing is a hostname, and showing only the first
          label invites them to type the whole thing — which `sanitizeSlugInput`
          would then turn into "acme-com".
        */}
        <div
          className={cn(
            // An underline like every other field, the suffix sitting on it.
            "mt-1 flex h-12 [@media(max-height:880px)]:h-10 [@media(max-height:700px)]:mt-0 items-center border-b border-foreground/15 transition-[border-color,box-shadow] dark:border-white/15",
            "focus-within:border-indigo-600 focus-within:shadow-[inset_0_-1px_0_0_var(--color-indigo-600)] dark:focus-within:border-indigo-400 dark:focus-within:shadow-[inset_0_-1px_0_0_var(--color-indigo-400)]",
            (slugError || slugState.kind === "unavailable") &&
              "border-red-500 focus-within:border-red-500 focus-within:shadow-[inset_0_-1px_0_0_var(--color-red-500)] dark:border-red-400",
            busy && "opacity-50",
          )}
        >
          <input
            ref={slugRef}
            id="signup-slug"
            name="slug"
            type="text"
            // No `inputMode="url"`: it marks the box as a website field, which
            // invites autofill, and a slug can hold neither "/" nor ".com".
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore=""
            data-bwignore=""
            data-form-type="other"
            autoCapitalize="off"
            spellCheck={false}
            // No sample: it fills itself from the business name, and a grey
            // "acme-rentals" read as an address already chosen (21 Nov).
            placeholder=""
            value={value.slug}
            disabled={busy}
            maxLength={FIELD_MAX.slug}
            aria-invalid={Boolean(slugError) || slugState.kind === "unavailable"}
            aria-describedby="signup-slug-status"
            onChange={(e) => setSlug(e.target.value, isTypedChange(e.nativeEvent))}
            className="h-full min-w-0 flex-1 bg-transparent pr-1 pl-0 text-[18px] caret-indigo-600 outline-none placeholder:text-foreground/25 disabled:cursor-not-allowed max-sm:text-[17px] dark:caret-indigo-400"
          />
          <span className="shrink-0 text-[18px] text-muted-foreground select-none max-sm:text-[17px]">
            {SLUG_SUFFIX}
          </span>
        </div>

        {/*
          One live region for every verdict — checking, free, taken, reserved,
          malformed, and "we could not check". A screen reader hears the outcome
          without a separate announcement per keystroke, and every state carries
          its own icon and wording so colour is never the only signal.
        */}
        <div id="signup-slug-status" aria-live="polite" className="mt-1.5">
          {slugError ? (
            <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">
              {slugError}
            </p>
          ) : slugState.kind === "checking" ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking availability…
            </p>
          ) : slugState.kind === "available" ? (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 dark:text-indigo-400">
              <Check className="h-3.5 w-3.5 shrink-0" />
              {slugState.slug}
              {SLUG_SUFFIX} is available
            </p>
          ) : slugState.kind === "unavailable" ? (
            <p className="flex items-center gap-1.5 text-[13px] text-red-600 dark:text-red-400">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {slugState.reason === "taken"
                ? "That web address is already taken."
                : slugState.reason === "reserved"
                  ? "That web address is reserved. Please choose another one."
                  : "Use lowercase letters, numbers and hyphens, starting with a letter."}
            </p>
          ) : slugState.kind === "unchecked" ? (
            // Deliberately not a green tick: we did not verify anything. The
            // provision re-checks, and reports a fixable SLUG_TAKEN if we were
            // wrong, so this does not block the operator.
            <p className="text-[13px] text-muted-foreground">
              We couldn&apos;t check this address just now. You can carry on — we&apos;ll
              confirm it when we build your portal.
            </p>
          ) : null /* Review 1 (V7): the explanation moved into the "i" above. */}

          {showSuggestions && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span>Try:</span>
              {(slugState as Extract<SlugState, { kind: "unavailable" }>).suggestions.map(
                (suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onClearError("slug");
                      onChange({ slug: suggestion, slugTouched: true });
                      slugRef?.current?.focus();
                    }}
                    className="font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
                  >
                    {suggestion}
                  </button>
                ),
              )}
            </p>
          )}
        </div>
      </div>

      {/* The colour and the booking site's light or dark, quietly, under the
          address they belong to (brand-look-field.tsx). */}
      {askLook && (
        <BrandLookField
          brandColor={value.brandColor}
          siteTheme={value.siteTheme}
          busy={busy}
          onChange={onChange}
        />
      )}

      <div className="col-span-full">
        <div className="flex items-start gap-2.5">
          <Checkbox
            ref={termsRef}
            id="signup-terms"
            checked={value.acceptedTerms}
            disabled={busy}
            aria-invalid={Boolean(errors.acceptedTerms)}
            aria-describedby={errors.acceptedTerms ? "signup-terms-error" : undefined}
            onCheckedChange={(checked) => {
              onClearError("acceptedTerms");
              onChange({ acceptedTerms: checked === true });
            }}
            className="mt-0.5"
          />
          <Label
            htmlFor="signup-terms"
            className="flex-wrap gap-1 text-[14px] leading-relaxed font-normal text-muted-foreground"
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
        {errors.acceptedTerms && (
          <FieldError id="signup-terms-error">{errors.acceptedTerms}</FieldError>
        )}
      </div>
    </>
  );
}
