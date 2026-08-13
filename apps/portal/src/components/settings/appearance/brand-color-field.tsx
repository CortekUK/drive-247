'use client';

/**
 * Custom brand colour — the escape hatch behind the presets.
 *
 * Two things make this safe to hand to a non-designer:
 *  1. It judges the colour out loud and offers a one-click fix when the choice
 *     would make text hard to read.
 *  2. It can lift colours straight out of their uploaded logo, which is how
 *     most tenants get a genuinely on-brand portal without picking anything.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/settings/color-picker';
import {
  deepenUntilReadable,
  extractLogoColors,
  judgeBrandColor,
  sameColor,
} from '@/lib/appearance/color';
import { cn } from '@/lib/utils';

interface BrandColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  /** Logo to lift suggestions from. Omit to hide the suggestion row. */
  logoUrl?: string | null;
  disabled?: boolean;
}

export function BrandColorField({
  value,
  onChange,
  logoUrl,
  disabled,
}: BrandColorFieldProps) {
  const [logoColors, setLogoColors] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);

  // Re-read whenever the tenant swaps their logo.
  useEffect(() => {
    let cancelled = false;
    if (!logoUrl) {
      setLogoColors([]);
      setExtractFailed(false);
      return;
    }
    setExtracting(true);
    setExtractFailed(false);
    extractLogoColors(logoUrl)
      .then((colors) => {
        if (cancelled) return;
        setLogoColors(colors);
        setExtractFailed(colors.length === 0);
      })
      .catch(() => {
        if (!cancelled) setExtractFailed(true);
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const verdict = judgeBrandColor(value);

  return (
    <div className="space-y-4">
      <ColorPicker
        label="Brand colour"
        value={value}
        onChange={onChange}
        description="Used for buttons, links, active menu items and highlights. Everything else is worked out from it."
      />

      {/* Readability verdict — the guard that keeps a portal usable */}
      {verdict && (
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs',
            verdict.grade === 'poor'
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : verdict.grade === 'good'
                ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          )}
        >
          {verdict.grade === 'excellent' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="flex-1 space-y-1.5">
            <p className="leading-snug">{verdict.message}</p>
            {verdict.grade === 'poor' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onChange(deepenUntilReadable(value))}
                className="h-7 gap-1.5 text-xs"
              >
                <Wand2 className="h-3 w-3" />
                Fix it for me
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Colours lifted from the logo */}
      {logoUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            From your logo
          </div>

          {extracting && (
            <p className="text-xs text-muted-foreground">Reading your logo…</p>
          )}

          {!extracting && logoColors.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {logoColors.map((hex) => {
                  const active = sameColor(hex, value);
                  return (
                    <button
                      key={hex}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(hex)}
                      title={hex}
                      aria-label={`Use ${hex} from logo`}
                      className={cn(
                        'h-8 w-8 rounded-md border transition-transform hover:scale-105',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        active ? 'border-foreground ring-1 ring-foreground' : 'border-border'
                      )}
                      style={{ background: hex }}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Tap one to use it as your brand colour.
              </p>
            </>
          )}

          {!extracting && extractFailed && (
            <p className="text-xs text-muted-foreground">
              We couldn&apos;t read colours from this logo. Pick your brand colour above instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
