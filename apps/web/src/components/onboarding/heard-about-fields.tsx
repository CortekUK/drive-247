"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  HEARD_ABOUT_OPTIONS,
  HEARD_ABOUT_OTHER_MAX,
  PHONE_MAX,
  type AttributionDraft,
  type AttributionField,
} from "@/lib/signup-attribution";

import { FieldError, SIGNUP_INPUT, SIGNUP_LABEL } from "./signup-ui";

interface HeardAboutFieldsProps {
  value: AttributionDraft;
  errors: Partial<Record<AttributionField, string>>;
  busy: boolean;
  autoFocus?: boolean;
  onChange(patch: Partial<AttributionDraft>): void;
  onClearError(field: AttributionField): void;
  heardAboutRef?: React.Ref<HTMLSelectElement>;
  otherRef?: React.Ref<HTMLInputElement>;
  phoneRef?: React.Ref<HTMLInputElement>;
}

/**
 * The question and the optional phone number. Used on the first account page
 * and on the short screen Google and Apple signups see after signing in.
 *
 * A native select: the phone's own picker is the quickest way to answer, and it
 * cannot open behind the full-screen signup layer.
 */
export function HeardAboutFields({
  value,
  errors,
  busy,
  autoFocus,
  onChange,
  onClearError,
  heardAboutRef,
  otherRef,
  phoneRef,
}: HeardAboutFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="signup-heard-about" className={SIGNUP_LABEL}>
          How did you hear about us?
        </Label>
        <div className="relative mt-1.5">
          <select
            ref={heardAboutRef}
            id="signup-heard-about"
            name="heardAbout"
            required
            autoFocus={autoFocus}
            disabled={busy}
            value={value.heardAbout}
            aria-invalid={Boolean(errors.heardAbout)}
            aria-describedby={errors.heardAbout ? "signup-heard-about-error" : undefined}
            onChange={(e) => {
              onChange({ heardAbout: e.target.value as AttributionDraft["heardAbout"] });
              onClearError("heardAbout");
              onClearError("heardAboutOther");
            }}
            className={cn(
              SIGNUP_INPUT,
              "w-full cursor-pointer appearance-none border pr-10 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500",
              "dark:[&>option]:bg-[#17171f]",
              value.heardAbout ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <option value="" disabled>
              Choose one
            </option>
            {HEARD_ABOUT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="text-foreground">
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        {errors.heardAbout && <FieldError id="signup-heard-about-error">{errors.heardAbout}</FieldError>}
      </div>

      {value.heardAbout === "other" && (
        <div>
          <Label htmlFor="signup-heard-about-other" className={SIGNUP_LABEL}>
            Where did you hear about us?
          </Label>
          <Input
            ref={otherRef}
            id="signup-heard-about-other"
            name="heardAboutOther"
            type="text"
            autoComplete="off"
            autoFocus
            disabled={busy}
            maxLength={HEARD_ABOUT_OTHER_MAX}
            value={value.heardAboutOther}
            aria-invalid={Boolean(errors.heardAboutOther)}
            aria-describedby={errors.heardAboutOther ? "signup-heard-about-other-error" : undefined}
            onChange={(e) => {
              onChange({ heardAboutOther: e.target.value });
              onClearError("heardAboutOther");
            }}
            className={cn(SIGNUP_INPUT, "mt-1.5")}
          />
          {errors.heardAboutOther && (
            <FieldError id="signup-heard-about-other-error">{errors.heardAboutOther}</FieldError>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="signup-phone" className={SIGNUP_LABEL}>
          Phone number <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          ref={phoneRef}
          id="signup-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(555) 123-4567"
          disabled={busy}
          maxLength={PHONE_MAX}
          value={value.phone}
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? "signup-phone-error" : undefined}
          onChange={(e) => {
            onChange({ phone: e.target.value });
            onClearError("phone");
          }}
          className={cn(SIGNUP_INPUT, "mt-1.5")}
        />
        {errors.phone && <FieldError id="signup-phone-error">{errors.phone}</FieldError>}
      </div>
    </>
  );
}
