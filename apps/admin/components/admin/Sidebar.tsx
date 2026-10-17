'use client';

/**
 * Super Admin's sidebar, drawn the way Northwind draws the portal's
 * (`apps/portal/src/components/shared/layout/app-sidebar-v2.tsx`): the same
 * primitive, the same row classes, the same layout from top to bottom —
 *
 *   org row (mark · name · open-the-site arrow)
 *   quick rows, a rule, the fingertip rows
 *   "More": flat rows, then every section open under its own caption
 *   footer: the profile row, with Settings and the account menu at its end
 *
 * and it collapses to a 48px icon rail on ⌘B or the hairline at its edge.
 *
 * Under the org row, Northwind's sliding pill switches the rail between its
 * two sides — Admin and Retention (Northwind: Portal | Website). Retention is
 * Customer Management, and its rail is that page's own sections. The side is
 * read from the URL (`viewOf`), never stored, so a reload or a shared link
 * always shows the side the page belongs to. ⌥1 / ⌥2 switch it. (It was
 * Admin | DevKit until Oct 17 2026; the DevKit pages are in Settings now.)
 *
 * A page that registers sections (`useRegisterSidebarSections`) takes the
 * whole rail, as a Northwind record does: a way back at the top, the record's
 * name, then its sections.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronsUpDown, ExternalLink, LayoutGrid, LogOut, MailCheck, Moon, SlidersHorizontal, Sun, User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSidebarSections } from '@/components/admin/sidebar-sections';
import { DevSection } from '@/components/admin/dev-section';
import { ProfileDialog } from '@/components/admin/profile-dialog';
import { SidebarCustomizerDialog } from '@/components/admin/sidebar-customizer-dialog';
import { Switch } from '@/components/ui/switch';
import { useThemeMode } from '@/lib/theme';
import {
  RETENTION_ROOT,
  isNavActive,
  useAdminNav,
  viewOf,
  type AdminNavItem,
  type AdminView,
} from '@/components/admin/admin-nav';

/** Northwind's NAV_ROW: 44px rows and a 15px label in the phone sheet, the rail's own 32px/13px from `md`. */
const NAV_ROW =
  'h-11 md:h-8 [&>svg]:size-[18px] md:[&>svg]:size-4 font-medium transition-colors ' +
  'data-[active=true]:shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.12),0_1px_2px_hsl(var(--primary)_/_0.08)]';
const NAV_ROW_WIDE = NAV_ROW + ' w-full';

/** Label that folds away when the rail collapses to icons. */
function labelClass(collapsed: boolean, extra = 'truncate') {
  return `text-[15px] md:text-[13px] ${collapsed ? 'sr-only opacity-0 w-0' : `${extra} opacity-100`}`;
}

/** 28px square trailing control — the org row's arrow, the profile row's gear and caret. */
const ROW_CONTROL =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary';

const MARKETING_SITE = 'https://drive-247.com';

// ─── Org row ────────────────────────────────────────────────────────────────

/** The Drive247 mark — the same file the dashboard installs as its app icon. */
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

