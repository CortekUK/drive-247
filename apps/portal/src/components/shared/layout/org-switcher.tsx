"use client";

import Link from "next/link";
import { ExternalLink, Pencil, SlidersHorizontal } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { getBrandInitials } from "@/components/shared/layout/brand-logo";
import { BRAND_MARK_FALLBACK_INITIALS } from "@/lib/appearance/logo";
import { bookingOriginFor } from "@/lib/booking-origin";
import { cn } from "@/lib/utils";

/**
 * Square tenant mark for the avatar-sized slot at the top of the v2 sidebar.
 *
 * Deliberately local rather than exported from `brand-logo.tsx`: that file is a
 * v1 file, and v2 does not edit v1 files (V2_PLAN §3).
 *
 * The square icon (`favicon_url`, the image Settings → Branding asks for
 * exactly this slot), else a chip of the tenant's own initials — never the
 * platform's brand.
 *
 * The full logo is NOT in that chain, and `dark_logo_url` is not either. It
 * used to be the middle step, so a tenant who filled only the Full logo slot
 * found their wordmark here, shrunk to an unreadable sliver at 32px, in a slot
 * they had never chosen it for (team lead, Sep 2026). The two slots are
 * independent. `lib/appearance/logo.ts` `resolveBrandIcon` is the same chain
 * in a form the browser tab and Settings → Branding can use.
 *
 * The image sits straight on the sidebar ground: no tile or padding of ours
 * around it, so any edge a person sees belongs to their own image (team lead,
 * Sep 2026: the white edges around the logo were ours, and had to go).
 *
 * `preview` is Settings → Branding drawing this same mark from its unsaved
 * form (the image and name being edited) instead of the saved branding, so the
 * preview can never drift from the real thing. Exported for that page only.
 */
export interface OrgMarkPreview {
  /** The image to show, or null for the initials chip. */
  src: string | null;
  /** The name the initials come from. */
  name: string;
  alt?: string;
}

export function OrgMark({ className, preview }: { className?: string; preview?: OrgMarkPreview }) {
  const { branding, brandName } = useTenantBranding();

  const logoUrl = preview ? preview.src : branding?.favicon_url;
  const name = preview ? preview.name : brandName;

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={preview?.alt ?? name}
        className={cn("h-8 w-8 shrink-0 rounded-lg object-contain", className)}
      />
    );
  }

  return (
    <div
      title={name}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground",
        className
      )}
    >
      {getBrandInitials(name) || BRAND_MARK_FALLBACK_INITIALS}
    </div>
  );
}

/**
 * The three controls at the end of the expanded org row — the Branding pencil,
 * the sidebar customiser and the booking-site arrow — are one shape, so they
 * are one class string. 28px square and `rounded-lg`: the same box as the
 * Settings gear and the account caret on the profile row in the sidebar footer
 * (`user-menu-v2.tsx`), which is what the team lead lined this row up against.
 * `v2` markup never uses `rounded-md` or `rounded-sm`.
 *
 * Shared rather than repeated three times because they have to stay identical:
 * the Branding preview measures the name against these widths (see below), so a
 * control that quietly grows here moves where a tenant's name is cut off there.
 */
const ROW_CONTROL =
  "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]";

/** The glyph inside each of them, and the row's own scale: 14px, not the footer's 16. */
const ROW_CONTROL_ICON = "h-3.5 w-3.5";

