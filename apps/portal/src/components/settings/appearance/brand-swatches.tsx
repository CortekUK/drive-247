'use client';

/**
 * Round brand-colour swatches — the fast path.
 *
 * The new theme derives everything from a single colour, so the interaction
 * should match: one row of dots, tap one, done. The full picker stays behind
 * "Custom" for the operator who has an exact brand hex to match.
 *
 * Colours here are pre-vetted for contrast, so any dot on this row is a safe
 * choice — the readability warning only ever appears for custom values.
 *
 * v2 (`BrandSwatchesV2`, at the end): five named colours, the first called
 * Default, and Custom as a sixth circle of the same size with nothing written
 * inside it. Custom opens the picker, which also holds "Restore default
 * colour" (team lead, Sep 2026: one kind of circle, the picker opening from
 * it, the default inside it).
 */

import { useState } from 'react';
import { Check, Pipette } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-v2/popover';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { readableForegroundOn, sameColor } from '@/lib/appearance/color';
import { V2_BRAND_PRESETS, V2_DEFAULT_BRAND_COLOR, V2_DEFAULT_BRAND_NAME } from '@/lib/appearance/presets';
import { useV2 } from '@/lib/v2-context';
import { cn } from '@/lib/utils';

/** Every one of these clears 4.5:1 against its chosen foreground. */
const SWATCHES = [
  { hex: '#C6A256', name: 'Gold' },
  { hex: '#4F46E5', name: 'Indigo' },
  { hex: '#1D4ED8', name: 'Blue' },
  { hex: '#0891B2', name: 'Cyan' },
  { hex: '#047857', name: 'Emerald' },
  { hex: '#65A30D', name: 'Lime' },
  { hex: '#B91C1C', name: 'Red' },
  { hex: '#DB2777', name: 'Pink' },
  { hex: '#6D28D9', name: 'Violet' },
  { hex: '#C2410C', name: 'Orange' },
  { hex: '#0F766E', name: 'Teal' },
  { hex: '#1E293B', name: 'Graphite' },
];

interface BrandSwatchesProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

export function BrandSwatches({ value, onChange, disabled }: BrandSwatchesProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const isCustom = !SWATCHES.some((s) => sameColor(s.hex, value));
  // v2 dark: --input carries its own alpha under .v2-theme, so the field's
  // bg-input/50 is invalid and the hex box rendered with no fill (northwind only).
  const v2Chrome = useV2('chrome');

  // v2: five named colours and a sixth round swatch for a custom colour, all
  // the same size, each named underneath. The v1 row below (twelve unnamed
  // dots and a dashed pipette) is unchanged.
  if (v2Chrome) {
    return <BrandSwatchesV2 value={value} onChange={onChange} disabled={disabled} />;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {SWATCHES.map((swatch) => {
          const active = sameColor(swatch.hex, value);
          return (
            <button
              key={swatch.hex}
              type="button"
              disabled={disabled}
              title={swatch.name}
              aria-label={swatch.name}
              aria-pressed={active}
              onClick={() => onChange(swatch.hex)}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-full transition-transform',
                'hover:scale-110 focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-ring focus-visible:ring-offset-2',
                active && 'ring-2 ring-foreground ring-offset-2',
                disabled && 'pointer-events-none opacity-50'
              )}
              style={{ background: swatch.hex }}
            >
              {active && (
                <Check
                  className="h-4 w-4"
                  strokeWidth={3}
                  style={{ color: readableForegroundOn(swatch.hex) }}
                />
              )}
            </button>
          );
        })}

        {/* Custom hex */}
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              title="Custom colour"
              aria-label="Custom colour"
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed',
                'transition-transform hover:scale-110 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isCustom ? 'border-foreground' : 'border-muted-foreground/40',
                disabled && 'pointer-events-none opacity-50'
              )}
              style={isCustom ? { background: value } : undefined}
            >
              {isCustom ? (
                <Check
                  className="h-4 w-4"
                  strokeWidth={3}
                  style={{ color: readableForegroundOn(value) }}
                />
              ) : (
                <Pipette className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 space-y-3" align="start">
            <div className="space-y-1.5">
              <Label htmlFor="custom-hex" className="text-xs">
                Your exact brand colour
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#C6A256'}
                  onChange={(e) => onChange(e.target.value.toUpperCase())}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5"
                  aria-label="Colour picker"
                />
                <Input
                  id="custom-hex"
                  value={value}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw.startsWith('#') ? raw : `#${raw}`;
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toUpperCase());
                    else if (next.length <= 7) onChange(next.toUpperCase());
                  }}
                  placeholder="#C6A256"
                  className={cn('h-9 font-mono text-xs uppercase', v2Chrome && 'dark:bg-muted')}
                  maxLength={7}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste the hex from your brand guidelines, or pick from the wheel.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-xs text-muted-foreground">
        Pick one colour — everything else in your portal is worked out from it.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* v2                                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The custom swatch before a custom colour is chosen: every hue round the
 * circle, so it reads as "any colour" without a word inside it. Hue stops, not
 * brand tokens: this one swatch is the only place a fixed rainbow belongs.
 */
