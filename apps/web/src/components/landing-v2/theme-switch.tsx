"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Round icon button with the portal's purple-tint hover. */
export function ThemeSwitch() {
  const { setTheme, resolvedTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      className="relative inline-flex size-9 items-center justify-center rounded-full text-[var(--lv-ink-3)] transition-colors duration-200 ease-out hover:bg-[var(--lv-tint)] hover:text-[var(--lv-ink)] motion-reduce:transition-none"
    >
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}
