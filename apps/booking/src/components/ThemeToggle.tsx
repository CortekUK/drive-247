import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { isForcedThemeMode } from "@/lib/theme-mode";

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const { tenant } = useTenant();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  // Tenant forces a single theme (light_only / dark_only) → no toggle to show.
  if (isForcedThemeMode(tenant?.customer_theme_mode)) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};
