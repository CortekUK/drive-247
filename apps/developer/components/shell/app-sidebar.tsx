'use client';

/**
 * The developer hub's sidebar: the super-admin dashboard's
 * (apps/admin/components/admin/Sidebar.tsx) cut down to what the hub has.
 *
 *   org row (mark · "Drive247 / Developer")
 *   the tabs (one for now: Onboarding)
 *   footer: the profile row and its account menu (Dark Mode, Sign Out)
 *
 * Same primitive, same row classes, and it collapses to a 48px icon rail on
 * ⌘B or the hairline at its edge, as the admin rail does.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsUpDown, LogOut, Moon, Rocket, Sun, type LucideIcon } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useThemeMode } from '@/lib/theme';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

/** The hub's tabs. Add a row here to add a tab. */
export const DEVELOPER_TABS: { name: string; href: string; icon: LucideIcon }[] = [
  { name: 'Onboarding', href: '/onboarding', icon: Rocket },
];

/** The admin rail's NAV_ROW: 44px rows in the phone sheet, 32px from `md`. */
const NAV_ROW =
  'h-11 md:h-8 [&>svg]:size-[18px] md:[&>svg]:size-4 font-medium transition-colors ' +
  'data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.12),0_1px_2px_hsl(var(--primary)_/_0.08)]';

function labelClass(collapsed: boolean, extra = 'truncate') {
  return `text-[15px] md:text-[13px] ${collapsed ? 'sr-only opacity-0 w-0' : `${extra} opacity-100`}`;
}

function OrgMark() {
  return (
    <img
      src="/icons/icon-192.png"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className="h-8 w-8 shrink-0 rounded-lg object-contain"
    />
  );
}

function OrgRow({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Link
        href="/onboarding"
        title="Drive247 Developer"
        className="flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-colors hover:bg-primary/10"
      >
        <OrgMark />
      </Link>
    );
  }
  return (
    <Link
      href="/onboarding"
      className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-primary/10"
    >
      <OrgMark />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight">Drive247</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">Developer</span>
      </span>
    </Link>
  );
}

function initialsOf(name: string | null | undefined, email: string | undefined) {
  return (name || email || 'D')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function UserRow({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isDark, setDark } = useThemeMode();
  if (!user) return null;

  const initials = initialsOf(user.name, user.email);
  const avatar = (
    <Avatar className="h-8 w-8 shrink-0 overflow-hidden rounded-full">
      <AvatarImage src={user.avatar_url || undefined} alt={user.name || 'Admin'} className="object-cover" />
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials}</AvatarFallback>
    </Avatar>
  );

  const menu = (
    <DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} sideOffset={8} className="w-64 overflow-hidden rounded-xl p-0">
      <div className="p-2.5 pb-2">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9 overflow-hidden rounded-full ring-2 ring-border/50">
            <AvatarImage src={user.avatar_url || undefined} alt={user.name || 'Admin'} className="object-cover" />
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight">{user.name || 'Admin'}</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground/70">{user.email}</div>
          </div>
        </div>
      </div>

      <DropdownMenuSeparator className="m-0" />

      <div className="p-1.5">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setDark(!isDark);
          }}
          className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
        >
          {isDark ? <Sun className="mr-2.5 h-4 w-4 text-muted-foreground" /> : <Moon className="mr-2.5 h-4 w-4 text-muted-foreground" />}
          <span>Dark Mode</span>
          <Switch checked={isDark} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto" />
        </DropdownMenuItem>
      </div>

      <DropdownMenuSeparator className="m-0" />

      <div className="p-1.5">
        <DropdownMenuItem
          onClick={() => void logout()}
          className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="mr-2.5 h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open account menu"
              className="flex cursor-pointer items-center justify-center rounded-4xl p-1 outline-none transition-colors hover:bg-primary/10"
            >
              {avatar}
            </button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <div className={cn('flex w-full items-center rounded-lg transition-colors hover:bg-primary/10', menuOpen && 'bg-primary/10')}>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none">
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight">{user.name || 'Admin'}</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
      </div>
      {menu}
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const collapsed = state === 'collapsed' && !isMobile;
  const closeMobileOnNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarRoot collapsible="icon" className="transition-all duration-300 ease-in-out">
      <SidebarHeader className="p-1.5 pt-4">
        <OrgRow collapsed={collapsed} />
      </SidebarHeader>

      <SidebarContent className="gap-0 pt-1 transition-all duration-300 ease-in-out">
        <SidebarGroup className="p-1.5 pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {DEVELOPER_TABS.map((tab) => {
                const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                const Icon = tab.icon;
                return (
                  <SidebarMenuItem key={tab.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={collapsed ? tab.name : undefined} className={NAV_ROW}>
                      <Link href={tab.href} onClick={closeMobileOnNav} aria-current={active ? 'page' : undefined}>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className={labelClass(collapsed, 'min-w-0 flex-1 truncate')}>{tab.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserRow collapsed={collapsed} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
}
