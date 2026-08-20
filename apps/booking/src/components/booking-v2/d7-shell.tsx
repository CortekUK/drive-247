"use client";

import type { ReactNode } from "react";
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
export function D7SiteShell({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>;

  return (
    <div className={`d7 d7-site ${d7Display.variable} ${d7Ui.variable}`}>
      <D7ThemeInit />
      {children}
    </div>
  );
}
