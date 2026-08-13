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
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useAuth } from "@/stores/auth-store";

// Top-of-sidebar organization switcher — mirrors the user footer row, but
// represents the current tenant/workspace.
export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { branding } = useTenantBranding();
  const { appUser } = useAuth();
  const { isSubscribed, isTrialing, hasExpiredSubscription, trialDaysRemaining, subscription } =
    useTenantSubscription();

  const orgName = branding?.app_name || "Organization";
  const orgInitials =
    orgName
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "O";

  const planName = subscription?.plan_name
    ? subscription.plan_name.charAt(0).toUpperCase() + subscription.plan_name.slice(1)
    : null;
  const subtitle = isTrialing
    ? `Trial · ${trialDaysRemaining}d left`
    : isSubscribed
    ? planName || "Premium"
    : hasExpiredSubscription
    ? "Expired"
    : "Free plan";

  const Logo = (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-[12px] font-semibold text-primary-foreground">
      {orgInitials}
    </div>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none cursor-pointer transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {Logo}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">{orgName}</span>
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={6} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 p-2 font-normal">
          {Logo}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{orgName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
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
        <DropdownMenuItem asChild>
          <Link href="/audit-logs">
            <History className="mr-2 h-4 w-4 text-muted-foreground" />
            Audit Logs
          </Link>
        </DropdownMenuItem>
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
  );
}
