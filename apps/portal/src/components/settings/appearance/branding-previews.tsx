'use client';

/**
 * Settings → Branding (v2): the small pictures of where a tenant's name and
 * logos end up, drawn from the unsaved form so they change as the person types
 * or uploads.
 *
 *   PortalNamePreview   the top of the sidebar and a browser tab, with a note
 *                       when the name is too long to show in full there
 *   SquareIconPreview   the same two places, for the square icon
 *   SignInPreview       the top of the v2 sign-in page with the full logo
 *
 * Each one copies the real layout it pictures rather than approximating it:
 * the sidebar row uses `OrgMark` itself and the class strings of
 * `OrgSwitcher`'s expanded row (a test holds the two together), and the
 * sign-in picture is `components/auth-v2/login-v2.tsx` at half size. No white
 * tile or padding of ours sits around a logo: it is shown on the surface it
 * will actually appear on.
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import { ChevronsUpDown, Settings, X } from 'lucide-react';

import { OrgMark } from '@/components/shared/layout/org-switcher';
import { brandSurface } from '@/components/auth-v2/brand-surface';
import { cn } from '@/lib/utils';

/**
 * What the browser tab shows while a tenant has no square icon: the server
 * falls back to the platform icon (app/layout.tsx `PLATFORM_FAVICONS`).
 */
export const DEFAULT_TAB_ICON = '/icons/favicon-light.png';

/** The two logo previews are exactly this tall, so the cards line up. */
export const LOGO_PREVIEW_HEIGHT = 'h-36';

/** The tab title the portal sets: the site title when there is one, else "<name> - Portal". */
export function portalTabTitle(name: string, metaTitle?: string | null): string {
  return metaTitle?.trim() || `${name} - Portal`;
}

/**
 * The expanded `OrgSwitcher` row, not interactive. The sidebar is 16rem wide
 * and its header pads 6px a side, so the row is 244px, the name gets what the
 * mark, the gear and the menu button leave, and it truncates exactly where the
 * real one does.
 */
export const SIDEBAR_ROW = {
  frame: 'w-64 max-w-full shrink-0 p-1.5',
  /**
   * The same room inside a box with a 1px border: 256 + 2 = 258px wide, so the
   * border does not take 2px from the name and cut it off earlier than the
   * real sidebar does.
   */
  framedWithBorder: 'w-[258px] max-w-full shrink-0 border p-1.5',
  row: 'flex items-center rounded-lg',
  trigger: 'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left',
  name: 'min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight',
  gear: 'flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground',
  menu: 'mr-1 flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground',
} as const;

/** True once the element's text no longer fits its box (re-checked as it changes size). */
export function useTextTruncated<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const measure = () => {
      if (!cancelled) setTruncated(el.scrollWidth > el.clientWidth);
    };
    measure();
    // The v2 typeface loads after the first paint and is wider than the fallback.
    document.fonts?.ready.then(measure).catch(() => undefined);
    let observer: ResizeObserver | undefined;
    try {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    } catch {
      // No ResizeObserver: the text-change check above still runs.
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [text]);

  return [ref, truncated] as const;
}

function SidebarRow({
  name,
  iconUrl,
  iconAlt,
  nameRef,
}: {
  name: string;
  iconUrl: string | null;
  iconAlt: string;
  nameRef?: Ref<HTMLSpanElement>;
}) {
  return (
    <div className={SIDEBAR_ROW.row} data-preview-sidebar-row="">
      <div className={SIDEBAR_ROW.trigger}>
        <OrgMark preview={{ src: iconUrl, name, alt: iconAlt }} />
        <span ref={nameRef} className={SIDEBAR_ROW.name} data-preview-name="">
          {name}
        </span>
      </div>
      <span aria-hidden="true" className={SIDEBAR_ROW.gear}>
        <Settings className="h-4 w-4" />
      </span>
      <span aria-hidden="true" className={SIDEBAR_ROW.menu}>
        <ChevronsUpDown className="h-4 w-4" />
      </span>
    </div>
  );
}

