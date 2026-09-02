"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { TenantProvider } from "@/contexts/TenantContext";
import { RealtimeChatProvider } from "@/contexts/RealtimeChatContext";
import DevPanel from "@/components/shared/DevPanel";

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

export function Providers({ children }: { children: React.ReactNode }) {
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
              >
                <TooltipProvider>
                  <GlobalKeyboardShortcuts>
                    <Toaster />
                    <Sonner />
                    {children}
                    <DevPanel />
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
