/**
 * The installed portal app: what it is called, and how a changed icon reaches
 * the Home Screen.
 *
 * Shared by `app/manifest.webmanifest/route.ts` (Android, desktop Chrome) and
 * the root layout's `icons.apple` (iOS), so the two never disagree.
 *
 * Name — Settings → Branding → Portal name is "the name at the top of your
 * sidebar and in the browser tab", and `app/pwa-icon` already draws the icon's
 * initial from it. The manifest alone kept naming the app after the company,
 * so renaming the portal changed the tab and the sidebar but not the app on the
 * phone (QA B2.11, Nov 2026). The "Ops" suffix stays: an operator may well
 * install the customer booking site too, and two Home Screen icons with the
 * same label help nobody.
 *
 * Icon — `/pwa-icon/*.png` is cached at the CDN for a day
 * (`s-maxage=86400`, and the route must stay cacheable: it is drawn on request).
 * Without a version in the URL an operator who replaced their square icon kept
 * seeing the old one on reopening the app for up to a day, because the edge
 * answered from its copy. The version is a tag of everything the drawing
 * depends on, so a new icon, colour or initial is a new URL and a cache miss,
 * while an unchanged one keeps its cached copy.
 */

/** The platform's own name that `tenants.app_name` used to default to; never a tenant's choice. */
const PLATFORM_DEFAULT_APP_NAME = 'Drive 917';

/** The label most launchers clip at. */
const SHORT_NAME_MAX = 12;

export const PORTAL_APP_SUFFIX = 'Ops';

/** The tenant's own portal name: `app_name` unless empty or the platform default. */
export function ownPortalName(appName: string | null | undefined): string | null {
  const trimmed = appName?.trim() ?? '';
  return trimmed && trimmed !== PLATFORM_DEFAULT_APP_NAME ? trimmed : null;
}

/** The name the app shows under its icon when the label has room: "Northwind QA Ops". */
export function portalAppName(appName: string | null | undefined, companyName: string | null | undefined): string | null {
  const base = ownPortalName(appName) ?? companyName?.trim() ?? '';
  if (!base) return null;
  return new RegExp(`\\b${PORTAL_APP_SUFFIX}$`, 'i').test(base) ? base : `${base} ${PORTAL_APP_SUFFIX}`;
}

/** The short label (iOS clips around 12 characters): the portal name, else the company name, cut to fit. */
export function portalAppShortName(appName: string | null | undefined, companyName: string | null | undefined): string | null {
  const base = ownPortalName(appName) ?? companyName?.trim() ?? '';
  if (!base) return null;
  return base.length > SHORT_NAME_MAX ? base.slice(0, SHORT_NAME_MAX).trim() : base;
}

/**
 * A short, stable tag of the inputs the icon is drawn from (FNV-1a, 8 hex
 * characters). Same inputs, same tag; any change, a different one.
 */
export function pwaIconVersion(parts: ReadonlyArray<string | null | undefined>): string {
  const input = parts.map((p) => p ?? '').join('\u0000');
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `/pwa-icon/192.png?v=…` — the drawn icon's URL, versioned so a changed icon is a new URL. */
export function pwaIconPath(file: string, version: string): string {
  return `/pwa-icon/${file}?v=${version}`;
}