/** One browser tab: the 16px icon, the title and the close mark, at Chrome's widest (240px). */
function BrowserTab({ title, iconUrl, iconAlt }: { title: string; iconUrl: string | null; iconAlt: string }) {
  return (
    <div className="flex h-8 w-60 min-w-0 max-w-full items-center gap-2 rounded-t-xl bg-background px-3" data-preview-tab="">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={iconUrl || DEFAULT_TAB_ICON} alt={iconAlt} className="size-4 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={title}>
        {title}
      </span>
      <X className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Portal name                                                                 */
/* -------------------------------------------------------------------------- */

export const PORTAL_NAME_CUT_OFF_NOTE = 'This name is too long to show in full in the sidebar, so it is cut off as shown.';

export function PortalNamePreview({
  name,
  tabIconUrl,
  sidebarIconUrl,
  tabTitle,
}: {
  name: string;
  /** The square icon, or null (the tab then shows the platform icon). */
  tabIconUrl: string | null;
  /** What the sidebar badge shows: the square icon, else the full logo, else initials. */
  sidebarIconUrl: string | null;
  tabTitle: string;
}) {
  const [nameRef, truncated] = useTextTruncated<HTMLSpanElement>(name);
  return (
    <div className="space-y-2" data-portal-name-preview="">
      <div className="flex flex-wrap items-stretch gap-3">
        <figure
          aria-label="Your name at the top of the sidebar"
          className={cn(SIDEBAR_ROW.framedWithBorder, 'rounded-xl bg-background')}
        >
          <SidebarRow name={name} iconUrl={sidebarIconUrl} iconAlt="Your logo in the sidebar" nameRef={nameRef} />
        </figure>
        <figure aria-label="Your name in a browser tab" className="flex w-[258px] max-w-full items-end rounded-xl bg-muted px-2 pt-2">
          <BrowserTab
            title={tabTitle}
            iconUrl={tabIconUrl}
            iconAlt={tabIconUrl ? 'Your square icon in a browser tab' : 'Default icon in a browser tab'}
          />
        </figure>
      </div>
      {truncated && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {PORTAL_NAME_CUT_OFF_NOTE}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Square icon                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A browser window cut down to its top-left corner: the tab strip, then the
 * top of the sidebar, each at full size so the 16px and 32px icons read true.
 */
export function SquareIconPreview({
  name,
  iconUrl,
  sidebarIconUrl,
  tabTitle,
}: {
  name: string;
  /** The square icon, or null (the tab then shows the platform icon). */
  iconUrl: string | null;
  /** What the sidebar badge shows: the square icon, else the full logo, else initials. */
  sidebarIconUrl: string | null;
  tabTitle: string;
}) {
  return (
    <figure
      aria-label="Your square icon in a browser tab and at the top of the sidebar"
      className={cn('flex flex-col overflow-hidden rounded-xl border bg-muted', LOGO_PREVIEW_HEIGHT)}
      data-logo-preview="small"
    >
      <div className="flex h-10 shrink-0 items-end px-2">
        <BrowserTab
          title={tabTitle}
          iconUrl={iconUrl}
          iconAlt={iconUrl ? 'Square icon in a browser tab' : 'Default icon in a browser tab'}
        />
      </div>
      <div className="flex min-h-0 flex-1 bg-background">
        <div className={cn(SIDEBAR_ROW.frame, 'pt-3')}>
          <SidebarRow name={name} iconUrl={sidebarIconUrl} iconAlt="Square icon in the sidebar" />
        </div>
      </div>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Full logo on the sign-in page                                               */
/* -------------------------------------------------------------------------- */

/**
 * login-v2's `WASH_MASK`: the brand tint is solid across the left third, then
 * eases out to nothing at the right edge. Copied, not imported: that file keeps
 * it private to the auth path.
 */
const WASH_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 34%,
  rgb(0 0 0 / 0.96) 42%,
  rgb(0 0 0 / 0.88) 49%,
  rgb(0 0 0 / 0.74) 56%,
  rgb(0 0 0 / 0.56) 63%,
  rgb(0 0 0 / 0.38) 70%,
  rgb(0 0 0 / 0.22) 77%,
  rgb(0 0 0 / 0.10) 84%,
  rgb(0 0 0 / 0.03) 92%,
  rgb(0 0 0 / 0) 100%)`;

/**
 * The top of the sign-in page at half size, in its light look: the brand tint
 * from `brandSurface`, the full logo where login-v2 puts it (top left of the
 * hero column, 56px tall and at most 220px wide, here 28 and 110), and the
 * start of the form on the right. The real page follows the viewer's light or
 * dark mode; this always shows the light look, the one the full logo
 * (`logo_url`) is drawn on there (dark mode uses the dark-mode or sign-in logo
 * instead). So its colours are the v2 light values (white page, neutral 950 /
 * 500 / 300 text and lines), not tokens that would turn dark here.
 */
export function SignInPreview({
  logoUrl,
  appName,
  brandColor,
}: {
  logoUrl: string | null;
  appName: string;
  /** The colour login-v2 tints its hero with (the accent, else the primary). */
  brandColor: string | null;
}) {
  const hero = brandSurface(brandColor, false);
  return (
    <figure
      aria-label="Your full logo on the sign-in page"
      className={cn('relative overflow-hidden rounded-xl border bg-white', LOGO_PREVIEW_HEIGHT)}
      data-logo-preview="large"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-preview-wash=""
        style={{ backgroundColor: hero.color, maskImage: WASH_MASK, WebkitMaskImage: WASH_MASK }}
      />
      <div className="relative grid h-full grid-cols-2">
        <div className="min-w-0 p-6">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Full logo on the sign-in page" className="h-7 w-auto max-w-[110px] object-contain" />
          ) : (
            <span className="block truncate text-xs font-semibold tracking-tight text-slate-900">{appName}</span>
          )}
        </div>
        <div aria-hidden="true" className="flex min-w-0 flex-col justify-end px-5">
          <p className="text-[15px] font-semibold leading-tight tracking-tight text-neutral-950">Sign in</p>
          <p className="mt-1 truncate text-[7px] leading-tight text-neutral-500">
            Enter your email and password to access {appName}.
          </p>
          <p className="mt-2.5 text-[7px] font-medium text-neutral-950">Email Address</p>
          <div className="-mb-2 mt-1 h-6 rounded-lg border border-neutral-300 bg-white" />
        </div>
      </div>
    </figure>
  );
}
