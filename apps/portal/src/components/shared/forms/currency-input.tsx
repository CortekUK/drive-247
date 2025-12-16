import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CurrencyInputProps extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value?: number;
  onChange: (value: number | undefined) => void;
  min?: number;
  step?: number;
  error?: boolean;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, min = 0, step = 0.01, error, className, ...props }, ref) => {
    return (
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
          $
        </div>
        <Input
          ref={ref}
          type="number"
          min={min}
          step={step}
          value={value ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === '' ? undefined : parseFloat(val));
          }}
          className={cn("pl-8", error && "border-destructive", className)}
          {...props}
        />
      </div>
    );
  }
);

CurrencyInput.displayName = "CurrencyInput";