'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSidebar } from '@/components/admin/SidebarContext';
import { TicketList } from '../../../../shared/trax-support/inbox-ui';
import { useSupportRail } from '../../../../shared/trax-support/support-rail';

/**
 * The platform Support rail: on `/admin/support` it takes the navigation
 * sidebar's slot, as the portal's Support rail does for tenants, so the page is
 * tickets | conversation | details rather than four columns. The navigation comes
 * back on every other admin route.
 *
 * The inbox belongs to the page (SupportInbox), which lends it here; this rail
 * only renders the list and says whether it is on screen. On a phone it is not
 * mounted (the navigation stays a sheet behind the header's menu button) and the
 * page shows the list itself.
 */
export function AdminSupportRail() {
  const { isMobile } = useSidebar();
  const { user } = useAuthStore();
  const inbox = useSupportRail(!isMobile);
  if (isMobile) return null;

  const who = user?.name || user?.email || 'Support';
  return (
    <aside aria-label="Support" className="flex h-screen w-[304px] shrink-0 flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3">
        <Link href="/admin/dashboard" className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to dashboard
        </Link>
      </div>
      <div className="shrink-0 px-4 pb-3 pt-3">
        <h1 className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">Support</h1>
        <p className="mt-0.5 text-[11px] text-sidebar-muted">Tenant conversations across every company</p>
      </div>
      {inbox ? (
        <TicketList inbox={inbox} admin />
      ) : (
        <p className="px-4 py-6 text-[12px] leading-relaxed text-muted-foreground">Tickets appear here once your support access is confirmed.</p>
      )}
      <div className="flex shrink-0 items-center gap-3 border-t border-sidebar-border px-4 py-3">
        <div aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
          {(user?.email?.[0] ?? 'S').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-sidebar-foreground">{who}</p>
          <p className="text-[10px] text-sidebar-muted">{user?.is_super_admin ? 'Super Admin' : 'Support'}</p>
        </div>
      </div>
    </aside>
  );
}
