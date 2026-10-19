"use client";

/**
 * Business name + web address + terms — the three answers `signup-provision`
 * actually requires from the operator.
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
import { Check, Loader2, TriangleAlert } from "lucide-react";

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
import { FieldError, SIGNUP_INPUT, SIGNUP_LABEL } from "./signup-ui";

/**
 * Long enough that a normal typist finishes a word first, short enough that the
 * verdict feels attached to what they typed. The server rate-limits this at 60
 * checks/hour per user, which ~450 ms comfortably respects.
 */
const SLUG_DEBOUNCE_MS = 450;

/** The visible half of the hostname. Purely presentational — never sent. */
const SLUG_SUFFIX = ".drive-247.com";

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

  const setSlug = (raw: string) => {
    onClearError("slug");
    onChange({ slug: sanitizeSlugInput(raw), slugTouched: true });
  };

  const slugError = errors.slug;
  const showSuggestions =
    !slugError && slugState.kind === "unavailable" && slugState.suggestions.length > 0;

  return (
    <>
      <div>
        <Label htmlFor="signup-company-name" className={SIGNUP_LABEL}>
          Business name
        </Label>
        <Input
          ref={companyNameRef}
          id="signup-company-name"
          name="companyName"
          type="text"
          autoComplete="organization"
          autoFocus={autoFocusCompanyName}
          placeholder="Acme Car Rentals"
          value={value.companyName}
          disabled={busy}
          maxLength={FIELD_MAX.companyName}
          aria-invalid={Boolean(errors.companyName)}
          aria-describedby={
            errors.companyName ? "signup-company-name-error" : "signup-company-name-help"
          }
          onChange={(e) => setCompanyName(e.target.value)}
          className={cn(SIGNUP_INPUT, "mt-1.5")}
        />
        {errors.companyName ? (
          <FieldError id="signup-company-name-error">{errors.companyName}</FieldError>
        ) : (
          <p id="signup-company-name-help" className="mt-1.5 text-[13px] text-muted-foreground">
            How customers will see you. You can change it later.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="signup-slug" className={SIGNUP_LABEL}>
          Web address
        </Label>

        {/*
          The suffix is rendered INSIDE the field rather than as a hint below it.
          What the operator is choosing is a hostname, and showing only the first
          label invites them to type the whole thing — which `sanitizeSlugInput`
          would then turn into "acme-com".
        */}
        <div
          className={cn(
            "mt-1.5 flex h-11 items-center rounded-xl border border-zinc-200 bg-white transition-[color,box-shadow] dark:border-white/10 dark:bg-white/[0.03]",
            "focus-within:border-indigo-500 focus-within:ring-[3px] focus-within:ring-indigo-500/20 dark:focus-within:border-indigo-400",
            (slugError || slugState.kind === "unavailable") &&
              "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
            busy && "opacity-50",
          )}
        >
          <input
            ref={slugRef}
            id="signup-slug"
            name="slug"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="acme-rentals"
            value={value.slug}
            disabled={busy}
            maxLength={FIELD_MAX.slug}
            aria-invalid={Boolean(slugError) || slugState.kind === "unavailable"}
            aria-describedby="signup-slug-status"
            onChange={(e) => setSlug(e.target.value)}
            className="h-full min-w-0 flex-1 rounded-l-xl bg-transparent pl-4 pr-1 text-[15px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <span className="shrink-0 pr-4 pl-0 text-[15px] text-muted-foreground select-none">
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
          ) : (
            <p className="text-[13px] text-muted-foreground">
              This is your booking site. Your portal will be at{" "}
              {value.slug || "your-address"}.portal.drive-247.com. It can&apos;t be
              changed later.
            </p>
          )}

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

      <div>
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
