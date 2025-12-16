import { useState, useEffect } from 'react';
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

export function ColorPicker({ label, value, onChange, description, className }: ColorPickerProps) {
  const [localValue, setLocalValue] = useState(value || '#C6A256');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (value) {
      setLocalValue(value);
    }
  }, [value]);

  const handleColorChange = (newColor: string) => {
    setLocalValue(newColor);
    onChange(newColor);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    // Only update parent if it's a valid hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(newValue)) {
      onChange(newValue);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label className="text-sm font-medium">{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-3">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-12 h-10 p-1 border-2"
              style={{ backgroundColor: localValue }}
            >
              <span className="sr-only">Pick a color</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="space-y-3">
              <div className="flex items-center justify-center">
                <input
                  type="color"
                  value={localValue}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="w-full h-32 cursor-pointer rounded border-0"
                />
              </div>
              <div className="grid grid-cols-6 gap-2">
                {presetColors.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-8 h-8 rounded-md border-2 transition-all hover:scale-110",
                      localValue === color ? "border-foreground ring-2 ring-offset-2 ring-primary" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => {
                      handleColorChange(color);
                      setIsOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Input
          type="text"
          value={localValue}
          onChange={handleInputChange}
          placeholder="#000000"
          className="w-28 font-mono text-sm uppercase"
          maxLength={7}
        />
        <div
          className="flex-1 h-10 rounded-md border"
          style={{
            background: `linear-gradient(135deg, ${localValue} 0%, ${localValue}88 100%)`
          }}
        />
      </div>
    </div>
  );
}

export default ColorPicker;