function OrgRow({ collapsed, salesOnly }: { collapsed: boolean; salesOnly: boolean }) {
  const label = salesOnly ? 'Sales' : 'Super Admin';
  const [customizeOpen, setCustomizeOpen] = useState(false);

  if (collapsed) {
    return (
      <Link
        data-slot="org-row"
        href={salesOnly ? '/admin/sales' : '/admin/dashboard'}
        title="Drive247"
        className="flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-colors hover:bg-primary/10"
      >
        <OrgMark />
      </Link>
    );
  }

  return (
    <>
    <div data-slot="org-row" className="group/site flex items-center rounded-lg transition-colors hover:bg-primary/10">
      <Link
        href={salesOnly ? '/admin/sales' : '/admin/dashboard'}
        className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left outline-none"
      >
        <OrgMark />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight">Drive247</span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">{label}</span>
        </span>
      </Link>
      <span aria-hidden className="flex-1" />
      {/* Customise sidebar — where Northwind's org row carries it. */}
      {!salesOnly && (
        <button
          type="button"
          onClick={() => setCustomizeOpen(true)}
          aria-label="Customise sidebar"
          title="Customise sidebar"
          className={ROW_CONTROL}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      <a
        href={MARKETING_SITE}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open drive-247.com (opens in a new tab)"
        title="Open drive-247.com"
        className={ROW_CONTROL}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
    {!salesOnly && <SidebarCustomizerDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />}
    </>
  );
}

// ─── Profile row ────────────────────────────────────────────────────────────

function initialsOf(name: string | undefined, email: string | undefined) {
  return (name || email || 'A')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function UserRow({
  collapsed,
  settings,
  onNavigate,
}: {
  collapsed: boolean;
  settings: AdminNavItem | null;
  onNavigate: () => void;
}) {
  const { user, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { isDark, setDark } = useThemeMode();
  // A record page (e.g. a rental company) offers its own actions here —
  // suspend, delete, reset password… They have no other home on the page.
  const registration = useSidebarSections();
  const actions = registration?.actions ?? [];
  if (!user) return null;

  const initials = initialsOf(user.name, user.email);

  const avatar = (
    <Avatar className="h-8 w-8 shrink-0 overflow-hidden rounded-full">
      <AvatarImage src={user.avatar_url || undefined} alt={user.name || 'Admin'} className="object-cover" />
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials}</AvatarFallback>
    </Avatar>
  );

  /* Northwind's account menu (apps/portal/src/components/shared/layout/
     user-menu-v2.tsx), item for item: the person, then Profile · Dark Mode,
     then Sign Out. Its Feedback and Replay tour are left out on purpose. A
     record page's own actions (suspend, delete…) sit in the middle group,
     where those two were. */
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
        <DropdownMenuItem onClick={() => setProfileOpen(true)} className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]">
          <User className="mr-2.5 h-4 w-4 text-muted-foreground" />
          <span>Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setDark(!isDark);
          }}
          className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]"
        >
          {isDark ? (
            <Sun className="mr-2.5 h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="mr-2.5 h-4 w-4 text-muted-foreground" />
          )}
          <span>Dark Mode</span>
          <Switch checked={isDark} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto" />
        </DropdownMenuItem>
      </div>

      {actions.length > 0 && (
        <>
          <DropdownMenuSeparator className="m-0" />
          <div className="p-1.5">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onClick={() => registration?.onAction?.(action.id)}
                className={cn(
                  'cursor-pointer rounded-lg px-2.5 py-1.5 text-[13px]',
                  action.tone === 'destructive' && 'text-destructive focus:bg-destructive/10 focus:text-destructive',
                )}
              >
                <span className="flex-1">{action.label}</span>
                {action.tone === 'active' && <Check className="ml-2 h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </div>
        </>
      )}

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

  const profile = <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        {settings && (
          <Link
            href={settings.href}
            onClick={onNavigate}
            aria-label="Settings"
            title="Settings"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <settings.icon className="h-4 w-4" />
          </Link>
        )}
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
        {profile}
      </div>
    );
  }

  return (
    <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/* Hover and open states on the CONTAINER, so the highlight covers the
          gear and the caret too — Northwind's profile row. */}
      <div
        className={cn(
          'flex w-full items-center rounded-lg transition-colors hover:bg-primary/10',
          menuOpen && 'bg-primary/10',
        )}
      >
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none">
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight">{user.name || 'Admin'}</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">{user.email}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        {settings && (
          <Link
            href={settings.href}
            onClick={onNavigate}
            aria-label="Settings"
            title="Settings"
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <settings.icon className="h-4 w-4" />
          </Link>
        )}
        {/* A sibling of the trigger, driving the same menu through `open`.
            stopPropagation keeps the dismissable layer from reading it as an
            outside click and closing the menu a beat before it reopens. */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Open account menu"
          className="shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground outline-none transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </button>
      </div>
      {menu}
    </DropdownMenu>
    {profile}
    </>
  );
}

