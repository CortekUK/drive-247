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
 */

import { useState } from 'react';
import { Check, Pipette } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-v2/popover';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { readableForegroundOn, sameColor } from '@/lib/appearance/color';
import { V2_BRAND_PRESETS, V2_DEFAULT_BRAND_COLOR } from '@/lib/appearance/presets';
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

  // v2 (northwind): five named colours and a Custom pill, no helper line. The
  // v1 row below (twelve unnamed dots and a dashed pipette) is unchanged.
  if (v2Chrome) {
    const isCustomV2 = !V2_BRAND_PRESETS.some((p) => sameColor(p.hex, value));
    const hexComplete = /^#[0-9a-fA-F]{6}$/.test(value);
    return (
      <div className="flex flex-wrap items-start gap-2" data-brand-swatches="v2">
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
              className={cn(
                'flex w-16 cursor-pointer flex-col items-center gap-1.5 rounded-xl py-1.5 outline-none transition-colors',
                'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]',
                'focus-visible:ring-2 focus-visible:ring-ring',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-9 items-center justify-center rounded-full',
                  active && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                )}
                style={{ background: preset.hex }}
              >
                {active && (
                  <Check className="size-4" strokeWidth={3} style={{ color: readableForegroundOn(preset.hex) }} />
                )}
              </span>
              <span className={cn('text-xs leading-4', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {preset.name}
              </span>
            </button>
          );
        })}

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={isCustomV2 && hexComplete ? `Custom colour, ${value.toUpperCase()}` : 'Custom colour'}
              className={cn(
                'mt-1.5 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors',
                'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]',
                'focus-visible:ring-2 focus-visible:ring-ring',
                isCustomV2 ? 'border-foreground text-foreground' : 'text-muted-foreground',
                disabled && 'pointer-events-none opacity-50'
              )}
            >
              {isCustomV2 && hexComplete ? (
                <span aria-hidden="true" className="size-4 rounded-full ring-1 ring-foreground/20" style={{ background: value }} />
              ) : (
                <Pipette className="size-3.5" aria-hidden="true" />
              )}
              Custom
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-3" align="start">
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
            </div>
            <p className="text-xs text-muted-foreground">
              Paste the hex from your brand guidelines, or pick from the wheel.
            </p>
          </PopoverContent>
        </Popover>
      </div>
    );
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
