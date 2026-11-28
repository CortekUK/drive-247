"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  HEARD_ABOUT_OPTIONS,
  HEARD_ABOUT_OTHER_MAX,
  composePhone,
  PHONE_COUNTRIES,
  PHONE_MAX,
  splitPhone,
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
  heardAboutRef?: React.Ref<HTMLSelectElement | HTMLButtonElement>;
  otherRef?: React.Ref<HTMLInputElement>;
  phoneRef?: React.Ref<HTMLInputElement>;
}

/**
 * "How did you hear about us?" (optional) and the phone number (required
 * since 2026-11-24). "How many cars do you rent out?" was taken off the form
 * (Ghulam, 2026-11-23). Used on the first account page.
 *
 * A styled dropdown in the signup's own colours on every device, raised above
 * the full-screen signup layer (z-[200]). The native select showed the
 * device's own menu, a dark grey translucent panel on a Mac, iPad or iPhone in
 * dark mode that looked nothing like the form; the owner asked for the
 * dropdown to be part of the UI everywhere, phones included.
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
  const fieldSize = "mt-1";
  // The chosen country is remembered: the USA and Canada share +1 (V4).
  const [phoneIso, setPhoneIso] = React.useState(() => splitPhone(value.phone).country.iso);
  const phoneParts = splitPhone(value.phone, phoneIso);
  const pick = (next: string) => {
    onChange({ heardAbout: next as AttributionDraft["heardAbout"] });
    onClearError("heardAbout");
    onClearError("heardAboutOther");
  };
  return (
    <>
      <div>
        <Label htmlFor="signup-heard-about" className={SIGNUP_LABEL}>
          How did you hear about us?
        </Label>
          <SelectPrimitive.Root name="heardAbout" value={value.heardAbout} onValueChange={pick} disabled={busy}>
            <SelectPrimitive.Trigger
              ref={heardAboutRef as React.Ref<HTMLButtonElement>}
              id="signup-heard-about"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.heardAbout)}
              aria-describedby={errors.heardAbout ? "signup-heard-about-error" : undefined}
              className={cn(
                SIGNUP_INPUT,
                fieldSize,
                "flex w-full cursor-pointer items-center justify-between text-left outline-none transition-[color,box-shadow,border-color] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-indigo-600 data-[state=open]:shadow-[inset_0_-1px_0_0_var(--color-indigo-600)] dark:data-[state=open]:border-indigo-400",
                value.heardAbout ? "text-foreground" : "text-foreground/25 dark:text-white/25",
              )}
            >
              <SelectPrimitive.Value placeholder="Choose one" />
              <SelectPrimitive.Icon asChild>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </SelectPrimitive.Icon>
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal>
              <SelectPrimitive.Content
                position="popper"
                side="bottom"
                sideOffset={6}
                className="z-[250] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] signup-pop overflow-hidden rounded-2xl border border-indigo-100 bg-white/95 p-1 text-[15px] text-zinc-900 shadow-[0_8px_24px_-12px_rgba(67,56,202,0.25)] backdrop-blur-md dark:border-white/10 dark:bg-[#17171f]/95 dark:text-zinc-100"
              >
                <SelectPrimitive.Viewport>
                  {HEARD_ABOUT_OPTIONS.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pr-9 pl-3 outline-none data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 data-[state=checked]:font-medium dark:data-[highlighted]:bg-indigo-500/15 dark:data-[highlighted]:text-indigo-200"
                    >
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                      <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center text-indigo-600 dark:text-indigo-300">
                        <Check className="size-4" aria-hidden />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Viewport>
              </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
          </SelectPrimitive.Root>
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
            className={cn(SIGNUP_INPUT, fieldSize)}
          />
          {errors.heardAboutOther && (
            <FieldError id="signup-heard-about-other-error">{errors.heardAboutOther}</FieldError>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="signup-phone" className={SIGNUP_LABEL}>
          Phone number
        </Label>
        {/* Review 1 (Ghulam's video, V4): the country first (USA by default),
            then the number, with an example for that country. Stored as one
            string, "+1 5551234567", which the existing phone check accepts. */}
        <div className="flex items-end gap-3">
          <SelectPrimitive.Root
            value={phoneParts.country.iso}
            disabled={busy}
            onValueChange={(iso) => {
              const next = PHONE_COUNTRIES.find((c) => c.iso === iso) ?? PHONE_COUNTRIES[0];
              setPhoneIso(next.iso);
              onChange({ phone: composePhone(next, phoneParts.number) });
              onClearError("phone");
            }}
          >
            <SelectPrimitive.Trigger
              aria-label="Country code"
              className={cn(
                SIGNUP_INPUT,
                fieldSize,
                "flex w-[6.5rem] shrink-0 cursor-pointer items-center justify-between gap-1 text-left text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-indigo-600 dark:data-[state=open]:border-indigo-400",
              )}
            >
              <SelectPrimitive.Value>
                {phoneParts.country.flag} +{phoneParts.country.dial}
              </SelectPrimitive.Value>
              <SelectPrimitive.Icon asChild>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </SelectPrimitive.Icon>
            </SelectPrimitive.Trigger>
            <SelectPrimitive.Portal>
              <SelectPrimitive.Content
                position="popper"
                side="bottom"
                align="start"
                sideOffset={6}
                className="signup-pop z-[250] max-h-[var(--radix-select-content-available-height)] w-56 overflow-hidden rounded-2xl border border-indigo-100 bg-white/95 p-1 text-[15px] text-zinc-900 shadow-[0_8px_24px_-12px_rgba(67,56,202,0.25)] backdrop-blur-md dark:border-white/10 dark:bg-[#17171f]/95 dark:text-zinc-100"
              >
                <SelectPrimitive.Viewport>
                  {PHONE_COUNTRIES.map((c) => (
                    <SelectPrimitive.Item
                      key={c.iso}
                      value={c.iso}
                      className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pr-9 pl-3 outline-none data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 dark:data-[highlighted]:bg-indigo-500/15 dark:data-[highlighted]:text-indigo-200"
                    >
                      <SelectPrimitive.ItemText>
                        {c.flag} +{c.dial}
                      </SelectPrimitive.ItemText>
                      <span className="text-muted-foreground">{new Intl.DisplayNames(["en"], { type: "region" }).of(c.iso)}</span>
                      <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center text-indigo-600 dark:text-indigo-300">
                        <Check className="size-4" aria-hidden />
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Viewport>
              </SelectPrimitive.Content>
            </SelectPrimitive.Portal>
          </SelectPrimitive.Root>
          <Input
            ref={phoneRef}
            id="signup-phone"
            name="phone"
            required
            aria-required="true"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder={phoneParts.country.example}
            disabled={busy}
            maxLength={PHONE_MAX}
            value={phoneParts.number}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "signup-phone-error" : undefined}
            onChange={(e) => {
              onChange({ phone: composePhone(phoneParts.country, e.target.value) });
              onClearError("phone");
            }}
            className={cn(SIGNUP_INPUT, fieldSize, "min-w-0 flex-1")}
          />
        </div>
        {errors.phone && <FieldError id="signup-phone-error">{errors.phone}</FieldError>}
      </div>
    </>
  );
}
