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
                className="z-[250] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1 text-[15px] text-zinc-900 shadow-lg shadow-indigo-950/10 dark:border-white/10 dark:bg-[#17171f] dark:text-zinc-100"
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
        <Input
          ref={phoneRef}
          id="signup-phone"
          name="phone"
          required
          aria-required="true"
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
          className={cn(SIGNUP_INPUT, fieldSize)}
        />
        {errors.phone && <FieldError id="signup-phone-error">{errors.phone}</FieldError>}
      </div>
    </>
  );
}
