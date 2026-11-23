"use client";

/**
 * The look, on the business page (Ghulam, 2026-11-23: "pick the color and the
 * theme as well there but it should be very natural and subtle").
 *
 * One quiet row under the web address: the brand colour as five small dots
 * (the v2 portal's own swatches, lib/signup-look.ts) and the booking site's
 * light or dark start as a small two-way switch. Both start on the defaults,
 * so nobody has to touch them; nothing here is required.
 *
 * `signup-provision` writes the colour to the portal and booking site and the
 * theme to `tenants.customer_theme_mode`. Both can be changed later in
 * Settings.
 */

import * as React from "react";
import { Check, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { SIGNUP_BRAND_COLORS, type SiteTheme } from "@/lib/signup-look";

import { SIGNUP_LABEL } from "./signup-ui";

const THEMES: ReadonlyArray<{ value: SiteTheme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function BrandLookField({
  brandColor,
  siteTheme,
  busy,
  onChange,
}: {
  brandColor: string;
  siteTheme: SiteTheme;
  busy: boolean;
  onChange(patch: { brandColor?: string; siteTheme?: SiteTheme }): void;
}) {
  const dots = React.useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    SIGNUP_BRAND_COLORS.findIndex((c) => c.hex === brandColor.toUpperCase()),
  );
  const pick = (i: number, focus = false) => {
    onChange({ brandColor: SIGNUP_BRAND_COLORS[i].hex });
    if (focus) dots.current[i]?.focus();
  };

  return (
    <div className="col-span-full flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span id="signup-brand-color-label" className={SIGNUP_LABEL}>
          Colour
        </span>
        <div
          role="radiogroup"
          aria-labelledby="signup-brand-color-label"
          className="flex items-center gap-2"
        >
          {SIGNUP_BRAND_COLORS.map((c, i) => {
            const checked = i === selected;
            return (
              <button
                key={c.id}
                ref={(node) => {
                  dots.current[i] = node;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={c.name}
                title={c.name}
                // Roving tab stop: the dots are one Tab, the arrows move along them.
                tabIndex={checked ? 0 : -1}
                disabled={busy}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  const n = SIGNUP_BRAND_COLORS.length;
                  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    pick((i + 1) % n, true);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    pick((i - 1 + n) % n, true);
                  }
                }}
                // `color` too: the ring below is drawn in `currentColor`, so the
                // chosen dot is ringed in its own colour.
                style={{ backgroundColor: c.hex, color: c.hex }}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full ring-offset-2 ring-offset-white outline-none transition-[box-shadow,transform] duration-200 ease-out hover:scale-110 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none dark:ring-offset-[#0e0e14]",
                  checked && "ring-2",
                )}
              >
                {checked ? <Check aria-hidden className="size-3.5 text-white" strokeWidth={3} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Booking site theme"
        className="flex shrink-0 items-center rounded-full p-0.5 ring-1 ring-foreground/10 dark:ring-white/10"
      >
        {THEMES.map(({ value, label, Icon }) => {
          const checked = siteTheme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              title={`${label} booking site`}
              disabled={busy}
              onClick={() => onChange({ siteTheme: value })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
                checked
                  ? "bg-foreground/[0.07] text-foreground dark:bg-white/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5 shrink-0" />
              {/* The word on a laptop; on a phone the sun and moon say it. */}
              <span className="max-sm:sr-only">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
