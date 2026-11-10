"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/*
 * Light mode only (Ghulam, 2026-11-10): "It should be only light mode. Always." The site
 * no longer follows the visitor's system setting, and the header's theme switch is gone.
 *
 * /strategy-call keeps its own switch and behaves as before; it is left alone on purpose.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/strategy-call")) {
    return (
      <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
        {children}
      </NextThemesProvider>
    );
  }

  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
      {children}
    </NextThemesProvider>
  );
}