/**
 * Top-of-sidebar organization row: the tenant's mark and name, and the way to
 * their booking site.
 *
 * ── THE ROW IS THE BOOKING SITE (Sep 21 2026) ──────────────────────────────
 * The walkthrough asked for this row to open the tenant's booking site — "when
 * I press this, take me to the booking site" — with the "opens in a new
 * window" arrow always showing and a small pencil appearing beside it on hover
 * that goes to Branding. That behaviour was first built as a separate
 * "Booking site" row in the nav; the user asked for it here instead, with no
 * "Booking site" title: the tenant's own name says whose site it is.
 *
 * ── THE ORDER, AND WHY (team lead, Sep 23 2026, with screenshots) ──────────
 * Left to right: mark · name · pencil · (gap) · customiser · arrow.
 *
 *   - Clicking the mark or the name opens the booking site in a new tab, as
 *     the row has done since Sep 21.
 *   - The PENCIL sits immediately after the name rather than out at the row's
 *     end, which is why the name link no longer stretches (`flex-1` went from
 *     both the link and the name span). A `flex-1` link would push the pencil
 *     to the far edge again; hugging its content instead means a long name
 *     TRUNCATES against the pencil rather than shoving it around, which is the
 *     behaviour asked for. The gap the name used to fill is an explicit
 *     spacer, so the last two controls are pinned to the edge whether or not
 *     the pencil is there.
 *   - That spacer is inert: it is the one place on the row that no longer
 *     opens the site. It cannot be part of the name link without the link
 *     stretching, and the pencil sitting against the name is what was asked
 *     for. The mark, the name and the arrow all still open it.
 *   - The CUSTOMISER came up from the profile row in the footer
 *     (`user-menu-v2.tsx`). It is ALWAYS visible, never hover-revealed: it is a
 *     primary way into the sidebar customiser and hiding it would bury it. It
 *     dispatches `open-sidebar-customizer`; the dialog stays mounted in
 *     app-sidebar-v2.tsx, which is the only place that has the computed nav.
 *   - The ARROW is last, on the row's right edge, and is now a control of its
 *     own rather than an icon inside the name link — that is the only way it
 *     can be at the END while the pencil is at the NAME. So the row holds two
 *     links to the same URL, which is fine: same destination, same promise of
 *     a new tab. It keeps "Open your booking site" as its tooltip.
 *   - The arrow and the customiser are always visible, so the row says up front
 *     that it leaves the portal. The pencil appears on hover, with a hover
 *     state of its own, and goes to Branding (`/settings/appearance`).
 *     `opacity-0` hides it from the eye but not from the keyboard, so
 *     `focus-visible:opacity-100` shows it to a tab user; and it keeps its room
 *     at rest, so the name never jumps on hover.
 *   - All three are the same 28px `rounded-lg` box (`ROW_CONTROL`), the last
 *     one flush with the row's right edge — the same trailing control as the
 *     Settings gear and the caret on the profile row in the footer, which are
 *     also 28px, also flush, and also inside a `p-1.5` row. The pencil used to
 *     carry `mr-1`, which held it 4px short of the edge and read as not quite
 *     lined up (team lead, Sep 23 2026); nothing here carries an end margin now.
 *   - Links are siblings inside one container, never nested: an <a> in an <a>
 *     is invalid, and the outer one would swallow the pencil's click. The
 *     container carries the hover highlight, so it covers all three controls.
 *   - Collapsed, the mark alone opens the site; the rail is 48px, which has no
 *     room for three controls beside a 32px mark, so neither the pencil nor the
 *     customiser is drawn there. Branding is one click away on the Settings
 *     index, and the customiser is on the expanded rail.
 *   - The pencil is shown only to someone Branding will let in. It was ungated
 *     on the old nav row, so a manager without the Settings grant got a pencil
 *     that bounced them to the dashboard. Its rule is the Settings gear's —
 *     `!isManager || canView('settings')` — which is exactly what
 *     `canAccessRoute('/settings/appearance')` resolves to today (the route
 *     maps to the `settings` grant alone), so the two cannot disagree about
 *     who may reach the same page. The site link itself needs no grant, and
 *     neither does the customiser: it arranges the person's own sidebar.
 *
 * The URL comes from `bookingOriginFor`, never `https://${slug}.drive-247.com`:
 * that formula is right in production and wrong everywhere else, and it opened
 * a PRODUCTION tab from a local portal (see lib/booking-origin.ts). Until the
 * tenant row resolves there is no slug, so the row is plain identity — which
 * also keeps the server render and the first client render the same.
 *
 * ── SETTINGS IS NOT HERE ANY MORE ──────────────────────────────────────────
 * This row was once a dropdown (Organization settings, Billing & subscription,
 * Audit Logs), then — once the Sep 20 review emptied it — one link to
 * `/settings` with a gear inside. The gear moved down to the profile row in the
 * sidebar footer on Sep 21 (`SettingsLinkV2` in user-menu-v2.tsx, with the
 * manager gate this row used to carry).
 *
 * ── SETTINGS → BRANDING DRAWS THIS ROW ────────────────────────────────────
 * The Portal name preview is a picture of the expanded row (`SIDEBAR_ROW` in
 * components/settings/appearance/branding-previews.tsx): the same class
 * strings and the same slots, so it can say where a long name gets cut off.
 * branding-v2-lane.test.tsx holds the two together — change the row's slots
 * or their widths here, and the picture changes with them.
 */
