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
 *
 * The browser tab and the sidebar badge both take `resolveBrandIcon`
 * (lib/appearance/logo.ts), the same chain `useDynamicTheme` puts in the real
 * tab, so the two pictures cannot show different things — which is exactly
 * what they did: with the square icon removed, the sidebar drew the tenant's
 * initials and the tab beside it drew the Drive247 platform icon.
 */

import { useMemo, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { ChevronsUpDown, Settings, X } from 'lucide-react';

import { OrgMark } from '@/components/shared/layout/org-switcher';
import { brandSurface } from '@/components/auth-v2/brand-surface';
import { PLATFORM_TAB_ICON, resolveBrandIcon, type BrandIcon } from '@/lib/appearance/logo';
import { cn } from '@/lib/utils';

/**
 * What the browser tab shows when there is no square icon AND no mark can be
 * drawn: the platform icon the server falls back to (app/layout.tsx
 * `PLATFORM_FAVICONS`). In a browser the mark always draws, so this is the
 * server-render case only.
 */
export const DEFAULT_TAB_ICON = PLATFORM_TAB_ICON;

/**
 * What the tab and the sidebar badge show for this square icon and name: the
 * icon, else a mark drawn from the name's initials in the brand colour.
 *
 * Memoised so the drawn mark is one stable string across renders — an `<img>`
 * whose src keeps changing flickers.
 */
export function useBrandIcon(iconUrl: string | null, name: string, brandColor: string | null): BrandIcon {
  const brandVars = useBrandVarsVersion();
  // `brandVars` is not read inside: it is here to make the resolve run again
  // once the portal has actually been repainted. See below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveBrandIcon(iconUrl, name, { brandColor }), [iconUrl, name, brandColor, brandVars]);
}

/**
 * Ticks whenever the variables the mark is drawn from could have changed.
 *
 * `resolveBrandIcon` prefers the running page's own `--primary`, which is what
 * `OrgMark`'s chip paints with — but the try-on does not write that variable
 * here. It writes the candidate palette into the branding query cache, and
 * `useDynamicTheme` — an ANCESTOR, whose effect therefore runs after this
 * subtree's — turns it into `--brand-*` on `<body>`. The resolve above happens
 * during render, so it reads the colour the portal is STILL painted in: without
 * this the drawn mark sat one colour behind every pick, and behind the dark-mode
 * switch (`.dark` goes on `<html>`).
 */
function useBrandVarsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    const watch: MutationObserverInit = { attributes: true, attributeFilter: ['style', 'class'] };
    if (document.body) observer.observe(document.body, watch);
    observer.observe(document.documentElement, watch);
    return () => observer.disconnect();
  }, []);
  return version;
}

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
  icon,
  iconAlt,
  nameRef,
}: {
  name: string;
  icon: BrandIcon;
  iconAlt: string;
  nameRef?: Ref<HTMLSpanElement>;
}) {
  return (
    <div className={SIDEBAR_ROW.row} data-preview-sidebar-row="">
      <div className={SIDEBAR_ROW.trigger}>
        {/* `icon.src` is the drawn mark when there is no square icon, and null
            only where it could not be drawn — OrgMark then paints its own chip
            from the same initials, which is what the real sidebar does. */}
        <OrgMark preview={{ src: icon.src, name, alt: iconAlt }} />
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
function BrowserTab({ title, icon, iconAlt }: { title: string; icon: BrandIcon; iconAlt: string }) {
  return (
    <div className="flex h-8 w-60 min-w-0 max-w-full items-center gap-2 rounded-t-xl bg-background px-3" data-preview-tab="">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon.src || DEFAULT_TAB_ICON} alt={iconAlt} className="size-4 shrink-0 object-contain" />
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

/**
 * The row the name field and its pictures share.
 *
 * Settings rows are a 420px first column, a 40px gutter and the rest (see
 * `settings-kit.tsx` `SettingsRow`), and they stack below `md`. This is that
 * same grid, so the field's left edge and the pictures' left edge line up with
 * every other row on the page rather than looking bolted on — the pictures used
 * to hang under the field with the whole right half of the section empty (team
 * lead, Sep 2026).
 *
 * `items-start` and not `items-center`: the field is one 36px box and the
 * pictures are three times that, and the lead asked for the section not to grow.
 */
const PORTAL_NAME_ROW =
  'flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:items-start md:gap-x-10';

export function PortalNamePreview({
  name,
  iconUrl,
  brandColor,
  tabTitle,
  field,
}: {
  name: string;
  /** The square icon, or null (both places then show the initials mark). */
  iconUrl: string | null;
  /** The brand colour the mark is drawn in, when the page's own cannot be read. */
  brandColor: string | null;
  tabTitle: string;
  /**
   * The name field itself, so it and the pictures are one row rather than two
   * stacked blocks. The cut-off note belongs to the field and travels with it;
   * it is measured HERE, off the sidebar row, which is why the field is passed
   * in rather than the note being lifted out.
   */
  field?: ReactNode;
}) {
  const [nameRef, truncated] = useTextTruncated<HTMLSpanElement>(name);
  const icon = useBrandIcon(iconUrl, name, brandColor);
  return (
    <div className={PORTAL_NAME_ROW} data-portal-name-preview="">
      <div className="min-w-0 space-y-2" data-portal-name-field="">
        {field}
        {truncated && (
          <p role="status" className="text-[13px] text-muted-foreground">
            {PORTAL_NAME_CUT_OFF_NOTE}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-stretch gap-3" data-portal-name-pictures="">
        <figure
          aria-label="Your name at the top of the sidebar"
          className={cn(SIDEBAR_ROW.framedWithBorder, 'rounded-xl bg-background')}
        >
          <SidebarRow
            name={name}
            icon={icon}
            iconAlt={icon.kind === 'icon' ? 'Your square icon in the sidebar' : 'Your initials in the sidebar'}
            nameRef={nameRef}
          />
        </figure>
        <figure aria-label="Your name in a browser tab" className="flex w-[258px] max-w-full items-end rounded-xl bg-muted px-2 pt-2">
          <BrowserTab
            title={tabTitle}
            icon={icon}
            iconAlt={
              icon.kind === 'icon'
                ? 'Your square icon in a browser tab'
                : icon.src
                  ? 'Your initials in a browser tab'
                  : 'Default icon in a browser tab'
            }
          />
        </figure>
      </div>
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
  brandColor,
  tabTitle,
}: {
  name: string;
  /** The square icon, or null (both places then show the initials mark). */
  iconUrl: string | null;
  /** The brand colour the mark is drawn in, when the page's own cannot be read. */
  brandColor: string | null;
  tabTitle: string;
}) {
  const icon = useBrandIcon(iconUrl, name, brandColor);
  return (
    <figure
      aria-label="Your square icon in a browser tab and at the top of the sidebar"
      className={cn('flex flex-col overflow-hidden rounded-xl border bg-muted', LOGO_PREVIEW_HEIGHT)}
      data-logo-preview="small"
    >
      <div className="flex h-10 shrink-0 items-end px-2">
        <BrowserTab
          title={tabTitle}
          icon={icon}
          iconAlt={
            icon.kind === 'icon'
              ? 'Square icon in a browser tab'
              : icon.src
                ? 'Your initials in a browser tab'
                : 'Default icon in a browser tab'
          }
        />
      </div>
      <div className="flex min-h-0 flex-1 bg-background">
        <div className={cn(SIDEBAR_ROW.frame, 'pt-3')}>
          <SidebarRow
            name={name}
            icon={icon}
            iconAlt={icon.kind === 'icon' ? 'Square icon in the sidebar' : 'Your initials in the sidebar'}
          />
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
