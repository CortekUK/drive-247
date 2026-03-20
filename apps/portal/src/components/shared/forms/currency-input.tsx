import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CurrencyInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value?: number;
  onChange: (value: number | undefined) => void;
  min?: number;
  step?: number;
  error?: boolean;
  currencySymbol?: string;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, min = 0, step = 0.01, error, currencySymbol = '$', className, ...props }, ref) => {
    const [display, setDisplay] = React.useState(() =>
      value != null && value !== 0 ? String(value) : ''
    );

    // Sync display when value changes externally (e.g. auto-calculation)
    React.useEffect(() => {
      setDisplay(value != null && value !== 0 ? String(value) : '');
    }, [value]);

    return (
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
          {currencySymbol}
        </div>
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={display}
          onChange={(e) => {
            const raw = e.target.value;
            // Allow empty, digits, single decimal point
            if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
              setDisplay(raw);
              if (raw === '' || raw === '.') {
                onChange(undefined);
              } else {
                const num = parseFloat(raw);
                if (!isNaN(num)) onChange(num);
              }
            }
          }}
          placeholder="0.00"
          className={cn("pl-8", error && "border-destructive", className)}
          {...props}
        />
      </div>
    );
  }
);

CurrencyInput.displayName = "CurrencyInput";