export function OrgSwitcher({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Closes the phone sidebar sheet when a link here is followed. */
  onNavigate?: () => void;
}) {
  const { tenant } = useTenant();
  const { branding } = useTenantBranding();
  const { isManager, canView } = useManagerPermissions();
  const canOpenBranding = !isManager || canView("settings");

  const orgName = branding?.app_name || "Organization";
  const bookingUrl = tenant?.slug ? bookingOriginFor(tenant.slug) : null;
  // The link's text is only the tenant's name, which says nothing about where
  // it goes; the label says it, and that it leaves the portal.
  const siteLabel = `${orgName} booking site (opens in a new tab)`;

  const Logo = <OrgMark />;

  // No billing subtitle here by request — no trial countdown, no plan name.
  // Billing state still reaches the tenant where it has to: the payment-due
  // chip in the sidebar footer for dunning, and the subscription gate for an
  // expired plan.

  if (collapsed) {
    if (!bookingUrl) {
      return (
        <div
          data-slot="org-row"
          title={orgName}
          className="flex w-full items-center justify-center rounded-lg p-1.5"
        >
          {Logo}
        </div>
      );
    }
    return (
      <a
        data-slot="org-row"
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        aria-label={siteLabel}
        title="Open your booking site"
        className="flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
      >
        {Logo}
      </a>
    );
  }

  if (!bookingUrl) {
    return (
      <div data-slot="org-row" className="flex items-center rounded-lg">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left">
          {Logo}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
            {orgName}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="org-row"
      className="group/site flex items-center rounded-lg transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
    >
      {/* The mark and the name, hugging their content: no `flex-1` here or on
          the span, or the pencil after them would be pushed to the row's far
          edge, which is what this change undid. A long name truncates instead
          (`min-w-0` on both, so the flex item may shrink below its text). */}
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        aria-label={siteLabel}
        title="Open your booking site"
        className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left outline-none"
      >
        {Logo}
        <span className="min-w-0 truncate text-[13px] font-semibold leading-tight">
          {orgName}
        </span>
      </a>
      {canOpenBranding && (
        <Link
          href="/settings/appearance"
          onClick={onNavigate}
          aria-label="Edit your booking site's branding"
          title="Edit branding"
          className={cn(ROW_CONTROL, "opacity-0 focus-visible:opacity-100 group-hover/site:opacity-100")}
        >
          <Pencil className={ROW_CONTROL_ICON} aria-hidden />
        </Link>
      )}
      {/* The gap, as its own element rather than an auto margin on what follows:
          the pencil is conditional, so a margin would have to move between
          elements to survive a manager without the Settings grant. `flex-1`
          with a 0 basis takes every spare pixel and gives them all back the
          moment the name needs them. */}
      <span aria-hidden className="flex-1" />
      {/* Deliberately NOT `onNavigate`, unlike every link on this row: this
          opens a dialog over the phone sheet rather than navigating, and
          closing the sheet under it would leave the person facing the page
          they were on the moment they dismiss the dialog. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("open-sidebar-customizer"))}
        aria-label="Customise sidebar"
        title="Customise sidebar"
        className={ROW_CONTROL}
      >
        <SlidersHorizontal className={ROW_CONTROL_ICON} aria-hidden />
      </button>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        aria-label="Open your booking site (opens in a new tab)"
        title="Open your booking site"
        className={ROW_CONTROL}
      >
        <ExternalLink className={ROW_CONTROL_ICON} aria-hidden />
      </a>
    </div>
  );
}
