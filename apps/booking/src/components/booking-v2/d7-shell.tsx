"use client";

import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { d7Display, d7Ui } from "./d7-fonts";
import { D7ThemeInit } from "./d7-theme";
import "./v2.css";

/**
 * Applies the booking-v2 design to the whole site.
 *
 * Mounted once in the root layout for tenants with `booking_v2_enabled`. The
 * `.d7` class does two jobs: it defines this design's own tokens, and it
 * remaps the shadcn tokens every existing page is already styled from
 * (`hsl(var(--primary))` and friends — see the token bridge in v2.css).
 *
 * That is why /fleet, /contact and the rest inherit the palette without being
 * rewritten: their components never referenced a colour directly, they
 * referenced a token, and inside this wrapper the tokens mean something new.
 *
 * When the flag is off this renders children untouched — no wrapper element,
 * no stylesheet effect, nothing for the tenant to notice.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Mirrors the design onto <html>.
 *
 * Radix portals every dialog, dropdown, popover and toast to document.body —
 * outside the wrapper below. Tokens scoped to `.d7` alone therefore never
 * reach them, which is why the login dialog kept the old gold theme while the
 * page around it was violet. Stamping `data-d7-site` (and the font variables)
 * on the root element lets portalled content inherit the same palette.
 */
function useD7RootTokens(enabled: boolean) {
  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const fonts = [d7Display.variable, d7Ui.variable].filter(Boolean);
    root.dataset.d7Site = "1";
    root.classList.add(...fonts);
    return () => {
      delete root.dataset.d7Site;
      root.classList.remove(...fonts);
    };
  }, [enabled]);
}

export function D7SiteShell({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  useD7RootTokens(enabled);
  if (!enabled) return <>{children}</>;

  return (
    <div className={`d7 d7-site ${d7Display.variable} ${d7Ui.variable}`}>
      <D7ThemeInit />
      {children}
    </div>
  );
}
