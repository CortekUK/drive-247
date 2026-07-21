import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  description?: string;
  className?: string;
}

const DEFAULT_COLOR = '#C6A256';

const presetColors = [
  '#C6A256', // Gold (current)
  '#3B82F6', // Blue
  '#10B981', // Green
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#F97316', // Orange
  '#6366F1', // Indigo
  '#14B8A6', // Teal
];

/**
 * Strict: only a complete 6-digit hex is accepted. Used while typing so that a
 * half-finished value like "#D4A" is never committed to the form.
 */
function toHex6(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? `#${cleaned.toUpperCase()}` : null;
}

/**
 * Forgiving: also accepts a missing "#" and 3-digit shorthand. Used on blur and
 * when reading the incoming prop, so a value pasted as "d4af37" or "#FFF" still
 * resolves instead of being silently discarded.
 */
function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) return `#${cleaned.toUpperCase()}`;
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned.toUpperCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function ColorPicker({ label, value, onChange, description, className }: ColorPickerProps) {
  const inputId = useId();
  // Last known-good colour coming from the parent form.
  const committed = normalizeHex(value) ?? DEFAULT_COLOR;

  // Raw text the user sees/edits. Kept separate from `committed` so a partially
  // typed hex doesn't corrupt the swatches.
  const [text, setText] = useState(committed);
  const [isOpen, setIsOpen] = useState(false);

  // Sync unconditionally — the previous `if (value)` guard meant a parent that
  // cleared/reset the field left this picker showing a stale colour.
  useEffect(() => {
    setText(normalizeHex(value) ?? DEFAULT_COLOR);
  }, [value]);

  // Anything that renders a real CSS colour (native picker, swatch, preview)
  // must use a guaranteed-valid hex, otherwise <input type="color"> silently
  // snaps to #000000 and the swatches render transparent mid-typing.
  const swatch = toHex6(text) ?? committed;
  const isInvalid = text.trim().length > 0 && normalizeHex(text) === null;

  const commit = (newColor: string) => {
    const normalized = normalizeHex(newColor);
    if (!normalized) return;
    setText(normalized);
    onChange(normalized);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let next = e.target.value;
    // Users routinely paste/type without the leading "#".
    if (next.length > 0 && !next.startsWith('#')) next = `#${next}`;
    setText(next.toUpperCase());

    const normalized = toHex6(next);
    if (normalized) onChange(normalized);
  };

  const handleInputBlur = () => {
    const normalized = normalizeHex(text);
    if (normalized) {
      // Expands shorthand ("#FFF" → "#FFFFFF") and pushes it to the form.
      setText(normalized);
      if (normalized !== committed) onChange(normalized);
      return;
    }
    // Never leave the field showing a value that was never committed.
    setText(committed);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={inputId} className="text-sm font-medium">{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-3">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-12 h-10 p-1 border-2 flex-shrink-0"
              style={{ backgroundColor: swatch }}
              aria-label={`Pick ${label}`}
            >
              <span className="sr-only">Pick a color</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-center">
                <input
                  type="color"
                  // <input type="color"> lowercases its value per the HTML value
                  // sanitization algorithm, so an uppercase controlled value never
                  // matches node.value — React sees a permanently dirty input and
                  // the picker can snap. Lowercase here ONLY; `swatch` (and the
                  // stored/displayed hex) stays uppercase everywhere else.
                  value={swatch.toLowerCase()}
                  onChange={(e) => commit(e.target.value)}
                  className="w-full h-32 cursor-pointer rounded border-0"
                  aria-label={`${label} color picker`}
                />
              </div>
              <div className="grid grid-cols-6 gap-2">
                {presetColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={color}
                    className={cn(
                      "w-8 h-8 rounded-md border-2 transition-all hover:scale-110",
                      // Case-insensitive: <input type="color"> always reports
                      // lowercase hex, so a strict === never matched a preset.
                      swatch.toLowerCase() === color.toLowerCase()
                        ? "border-foreground ring-2 ring-offset-2 ring-primary"
                        : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      commit(color);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Input
          id={inputId}
          type="text"
          value={text}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          placeholder="#000000"
          className={cn(
            "w-28 font-mono text-sm uppercase",
            isInvalid && "border-destructive focus-visible:ring-destructive"
          )}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={isInvalid}
        />
        <div
          className="flex-1 h-10 rounded-md border"
          style={{
            background: `linear-gradient(135deg, ${swatch} 0%, ${swatch}88 100%)`
          }}
        />
      </div>
    </div>
  );
}

export default ColorPicker;
