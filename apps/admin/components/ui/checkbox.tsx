"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * Hand-rolled to match this app's Switch rather than pulling in
 * @radix-ui/react-checkbox — admin has no Radix checkbox dependency and its
 * other form primitives are plain buttons with the right ARIA roles.
 */
const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, ...props }, ref) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      ref={ref}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
        className,
      )}
      {...props}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
