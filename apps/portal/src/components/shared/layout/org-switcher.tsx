"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ChevronsUpDown, Settings, CreditCard, History, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useAuth } from "@/stores/auth-store";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { getBrandInitials } from "@/components/shared/layout/brand-logo";
import { cn } from "@/lib/utils";

/**
 * Square tenant mark for the avatar-sized slot at the top of the v2 sidebar.
 *
 * Deliberately local rather than exported from `brand-logo.tsx`: that file is a
 * v1 file, and v2 does not edit v1 files (V2_PLAN §3). It shares `BrandLogo`'s
 * source rule — `dark_logo_url` wins in dark mode, and a tenant with no logo
 * gets a chip of their own initials, never the platform's brand.
 */
function OrgMark({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const { branding, brandName } = useTenantBranding();

  const logoUrl =
    resolvedTheme === "dark" && branding?.dark_logo_url
      ? branding.dark_logo_url
      : branding?.logo_url;

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={brandName}
        className={cn("h-8 w-8 shrink-0 rounded-md bg-muted object-contain p-0.5", className)}
      />
    );
  }

  return (
    <div
      title={brandName}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-[12px] font-semibold text-primary-foreground",
        className
      )}
    >
      {getBrandInitials(brandName) || "O"}
    </div>
  );
}

/**
 * Top-of-sidebar organization switcher — mirrors the user footer row, but
 * represents the current tenant/workspace.
 *
 * Permission parity with the v1 sidebar is load-bearing here. v1 gates its
 * footer Settings row on `(!isManager || canView('settings'))` and its
 * Administration group on `ROUTE_TO_TAB` + `headAdminOnly`. Those links moved
 * into this menu, so every one of those gates is repeated below — otherwise a
 * restricted manager would reach, from the org menu, exactly what the nav
 * filter hides from them.
 */
export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  // Controlled so the *container* can carry the open state. The pill has to
  // wrap the gear as well as the trigger, and a `data-[state=open]` class only
  // reaches the trigger itself.
  const [open, setOpen] = useState(false);
  const { branding } = useTenantBranding();
  const { appUser } = useAuth();
  const { isManager, canView } = useManagerPermissions();

  const orgName = branding?.app_name || "Organization";

  // v1's footer Settings gate, carried across verbatim.
  const canSeeSettings = !isManager || canView("settings");
  // v1's Administration group runs every item through ROUTE_TO_TAB; `/audit-logs`
  // maps to the `audit_logs` tab.
  const canSeeAuditLogs = !isManager || canView("audit_logs");
  // v1 marks Manage Users `headAdminOnly`, and `canAccessRoute` refuses `/users`
  // to every manager regardless of grants.
  const canSeeUsers = appUser?.role === "head_admin";

  const Logo = <OrgMark />;

  // No billing subtitle here by request — no trial countdown, no plan name.
  // Billing state still reaches the tenant where it has to: the payment-due
  // chip in the sidebar footer for dunning, and the subscription gate for an
  // expired plan. This row is identity, not billing.

  const menu = (
    <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="w-64">
      <DropdownMenuLabel className="flex items-center gap-2.5 p-2 font-normal">
        {Logo}
        <p className="min-w-0 truncate text-[13px] font-semibold">{orgName}</p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {canSeeSettings && (
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            Organization settings
          </Link>
        </DropdownMenuItem>
      )}
      {/* Ungated on purpose: `canAccessRoute` returns true for `/subscription`
          for every role, so a tenant can always reach a payment link. */}
      <DropdownMenuItem asChild>
        <Link href="/subscription">
          <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" />
          Billing &amp; subscription
        </Link>
      </DropdownMenuItem>
      {(canSeeAuditLogs || canSeeUsers) && <DropdownMenuSeparator />}
      {canSeeAuditLogs && (
        <DropdownMenuItem asChild>
          <Link href="/audit-logs">
            <History className="mr-2 h-4 w-4 text-muted-foreground" />
            Audit Logs
          </Link>
        </DropdownMenuItem>
      )}
      {canSeeUsers && (
        <DropdownMenuItem asChild>
          <Link href="/users">
            <Users className="mr-2 h-4 w-4 text-muted-foreground" />
            Manage Users
          </Link>
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );

  // Collapsed rail: the mark IS the trigger. The expanded layout hides its
  // caret button at this width, and a Radix trigger with `display:none` has no
  // box to anchor to — the menu would open pinned to the viewport corner and
  // Settings / Billing / Audit Logs would be unreachable from the rail.
  if (collapsed) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Organization menu"
            title={orgName}
            className="flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-colors hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
          >
            {Logo}
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }

  return (
    // The pill lives on this container, not on the trigger, so the gear sits
    // inside it rather than stranded alongside. Hover and open are neutral:
    // they were `bg-sidebar-accent`, which the theme hook drives from the
    // tenant's accent colour, so on a warm brand this went solid orange.
    <div
      className={cn(
        "flex items-center rounded-lg transition-colors hover:bg-foreground/5",
        open && "bg-foreground/5"
      )}
    >
      {/* Logo and name open the menu as well, but as a plain button rather than
          a second Radix trigger — a menu can only have one. The controlled
          `open` state makes that trivial, and it is what lets the caret sit
          after the gear instead of being trapped at the trigger's edge. */}
      <button
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left outline-none"
      >
        {Logo}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
          {orgName}
        </span>
      </button>

      {/* Settings, rehomed from the v1 sidebar footer. Inside the pill but a
          sibling of the trigger, never a child of it — a button nested in a
          button is invalid markup and the trigger would swallow the click. */}
      {canSeeSettings && (
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Switch organization"
            className="mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <ChevronsUpDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    </div>
  );
}
