"use client";

import Link from "next/link";
import { ArrowLeft, List, Plus } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui-v2/sidebar";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { UserMenuV2 } from "@/components/shared/layout/user-menu-v2";
import { useTenant } from "@/contexts/TenantContext";
import { useTraxSupportOptional } from "@/components/trax/support/trax-support-context";
import { TicketList } from "../../../../../shared/trax-support/inbox-ui";
import { useSupportRail } from "../../../../../shared/trax-support/support-rail";
import { RetentionDialog } from "./retention-dialog";

/**
 * The Support rail — what the app sidebar BECOMES on `/support`, the same move it
 * makes for Trax, Settings and the record pages: a destination gets a scoped rail
 * in the sidebar's slot instead of a second column beside the navigation. Here the
 * rail is the ticket list, so the page is free to be the conversation and its
 * Details | TRAX Summary panel. Leaving Support brings the navigation back; nothing
 * about the sidebar changes on any other route.
 *
 * Anatomy follows the other rails: an h-16 back row, a title block (Support and
 * the tenant it is for), the always-visible New ticket action, the scrolling list,
 * and the account row in the footer.
 *
 * The inbox itself belongs to the page (portal-support.tsx), which lends it here;
 * the rail tells the page whether the list is on screen. A collapsed sidebar or a
 * phone's closed sheet is not, and the page then shows the list itself.
 */
export function SupportRail() {
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const inbox = useSupportRail(!isMobile && !collapsed);
  const { tenant } = useTenant();
  const managePolicy = !!useTraxSupportOptional()?.support?.capabilities?.managePolicy;

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const newTicket = () => {
    inbox?.beginNew();
    closeMobile();
  };
  const canStartNew = !!inbox && !inbox.busy && !inbox.creating;

  if (collapsed) {
    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        <SidebarHeader className="h-16">
          <div className="flex h-full w-full items-center px-2">
            <IconAction label="Back to portal" href="/"><ArrowLeft className="h-4 w-4" /></IconAction>
          </div>
        </SidebarHeader>
        <SidebarContent className="items-center gap-1 pt-2">
          <IconAction label="Show tickets" onClick={toggleSidebar}><List className="h-4 w-4" /></IconAction>
          <IconAction label="New ticket" onClick={newTicket} disabled={!canStartNew}><Plus className="h-4 w-4" /></IconAction>
        </SidebarContent>
        <SidebarFooter className="p-1.5">
          <div className="flex justify-center py-1"><UserMenuV2 /></div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      <SidebarHeader className="h-16">
        <div className="flex h-full w-full items-center px-2">
          <Link
            href="/"
            onClick={closeMobile}
            className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="text-[13px]">Back to portal</span>
          </Link>
        </div>
      </SidebarHeader>

      {/* Which account's support this is. */}
      <div className="flex items-start gap-2 px-4 pb-1 pt-1">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">Support</h1>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{tenant?.company_name || "Your company"}</p>
        </div>
        {managePolicy && <RetentionDialog compact />}
      </div>

      <div className="px-3 pb-3 pt-2">
        <Button size="sm" className="w-full gap-1.5" disabled={!canStartNew} onClick={newTicket}>
          <Plus className="size-4" aria-hidden />
          New ticket
        </Button>
      </div>

      {/* The list scrolls inside itself, so the content area must not scroll too. */}
      <SidebarContent className="gap-0 overflow-hidden">
        {inbox ? (
          <TicketList inbox={inbox} onChosen={closeMobile} />
        ) : (
          <div className="flex flex-col gap-2 px-3 pt-1" aria-busy="true" aria-label="Loading tickets">
            {[88, 72, 80].map((w) => (
              <Skeleton key={w} className="h-14 rounded-lg bg-muted/80" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenuV2 variant="row" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** An icon-only rail action, named by its tooltip and its aria-label. */
function IconAction({ label, href, onClick, disabled, children }: { label: string; href?: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  const className = "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} aria-label={label} className={className}>{children}</Link>
        ) : (
          <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={className}>{children}</button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