const ANY_COLOUR_FILL =
  'conic-gradient(hsl(0 85% 58%), hsl(45 90% 55%), hsl(120 60% 45%), hsl(185 75% 45%), hsl(230 80% 60%), hsl(290 70% 58%), hsl(0 85% 58%))';

/** One swatch button: the circle, then its name. Shared by the five presets and Custom. */
const SWATCH_BUTTON = cn(
  'group flex w-16 cursor-pointer flex-col items-center gap-2 rounded-xl py-2 outline-none transition-colors',
  'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]',
  'focus-visible:ring-2 focus-visible:ring-ring'
);

/**
 * The 40px circle. A hairline inside it keeps a very light colour visible on
 * the white card; the chosen one gets a ring clear of it and a check mark.
 */
function SwatchCircle({ fill, active, checkOn }: { fill: string; active: boolean; checkOn: string | null }) {
  return (
    <span
      aria-hidden="true"
      data-swatch-circle=""
      className={cn(
        'flex size-10 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.12)] transition-transform duration-150 group-hover:scale-105 motion-reduce:transition-none',
        active && 'ring-2 ring-foreground ring-offset-2 ring-offset-card'
      )}
      style={{ background: fill }}
    >
      {active && checkOn && <Check className="size-5" strokeWidth={3} style={{ color: readableForegroundOn(checkOn) }} />}
    </span>
  );
}

function SwatchName({ active, children }: { active: boolean; children: string }) {
  return (
    <span className={cn('text-xs leading-4', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      {children}
    </span>
  );
}

function BrandSwatchesV2({ value, onChange, disabled }: BrandSwatchesProps) {
  const [customOpen, setCustomOpen] = useState(false);
  // "Restore default colour" asks once, inside the popover, before it acts.
  const [confirmRestore, setConfirmRestore] = useState(false);
  const hexComplete = /^#[0-9a-fA-F]{6}$/.test(value);
  const isCustom = !V2_BRAND_PRESETS.some((p) => sameColor(p.hex, value));
  const customShown = isCustom && hexComplete;
  const isDefault = sameColor(value, V2_DEFAULT_BRAND_COLOR);

  const setOpen = (open: boolean) => {
    setCustomOpen(open);
    if (!open) setConfirmRestore(false);
  };

  const restoreDefault = () => {
    onChange(V2_DEFAULT_BRAND_COLOR);
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1" data-brand-swatches="v2">
      {V2_BRAND_PRESETS.map((preset) => {
        const active = sameColor(preset.hex, value);
        return (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            aria-label={preset.name}
            aria-pressed={active}
            onClick={() => onChange(preset.hex)}
            className={cn(SWATCH_BUTTON, disabled && 'pointer-events-none opacity-50')}
          >
            <SwatchCircle fill={preset.hex} active={active} checkOn={preset.hex} />
            <SwatchName active={active}>{preset.name}</SwatchName>
          </button>
        );
      })}

      <Popover open={customOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={customShown ? `Custom colour, ${value.toUpperCase()}` : 'Custom colour'}
            className={cn(SWATCH_BUTTON, disabled && 'pointer-events-none opacity-50')}
          >
            <SwatchCircle
              fill={customShown ? value : ANY_COLOUR_FILL}
              active={customShown}
              checkOn={customShown ? value : null}
            />
            <SwatchName active={customShown}>Custom</SwatchName>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 gap-3 rounded-2xl" align="start">
          <div className="space-y-1.5">
            <Label htmlFor="custom-hex" className="text-xs">
              Your exact brand colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexComplete ? value : V2_DEFAULT_BRAND_COLOR}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                className="h-9 w-9 shrink-0 cursor-pointer rounded-xl border bg-transparent p-0.5"
                aria-label="Colour picker"
              />
              <Input
                id="custom-hex"
                value={value}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const next = raw.startsWith('#') ? raw : `#${raw}`;
                  if (next.length <= 7) onChange(next.toUpperCase());
                }}
                placeholder={V2_DEFAULT_BRAND_COLOR}
                className="h-9 font-mono text-xs uppercase dark:bg-muted"
                maxLength={7}
              />
            </div>
            <p className="text-xs text-muted-foreground">Paste the hex from your brand guidelines, or pick from the wheel.</p>
          </div>

          {confirmRestore ? (
            <div role="group" aria-label="Restore default colour" className="space-y-2 rounded-xl bg-muted px-3 py-2.5">
              <p className="text-xs leading-snug text-foreground">
                Set your brand colour back to {V2_DEFAULT_BRAND_NAME}? Nothing is saved until you press Save changes.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={restoreDefault}>
                  Restore {V2_DEFAULT_BRAND_NAME.toLowerCase()}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRestore(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={disabled || isDefault}
              onClick={() => setConfirmRestore(true)}
            >
              Restore default colour
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
