"use client";

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { pickSystemBanner } from "@/lib/announcements/queue";
import {
  SYSTEM_BANNER_UI,
  TONE_CLASSES,
  resolveInPortalCta,
} from "@/lib/announcements/contract";
import { ToneIcon } from "@/components/announcements/tone-icon";

/** Set on <html> while a banner is up; global.css offsets the fixed chrome by it. */
export const SYSTEM_BANNER_HEIGHT_VAR = "--system-banner-h";

// The effect below measures before paint, so the sidebar, top bar and content never
// flash under the banner for a frame. The layout is a client component that still
// server-renders, where there is nothing to measure.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The ONE full-width system banner slot, for every tenant in both chromes.
 *
 * WHERE IT SITS. Mounted as the first child of the dashboard layout's
 * DynamicThemeProvider, OUTSIDE the sidebar wrapper, as `position: fixed` across the
 * top of the viewport: end to end, over the sidebar column and above the top bar
 * (meeting: "like the red Stripe banner, but full width"). Not `sticky`: sticky does
 * not pin on v1, where `html, body { overflow-x: hidden }` makes <body> a scroll
 * container that never scrolls.
 *
 * MAKING ROOM. A fixed bar takes no space, so two things push the app down by exactly
 * its measured height:
 *   - an in-flow spacer rendered right before the app shell, for the document flow;
 *   - `html[data-system-banner]` + `--system-banner-h` for everything already pinned
 *     to the viewport (both sidebars, the sticky v2 top bar, the docked Trax panel,
 *     the bounded-height Messages/Trax routes). Those rules live in global.css,
 *     attribute selectors only. Same pattern as TraxPanel's `data-trax-panel`.
 * Both are removed the moment there is nothing to show, so a tenant with no active
 * banner gets byte-for-byte the page it had.
 *
 * WHICH BANNER. Rows arrive in priority order; the first hard banner or due soft one
 * wins (`pickSystemBanner`). Closing a soft one records `dismissed` and the next due
 * banner takes the slot straight away. A hard one has no X and stays until the admin
 * deactivates it or the tenant leaves its smart filter.
 *
 * The body renders in full and wraps; its line breaks collapse to spaces in this
 * one-line form. Plain text only.
 */
export function SystemAnnouncementBanner(): JSX.Element | null {
  const router = useRouter();
  const { system, recordEvent } = usePortalAnnouncements();
  const { canAccessRoute } = useManagerPermissions();
  const banner = pickSystemBanner(system);

  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [height, setHeight] = useState(0);
  // Centred is right for one line. Once the text wraps, a centred icon floats beside a
  // middle line (the third of five on a phone), so it moves up to the first line.
  const [wrapped, setWrapped] = useState(false);

  const bannerKey = banner ? `${banner.id}:${banner.revision}` : null;

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.removeAttribute("data-system-banner");
      root.style.removeProperty(SYSTEM_BANNER_HEIGHT_VAR);
    };
    const el = rootRef.current;
    if (!bannerKey || !el) {
      clear();
      setHeight(0);
      setWrapped(false);
      return;
    }
    const publish = () => {
      const measured = Math.ceil(el.getBoundingClientRect().height);
      setHeight(measured);
      root.setAttribute("data-system-banner", "");
      root.style.setProperty(SYSTEM_BANNER_HEIGHT_VAR, `${measured}px`);
      const text = textRef.current;
      if (text) {
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 20;
        setWrapped(text.getBoundingClientRect().height > lineHeight * 1.5);
      }
    };
    publish();
    // Re-measure when the text wraps differently (resize, zoom, font load). An
    // environment without a working ResizeObserver keeps the first measurement
    // rather than taking the whole layout down with it.
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => publish());
      observer.observe(el);
      if (textRef.current) observer.observe(textRef.current);
    } catch {
      observer = null;
    }
    return () => {
      observer?.disconnect();
      clear();
    };
  }, [bannerKey]);

  // One impression per id+revision per page load (recordEvent de-duplicates).
  useEffect(() => {
    if (banner) recordEvent(banner, "shown");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannerKey, recordEvent]);

  if (!banner) return null;

  const tone = banner.tone ?? "info";
  const toneClasses = TONE_CLASSES[tone] ?? TONE_CLASSES.info;
  const soft = banner.blocking !== "hard";
  const cta = banner.cta_label ? resolveInPortalCta(banner.cta_url) : null;
  const showCta = !!cta && canAccessRoute(cta.pathname);
  const body = (banner.body ?? "").replace(/\n+/g, " ");

  return (
    <>
      <div aria-hidden="true" data-system-banner-spacer="" style={{ height }} />
      <div
        ref={rootRef}
        role="region"
        aria-label="Announcement"
        data-system-banner-root=""
        data-blocking={banner.blocking}
        data-tone={tone}
        className={cn(SYSTEM_BANNER_UI.position, SYSTEM_BANNER_UI.root, toneClasses.banner)}
      >
        <div className={SYSTEM_BANNER_UI.inner}>
          <ToneIcon tone={tone} className={cn(SYSTEM_BANNER_UI.icon, wrapped && "mt-0.5 self-start")} />
          <p ref={textRef} className={SYSTEM_BANNER_UI.text}>
            <strong className={SYSTEM_BANNER_UI.title}>{banner.title}</strong>
            {body && <span className={SYSTEM_BANNER_UI.body}>{body}</span>}
          </p>
          {(showCta || soft) && (
            <div className={SYSTEM_BANNER_UI.actions}>
              {showCta && (
                <button
                  type="button"
                  className={cn(SYSTEM_BANNER_UI.action, toneClasses.bannerAction)}
                  onClick={() => {
                    recordEvent(banner, "cta_clicked");
                    router.push(cta!.href);
                  }}
                >
                  {banner.cta_label}
                </button>
              )}
              {soft && (
                <button
                  type="button"
                  aria-label="Dismiss announcement"
                  className={cn(SYSTEM_BANNER_UI.dismiss, toneClasses.bannerDismiss)}
                  onClick={() => recordEvent(banner, "dismissed")}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
