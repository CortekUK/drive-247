"use client";

import Link from "next/link";
import { ChevronsUpDown, Settings, CreditCard, History, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { useAuth } from "@/stores/auth-store";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { BrandMark } from "@/components/shared/layout/brand-logo";

// Top-of-sidebar organization switcher — mirrors the user footer row, but
// represents the current tenant/workspace.
export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { branding } = useTenantBranding();
  const { appUser } = useAuth();
  // Audit Logs is a manager-gated tab in the sidebar's own filter. These links
  // sit outside that filter, so the gate has to be repeated here or a manager
  // without the permission would see an entry main hides from them.
  const { isManager, canView } = useManagerPermissions();

  const orgName = branding?.app_name || "Organization";

  // No billing subtitle here by request — no trial countdown, no plan name.
  // Billing state still reaches the tenant where it has to: the payment-due
  // chip in the sidebar footer for dunning, and the subscription gate for an
  // expired plan. This row is identity, not billing.

  const Logo = <BrandMark />;

  return (
    <div className={`flex items-center gap-1 ${collapsed ? "justify-center" : ""}`}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Hover and open states are neutral. They were `bg-sidebar-accent`,
            which the theme hook drives from the tenant's accent colour, so on a
            warm brand this row went solid orange as soon as the menu opened. */}
        <button
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left outline-none cursor-pointer transition-colors hover:bg-foreground/5 data-[state=open]:bg-foreground/5 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {Logo}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">
                {orgName}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={6} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 p-2 font-normal">
          {Logo}
          <p className="min-w-0 truncate text-[13px] font-semibold">{orgName}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            Organization settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/subscription">
            <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" />
            Billing &amp; subscription
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(!isManager || canView("audit_logs")) && (
          <DropdownMenuItem asChild>
            <Link href="/audit-logs">
              <History className="mr-2 h-4 w-4 text-muted-foreground" />
              Audit Logs
            </Link>
          </DropdownMenuItem>
        )}
        {appUser?.role === "head_admin" && (
          <DropdownMenuItem asChild>
            <Link href="/users">
              <Users className="mr-2 h-4 w-4 text-muted-foreground" />
              Manage Users
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
      {/* Settings, rehomed from the user menu. It sits beside the trigger
          rather than inside it — a button nested in a button is invalid markup
          and the outer trigger would swallow the click. Hidden when collapsed,
          where the rail has no room for a second target. */}
      {!collapsed && (
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
