'use client';

/**
 * The preset picker — the primary path through the Appearance screen.
 *
 * Hovering a card previews it without committing, so a tenant can sweep the
 * whole set in a couple of seconds before choosing. Selection is explicit.
 */

import { Check } from 'lucide-react';
import { THEME_PRESETS, type ThemePreset } from '@/lib/appearance/presets';
import { cn } from '@/lib/utils';

interface ThemePresetGridProps {
  selectedId: string | null;
  onSelect: (preset: ThemePreset) => void;
  /** Fired on hover-in with the preset, and on hover-out with null. */
  onPeek?: (preset: ThemePreset | null) => void;
  mode: 'light' | 'dark';
  disabled?: boolean;
}

export function ThemePresetGrid({
  selectedId,
  onSelect,
  onPeek,
  mode,
  disabled,
}: ThemePresetGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {THEME_PRESETS.map((preset) => {
        const isSelected = preset.id === selectedId;
        const swatch =
          mode === 'dark'
            ? {
                primary: preset.palette.dark_primary_color,
                secondary: preset.palette.dark_secondary_color,
                accent: preset.palette.dark_accent_color,
                background: preset.palette.dark_background_color,
              }
            : {
                primary: preset.palette.light_primary_color,
                secondary: preset.palette.light_secondary_color,
                accent: preset.palette.light_accent_color,
                background: preset.palette.light_background_color,
              };

        return (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(preset)}
            onMouseEnter={() => onPeek?.(preset)}
            onMouseLeave={() => onPeek?.(null)}
            onFocus={() => onPeek?.(preset)}
            onBlur={() => onPeek?.(null)}
            aria-pressed={isSelected}
            className={cn(
              'group relative overflow-hidden rounded-lg border p-3 text-left transition-all',
              'hover:border-primary/60 hover:shadow-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
              disabled && 'pointer-events-none opacity-60'
            )}
          >
            {isSelected && (
              <span
                className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full"
                style={{ background: swatch.primary }}
              >
                <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
              </span>
            )}

            {/* Swatch strip — sidebar, brand, accent over the page background */}
            <div
              className="mb-2.5 flex h-12 items-end gap-1 overflow-hidden rounded p-1.5"
              style={{ background: swatch.background }}
            >
              <div
                className="h-full w-3 rounded-sm"
                style={{ background: swatch.secondary }}
              />
              <div
                className="h-7 flex-1 rounded-sm"
                style={{ background: swatch.primary }}
              />
              <div
                className="h-4 w-4 rounded-sm"
                style={{ background: swatch.accent }}
              />
            </div>

            <div className="text-sm font-medium leading-none">{preset.name}</div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">
              {preset.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
