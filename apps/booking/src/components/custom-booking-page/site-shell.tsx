"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import { createContext, useContext } from "react";
import { Suspense, useEffect } from "react";
import { CbpActionsProvider } from "./actions";
import { Footer, Nav } from "./shell";
import { useCbpTheme } from "./theme-toggle";
import { accentCss } from "./theme";
import { useSiteContent, type CbpContent } from "./use-site-content";
import type { CbpSeed } from "./seed";
import "./styles.css";

/**
 * One geometric grotesque across the whole site, as in the reference: the same
 * family carries the display headline, section titles, body copy and numerals,
 * separated only by weight.
 */
const font = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cbp",
  display: "swap",
});

/**
 * Content is resolved ONCE in the shell and handed down through context, so a
 * page never runs the content hook a second time and the header, footer and
 * body can never disagree about which tenant they belong to.
 *
 * Context rather than a render prop for a hard reason: the routes are server
 * components (they await the tenant seed), and a server component cannot pass
 * a function across the boundary as `children` — React refuses it outright.
 * Plain JSX children can cross; a hook on the other side reads the content.
 */
/** Set while a visitor is on this site; read by the shared customer portal. */
export const CBP_MARKER = "cbp-site";

const SiteContext = createContext<CbpContent | null>(null);

/** The resolved tenant content. Only valid inside `SiteShell`. */
export function useSite(): CbpContent {
  const c = useContext(SiteContext);
  if (!c) throw new Error("useSite must be used inside <SiteShell>");
  return c;
}

/**
 * The frame every page of this site renders inside: the design's namespace,
 * the tenant's palette, the header and the footer.
 *
 * Everything is namespaced under `.cbp`, so none of this design's tokens reach
 * the existing booking site. The palette is the one runtime addition, derived
 * from the tenant's own colours and applied as inline custom properties here —
 * which is why every token in the stylesheet resolves to the operator's colour
 * without a single selector changing.
 */
export function SiteShell({
  seed, children,
}: {
  seed?: CbpSeed | null;
  children: React.ReactNode;
}) {
  const content = useSiteContent(seed);
  const { mode, toggle } = useCbpTheme();

  // `/portal` is shared by both sites, and it bounces a signed-out visitor to a
  // login. This marker tells it which site to bounce them back to, so someone
  // who has only ever seen this one is never dropped onto the other.
  useEffect(() => {
    try { sessionStorage.setItem(CBP_MARKER, "1"); } catch { /* storage blocked */ }
  }, []);

  // The accent's INGREDIENTS go on `:root` rather than on the site root, and as
  // markup rather than as an effect. On `:root` because Radix portals its
  // dialogs, menus and popovers to <body>, outside this tree — they carry the
  // `cbp` class for the token rules, but they cannot inherit a variable set on
  // an element they are not inside. As markup because it is then present in the
  // server response: an operator on a custom accent never sees the default
  // painted first and swapped a moment later.
  const css = accentCss(content.theme);

  return (
    <SiteContext.Provider value={content}>
      {css && <style>{css}</style>}
      {/* The palette itself lives in styles.css, keyed off `data-theme`; the
          style above supplies only `--a-*` (light) and `--ad-*` (dark) for
          those rules to choose between. Setting `--brand` directly would
          outrank the dark-mode rules and the toggle would stop working. */}
      <div className={`cbp cbp-root ${font.variable}`} data-theme={mode ?? undefined}>
        {/* Suspense because the provider reads search params to honour
            ?auth=login, and Next requires that boundary for a client hook
            that suspends during prerender. */}
        <Suspense fallback={null}>
          <CbpActionsProvider>
            <Nav c={content} mode={mode} onToggleMode={toggle} />
            <main>{children}</main>
            <Footer c={content} />
          </CbpActionsProvider>
        </Suspense>
      </div>
    </SiteContext.Provider>
  );
}
