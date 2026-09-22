'use client';

/**
 * Advice that sits under the brand-colour swatches.
 *
 * One job: judge the chosen colour out loud, and offer a one-click fix when it
 * would make text hard to read. That guard is what makes a free colour picker
 * safe to hand to a non-designer — everything else here was trimmed back to
 * keep the page to a single decision.
 *
 * The colour *input* itself lives in `BrandSwatches` — this deliberately
 * renders no picker of its own so there is only ever one place to set the value.
 */

import { AlertTriangle, Check, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { deepenUntilReadable, judgeBrandColor } from '@/lib/appearance/color';
import { useV2 } from '@/lib/v2-context';
import { cn } from '@/lib/utils';

interface BrandColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

export function BrandColorField({ value, onChange, disabled }: BrandColorFieldProps) {
  // v2 (northwind): say something only when there is something to fix. "Text on
  // this colour will be white and easy to read" under every good choice was
  // noise, so the 'excellent' verdict is not shown. v1 keeps all three.
  // (Text is dark or white, whichever reads better, so the best of the two is
  // never under ~4.45:1: 'poor' is all but unreachable, and 'good' is the one
  // warning a person actually meets.)
  const v2Chrome = useV2('chrome');
  const verdict = judgeBrandColor(value);
  if (!verdict) return null;
  if (v2Chrome && verdict.grade === 'excellent') return null;

  return (
    <div
      className={cn(
        v2Chrome
          ? 'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs'
          : 'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs',
        verdict.grade === 'poor'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : verdict.grade === 'good'
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
      )}
    >
      {/* v2 settings carry no icons; v1 keeps its check and warning marks. */}
      {!v2Chrome &&
        (verdict.grade === 'excellent' ? (
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ))}
      <div className="flex-1 space-y-1.5">
        <p className="leading-snug">{verdict.message}</p>
        {/* v2 also offers the fix for 'good': its line already suggests a deeper shade. */}
        {(verdict.grade === 'poor' || (v2Chrome && verdict.grade === 'good')) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(deepenUntilReadable(value))}
            className="h-7 gap-1.5 text-xs"
          >
            {!v2Chrome && <Wand2 className="h-3 w-3" />}
            Fix it for me
          </Button>
        )}
      </div>
    </div>
  );
}
