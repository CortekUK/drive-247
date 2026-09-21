"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { getBrandInitials } from "@/components/shared/layout/brand-logo";
import { BRAND_MARK_FALLBACK_INITIALS } from "@/lib/appearance/logo";
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
 * Top-of-sidebar organization row — the current tenant, and the way into
 * Settings.
 *
 * ── IT IS A LINK NOW, NOT A MENU (Sep 20 2026) ────────────────────────────
 * This used to be a dropdown holding three items: Organization settings,
 * Billing & subscription, and Audit Logs. Clicking the row — in either the
 * expanded pill or the collapsed rail — opened that menu. The request was:
 * clicking Settings opens Settings DIRECTLY, in both places; Organization
 * settings and Subscription come out of the menu because both already have
 * their own tab; and Audit Logs moves into Settings.
 *
 * With all three items gone the menu had nothing left in it, so the menu went
 * too, and the row became what its only remaining job says it is: a link to
 * `/settings`. That is the whole of items 5, 6 and 7 of that review, and it is
 * why there is no `DropdownMenu` in this file any more.
 *
 * Where the three went:
 *   - Organization settings → this row IS it.
 *   - Billing & subscription → the "Billing" row in the sidebar's top group
 *     (`app-sidebar-v2.tsx`), which already carried `/subscription` and
 *     `/credits`. Nothing became unreachable, and the rule that every role can
 *     reach a payment link is unaffected: that row is ungated too.
 *   - Audit Logs → the Settings index, under Business
 *     (`components/settings-v2/settings-index.tsx`), where it keeps the same
 *     `audit_logs` manager grant it had here.
 *
 * ── PERMISSION PARITY ─────────────────────────────────────────────────────
 * v1 gates its footer Settings row on `(!isManager || canView('settings'))`.
 * That gate is carried across verbatim below, and a manager without the grant
 * gets the identity row with no link rather than a link to a page that would
 * refuse them — the same answer the menu gave by simply not listing the item.
 */
export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { branding } = useTenantBranding();
  const { isManager, canView } = useManagerPermissions();

  const orgName = branding?.app_name || "Organization";

  // v1's footer Settings gate, carried across verbatim.
  const canSeeSettings = !isManager || canView("settings");
  // Team management is not here: it is the Team entry on the Settings index
  // (head admins only, like v1's `headAdminOnly` Manage Users).

  const Logo = <OrgMark />;

  // No billing subtitle here by request — no trial countdown, no plan name.
  // Billing state still reaches the tenant where it has to: the payment-due
  // chip in the sidebar footer for dunning, and the subscription gate for an
  // expired plan. This row is identity, not billing.

  const HOVER =
    "transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]";

  // Collapsed rail: the mark IS the link. It used to be the menu's trigger,
  // for a reason that no longer applies — a Radix trigger with `display:none`
  // has no box to anchor to, so the menu opened pinned to the viewport corner.
  // A link has no such problem, and the destination is the same one the
  // expanded row goes to.
  if (collapsed) {
    if (!canSeeSettings) {
      return (
        <div
          title={orgName}
          className="flex w-full items-center justify-center rounded-lg p-1.5"
        >
          {Logo}
        </div>
      );
    }
    return (
      <Link
        href="/settings"
        aria-label="Settings"
        title={`${orgName} — Settings`}
        className={cn(
          "flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none",
          HOVER
        )}
      >
        {Logo}
      </Link>
    );
  }

  if (!canSeeSettings) {
    return (
      <div className="flex items-center rounded-lg">
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
    // One control, one destination. The gear stays as the affordance that says
    // where the row goes — but it is drawn INSIDE the link now rather than
    // being a sibling of a menu trigger, because there is no longer a second
    // thing for the row to do, and a button nested in a link is invalid markup
    // exactly as a button nested in a button was.
    <Link
      href="/settings"
      title="Settings"
      className={cn(
        "group/org flex cursor-pointer items-center rounded-lg outline-none",
        HOVER
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left">
        {Logo}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
          {orgName}
        </span>
      </span>
      <span
        aria-hidden
        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover/org:text-primary dark:group-hover/org:text-[hsl(var(--v2-link,var(--primary)))]"
      >
        <Settings className="h-4 w-4" />
      </span>
    </Link>
  );
}