// ─── Nav rows ───────────────────────────────────────────────────────────────

function Badge({ item, collapsed }: { item: AdminNavItem; collapsed: boolean }) {
  const count = item.badge ?? 0;
  if (count <= 0 && !item.badgeUnavailable) return null;
  const text = item.badgeUnavailable ? '?' : collapsed ? (count > 9 ? '9+' : String(count)) : count > 99 ? '99+' : String(count);
  const title = item.badgeUnavailable ? 'Unread count unavailable. Reconnecting…' : undefined;

  if (collapsed) {
    return (
      <span
        aria-hidden
        title={title}
        className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold leading-none tabular-nums text-destructive-foreground animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none"
      >
        {text}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      title={title}
      className="ml-auto inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-destructive-foreground animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none"
    >
      {text}
    </span>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const count = item.badge ?? 0;
  return (
    <SidebarMenuItem className="relative">
      <SidebarMenuButton asChild isActive={active} tooltip={collapsed ? item.name : undefined} className={NAV_ROW}>
        <Link
          href={item.href}
          onClick={onNavigate}
          {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          aria-label={count > 0 ? `${item.name}, ${count} unread` : undefined}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className={labelClass(collapsed, 'min-w-0 flex-1 truncate')}>{item.name}</span>
          <Badge item={item} collapsed={collapsed} />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ─── Section rail (a page's own sections) ───────────────────────────────────

function SectionRail({
  collapsed,
  onShowNav,
  onNavigate,
}: {
  collapsed: boolean;
  onShowNav: () => void;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const nav = useAdminNav();
  const registration = useSidebarSections();
  if (!registration) return null;

  const owner = nav.all.find((i) => i.href === registration.href);
  const title = registration.title ?? owner?.name ?? 'Sections';
  /* A record below its list goes back to the list ("All rental companies"),
     as Northwind's "All customers" does. A top-level page like Promo Codes has
     no list above it, so "back" there means the navigation again. */
  const isRecord = !!pathname && pathname !== registration.href;
  const backLabel = isRecord && owner ? `All ${owner.name.toLowerCase()}` : 'Main menu';

  const backInner = (
    <>
      <ArrowLeft className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="text-[15px] md:text-[13px]">{backLabel}</span>}
    </>
  );
  const backClass = collapsed
    ? 'flex h-8 w-full cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary/10 hover:text-primary'
    : 'flex h-8 cursor-pointer items-center gap-2 rounded-xl px-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary';

  const back = isRecord ? (
    <Link href={registration.href} onClick={onNavigate} className={backClass} aria-label={backLabel}>
      {backInner}
    </Link>
  ) : (
    <button type="button" onClick={onShowNav} className={backClass} aria-label={backLabel}>
      {backInner}
    </button>
  );

  return (
    <>
      <SidebarHeader className="h-16">
        <div className="flex h-full w-full items-center px-2 transition-all duration-300 ease-in-out">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{back}</TooltipTrigger>
              <TooltipContent side="right">{backLabel}</TooltipContent>
            </Tooltip>
          ) : (
            back
          )}
        </div>
      </SidebarHeader>

      {!collapsed && (
        <div className="px-4 pb-1 pt-4">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {owner && isRecord && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{owner.name}</p>}
        </div>
      )}

      <SidebarContent className="gap-0 transition-all duration-300 ease-in-out">
        <SidebarGroup className={collapsed ? 'p-1.5' : 'p-1.5 pb-0'}>
          <SidebarGroupContent>
            <SidebarMenu>
              {registration.sections.map((section) => {
                const current = section.id === registration.active;
                return (
                  <SidebarMenuItem key={section.id}>
                    <SidebarMenuButton
                      isActive={current}
                      aria-current={current ? 'page' : undefined}
                      tooltip={collapsed ? section.label : undefined}
                      onClick={() => {
                        registration.onSelect(section.id);
                        onNavigate();
                      }}
                      className="h-11 font-medium transition-all duration-200 ease-in-out md:h-8"
                    >
                      {collapsed ? (
                        <span className="text-[11px] font-semibold">{section.label.slice(0, 2)}</span>
                      ) : (
                        <span className="text-[15px] md:text-[13px]">{section.label}</span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}

// ─── Admin | Retention switch ───────────────────────────────────────────────

const VIEWS = [
  { key: 'admin', label: 'Admin', kbd: '⌥1' },
  { key: 'retention', label: 'Retention', kbd: '⌥2' },
] as const;

/** Northwind's Portal | Website pill, verbatim in its classes. */
function ViewSwitch({ view, onSwitch }: { view: AdminView; onSwitch: (v: AdminView) => void }) {
  return (
    <div className="px-1.5 pb-1 pt-0.5">
      <div className="relative grid grid-cols-2 rounded-full p-1">
        {/* Sliding active pill */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-background shadow-sm ring-1 ring-primary/20 transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: view === 'retention' ? 'translateX(100%)' : 'translateX(0)' }}
        />
        {VIEWS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSwitch(tab.key)}
            aria-pressed={view === tab.key}
            className={cn(
              'relative z-10 flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-colors md:h-auto md:justify-between md:px-2.5 md:py-1 md:text-[12px]',
              view === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{tab.label}</span>
            <kbd
              className={cn(
                'hidden rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors md:inline-block',
                view === tab.key ? 'bg-primary/15 text-primary' : 'bg-foreground/10 text-foreground/70',
              )}
            >
              {tab.kbd}
            </kbd>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── The sidebar ────────────────────────────────────────────────────────────

/** `desktop={false}`: the phone sheet only — Support's rail has the desktop slot. */
export default function Sidebar({ desktop = true }: { desktop?: boolean } = {}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const nav = useAdminNav();
  const sections = useSidebarSections();

  /* In the phone sheet the rail is never collapsed, whatever the desktop
     state says. */
  const collapsed = state === 'collapsed' && !isMobile;
  const closeMobileOnNav = () => {
    if (isMobile) setOpenMobile(false);
  };

  const [showNav, setShowNav] = useState(false);

  const router = useRouter();
  // Customer Management is super admin only, so its side is too.
  const canRetention = nav.all.some((i) => i.href === RETENTION_ROOT);
  const view: AdminView = canRetention ? viewOf(pathname) : 'admin';

  /* Switching side always lands on that side's first page, as Northwind's
     does — a rail describing one side over a page from the other reads as
     broken. */
  const switchView = useCallback(
    (next: AdminView) => {
      if (next === 'retention' && !canRetention) return;
      if (isMobile) setOpenMobile(false);
      router.push(next === 'retention' ? RETENTION_ROOT : '/admin/dashboard');
    },
    [router, canRetention, isMobile, setOpenMobile],
  );

  // ⌥1 / ⌥2, as in Northwind (Alt avoids the browser's own Cmd/Ctrl+number).
  useEffect(() => {
    if (!canRetention) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Digit1') {
        e.preventDefault();
        switchView('admin');
      } else if (e.code === 'Digit2') {
        e.preventDefault();
        switchView('retention');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRetention, switchView]);

  /* Leaving a page takes its sections with it, and a drill-in section opened
     on one page should not still be open over the next. */
  useEffect(() => {
    setShowNav(false);
  }, [pathname]);

  const isActive = (href: string) => isNavActive(pathname, href);

  if (!desktop && !isMobile) return null;

  if (sections && !showNav && view !== 'retention') {
    return (
      <SidebarRoot collapsible="icon" className="transition-all duration-300 ease-in-out">
        <SectionRail collapsed={collapsed} onShowNav={() => setShowNav(true)} onNavigate={closeMobileOnNav} />
        <SidebarFooter className="p-1.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <UserRow collapsed={collapsed} settings={nav.settings} onNavigate={closeMobileOnNav} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </SidebarRoot>
    );
  }

  const hasMore = nav.more.length > 0;

  return (
    <SidebarRoot collapsible="icon" className="transition-all duration-300 ease-in-out">
      <SidebarHeader className="p-1.5 pt-4">
        <OrgRow collapsed={collapsed} salesOnly={nav.salesOnly} />
      </SidebarHeader>

      <SidebarContent className="gap-0 pt-1 transition-all duration-300 ease-in-out">
        {canRetention && !collapsed && <ViewSwitch view={view} onSwitch={switchView} />}

        {/* Collapsed rail: one button that flips to the other side. */}
        {canRetention && collapsed && (
          <SidebarGroup className="p-1.5 pb-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => switchView(view === 'retention' ? 'admin' : 'retention')}
                    isActive={view === 'retention'}
                    tooltip={view === 'retention' ? 'Back to Admin' : 'Retention'}
                    className={NAV_ROW}
                  >
                    {view === 'retention' ? <LayoutGrid className="h-4 w-4 shrink-0" /> : <MailCheck className="h-4 w-4 shrink-0" />}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {view === 'retention' ? (
          /* Customer Management's own sections, registered by the page —
             nothing from the Admin side, as Northwind's Website side shows
             only the site. */
          <SidebarGroup className="p-1.5 pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {(sections?.sections ?? []).map((section) => {
                  const current = section.id === sections?.active;
                  return (
                    <SidebarMenuItem key={section.id}>
                      <SidebarMenuButton
                        isActive={current}
                        aria-current={current ? 'page' : undefined}
                        tooltip={collapsed ? section.label : undefined}
                        onClick={() => {
                          sections?.onSelect(section.id);
                          closeMobileOnNav();
                        }}
                        className="h-11 font-medium transition-all duration-200 ease-in-out md:h-8"
                      >
                        {collapsed ? (
                          <span className="text-[11px] font-semibold">{section.label.slice(0, 2)}</span>
                        ) : (
                          <span className="truncate text-[15px] md:text-[13px]">{section.label}</span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
        <>
        {nav.quick.length > 0 && (
          <>
            <SidebarGroup className="p-1.5 pb-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav.quick.map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                      collapsed={collapsed}
                      onNavigate={closeMobileOnNav}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <div className="mx-3 my-1.5 h-px bg-sidebar-border/60" />
          </>
        )}

        <>
            <SidebarGroup className="p-1.5 pb-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav.topLevel.map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                      collapsed={collapsed}
                      onNavigate={closeMobileOnNav}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {hasMore && (
              <SidebarGroup className="p-1.5 pb-2 pt-1">
                {!collapsed && (
                  <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    More
                  </p>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {nav.more.map((item) => (
                      <NavRow
                        key={item.href}
                        item={item}
                        active={isActive(item.href)}
                        collapsed={collapsed}
                        onNavigate={closeMobileOnNav}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {/* Every section open, one caption each — no drill-in, no arrows
                (Ghulam, Oct 7 2026: every page reachable in one click). */}
            {nav.groups.map((group) => (
              <SidebarGroup key={group.label} className="p-1.5 pb-2 pt-1">
                {!collapsed && (
                  <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {group.label}
                  </p>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <NavRow
                        key={item.href}
                        item={item}
                        active={isActive(item.href)}
                        collapsed={collapsed}
                        onNavigate={closeMobileOnNav}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
        </>
        </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-1.5">
        {!collapsed && <DevSection onNavigate={closeMobileOnNav} />}
        <SidebarMenu>
          <SidebarMenuItem>
            <UserRow collapsed={collapsed} settings={nav.settings} onNavigate={closeMobileOnNav} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
}
