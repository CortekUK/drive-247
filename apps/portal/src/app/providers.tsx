"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { TenantProvider } from "@/contexts/TenantContext";
import { RealtimeChatProvider } from "@/contexts/RealtimeChatContext";

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <>{children}</>;
}

function GlobalKeyboardShortcuts({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-global-search"));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <>{children}</>;
}

/**
 * Routes that render in light only. Signing in happens before there is a user
 * whose preference we could honour, and the screen carries no toggle, so there
 * is nothing for a theme to mean here.
 *
 * `forcedTheme` rather than `setTheme("light")`: setting it would overwrite the
 * stored preference, and an operator who runs the dashboard in dark would find
 * it had been reset for them by the act of logging in.
 */
const LIGHT_ONLY_ROUTES = ["/login", "/reset-password"];

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forcedTheme = LIGHT_ONLY_ROUTES.includes(pathname ?? "")
    ? "light"
    : undefined;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <>
      <NextTopLoader color="hsl(var(--primary))" height={2} showSpinner={false} />
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <RealtimeChatProvider>
            <AuthInitializer>
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
                forcedTheme={forcedTheme}
              >
                <TooltipProvider>
                  <GlobalKeyboardShortcuts>
                    <Toaster />
                    <Sonner />
                    {children}
                    {/* DevPanel is unmounted — it was a dev-only floating
                        button, and it is no longer wanted on screen. The
                        component and its Time Machine / test-call sections
                        are still on disk; re-add this line to bring it back. */}
                  </GlobalKeyboardShortcuts>
                </TooltipProvider>
              </ThemeProvider>
            </AuthInitializer>
          </RealtimeChatProvider>
        </TenantProvider>
      </QueryClientProvider>
    </>
  );
}
