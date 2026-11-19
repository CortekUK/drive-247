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
 * The question and the optional phone number. Used on the first account page
 * and on the short screen Google and Apple signups see after signing in.
 *
 * On a phone (coarse pointer) a native select: the phone's own picker is the
 * quickest way to answer. On a laptop the native list is the operating
 * system's menu, which on a Mac in dark mode is a dark grey translucent panel
 * that looks nothing like the form ("please correct the design colour"), so
 * there it is a styled dropdown in the signup's own colours, raised above the
 * full-screen signup layer (z-[200]).
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

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
  const coarse = useCoarsePointer();
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
        {!coarse ? (
          <SelectPrimitive.Root name="heardAbout" value={value.heardAbout} onValueChange={pick} disabled={busy} required>
            <SelectPrimitive.Trigger
              ref={heardAboutRef as React.Ref<HTMLButtonElement>}
              id="signup-heard-about"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.heardAbout)}
              aria-describedby={errors.heardAbout ? "signup-heard-about-error" : undefined}
              className={cn(
                SIGNUP_INPUT,
                "mt-1.5 flex w-full cursor-pointer items-center justify-between border text-left outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 data-[state=open]:border-indigo-500 data-[state=open]:ring-[3px] data-[state=open]:ring-indigo-500/20",
                value.heardAbout ? "text-foreground" : "text-muted-foreground",
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
                className="z-[250] max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 text-[15px] text-zinc-900 shadow-lg shadow-indigo-950/10 dark:border-white/10 dark:bg-[#17171f] dark:text-zinc-100"
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
        ) : (
        <div className="relative mt-1.5">
          <select
            ref={heardAboutRef as React.Ref<HTMLSelectElement>}
            id="signup-heard-about"
            name="heardAbout"
            required
            autoFocus={autoFocus}
            disabled={busy}
            value={value.heardAbout}
            aria-invalid={Boolean(errors.heardAbout)}
            aria-describedby={errors.heardAbout ? "signup-heard-about-error" : undefined}
            onChange={(e) => pick(e.target.value)}
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
        )}
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
