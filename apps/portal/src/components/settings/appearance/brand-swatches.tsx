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
                  className="h-9 font-mono text-xs uppercase"
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
