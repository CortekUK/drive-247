import * as React from "react";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  showToggle?: boolean;
  showCapsLockWarning?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showToggle = true, showCapsLockWarning = true, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [capsLockOn, setCapsLockOn] = React.useState(false);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (showCapsLockWarning) {
        setCapsLockOn(e.getModifierState("CapsLock"));
      }
    };

    const handleKeyUp = (e: React.KeyboardEvent) => {
      if (showCapsLockWarning) {
        setCapsLockOn(e.getModifierState("CapsLock"));
      }
    };

    return (
      <div className="relative">
        <Input
          type={showPassword ? "text" : "password"}
          className={cn("pr-10", className)}
          ref={ref}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          {...props}
        />
        {showToggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        )}
        {capsLockOn && showCapsLockWarning && (
          <div className="absolute -bottom-6 left-0 flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            <span>Caps Lock is on</span>
          </div>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };