"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FLEET_SIZE_OPTIONS, type FleetSize } from "@/lib/fleet-size";
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
  /** The first fleet-size chip, so "focus the first error" can land on it. */
  fleetRef?: React.Ref<HTMLButtonElement>;
  /** Told about every fleet-size tap; the provider moves the plan with it. */
  onFleetSizeChange?(fleetSize: FleetSize): void;
  /**
   * Shorter fields (40px), for the first account page, which has to fit with
   * no inner scroll at 1366x768 and 360x740 now that it carries two questions.
   */
  compact?: boolean;
}

/**
 * "How many cars do you rent out?" One tap: three chips in the signup's own
 * style, a radio group underneath for keyboards and screen readers.
 */
function FleetSizeChips({
  value,
  error,
  busy,
  fleetRef,
  onPick,
  compact,
}: {
  value: FleetSize | "";
  error?: string;
  busy: boolean;
  fleetRef?: React.Ref<HTMLButtonElement>;
  onPick(next: FleetSize): void;
  compact?: boolean;
}) {
  const buttons = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = FLEET_SIZE_OPTIONS.findIndex((o) => o.value === value);
  const move = (from: number, delta: number) => {
    const next = (from + delta + FLEET_SIZE_OPTIONS.length) % FLEET_SIZE_OPTIONS.length;
    onPick(FLEET_SIZE_OPTIONS[next].value);
    buttons.current[next]?.focus();
  };
  return (
    <div>
      <p id="signup-fleet-size-label" className={SIGNUP_LABEL}>
        How many cars do you rent out?
      </p>
      <div
        role="radiogroup"
        aria-labelledby="signup-fleet-size-label"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "signup-fleet-size-error" : undefined}
        className={cn("grid grid-cols-3 gap-2", compact ? "mt-1" : "mt-1.5")}
      >
        {FLEET_SIZE_OPTIONS.map((option, i) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                buttons.current[i] = node;
                if (i === 0 && fleetRef) {
                  if (typeof fleetRef === "function") fleetRef(node);
                  else (fleetRef as React.RefObject<HTMLButtonElement | null>).current = node;
                }
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              // Roving tab stop: the group is one Tab, arrows move inside it.
              tabIndex={checked || (selectedIndex === -1 && i === 0) ? 0 : -1}
              disabled={busy}
              onClick={() => onPick(option.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                compact ? "h-10" : "h-11 [@media(max-height:700px)]:h-10",
                "rounded-xl border text-[15px] font-medium tabular-nums transition-[color,background-color,border-color,box-shadow] duration-200 ease-out outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
                checked
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-[3px] ring-indigo-500/15 dark:border-indigo-400 dark:bg-indigo-500/15 dark:text-indigo-200"
                  : cn(
                      "bg-white text-foreground hover:border-indigo-300 hover:bg-indigo-50/40 dark:bg-white/[0.03] dark:hover:border-indigo-400/50",
                      error ? "border-red-500" : "border-zinc-200 dark:border-white/10",
                    ),
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error && <FieldError id="signup-fleet-size-error">{error}</FieldError>}
    </div>
  );
}

/**
 * The two questions and the phone number (required since 2026-11-24). Used on the first account
 * page and on the short screen Google and Apple signups see after signing in.
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
  fleetRef,
  onFleetSizeChange,
  compact = false,
}: HeardAboutFieldsProps) {
  const fieldSize = compact ? "mt-1 h-10" : "mt-1.5";
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
          <SelectPrimitive.Root name="heardAbout" value={value.heardAbout} onValueChange={pick} disabled={busy} required>
            <SelectPrimitive.Trigger
              ref={heardAboutRef as React.Ref<HTMLButtonElement>}
              id="signup-heard-about"
              autoFocus={autoFocus}
              aria-invalid={Boolean(errors.heardAbout)}
              aria-describedby={errors.heardAbout ? "signup-heard-about-error" : undefined}
              className={cn(
                SIGNUP_INPUT,
                fieldSize,
                "flex w-full cursor-pointer items-center justify-between border text-left outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 data-[state=open]:border-indigo-500 data-[state=open]:ring-[3px] data-[state=open]:ring-indigo-500/20",
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

      <FleetSizeChips
        value={value.fleetSize ?? ""}
        error={errors.fleetSize}
        busy={busy}
        fleetRef={fleetRef}
        compact={compact}
        onPick={(next) => {
          onChange({ fleetSize: next });
          onClearError("fleetSize");
          onFleetSizeChange?.(next);
        }}
      />

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
