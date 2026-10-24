'use client';

/**
 * Super Admin's phone navigation, drawn as Northwind's (apps/portal/src/
 * components/shared/layout/mobile-tab-bar.tsx and mobile-more-screen.tsx):
 *
 *   MobileTabBar     — a flat, native bottom tab bar: the first four pages of
 *                      the rail, then "More". Solid page colour, one hairline
 *                      on top, padded for the home indicator.
 *   MobileMoreScreen — "More" opens a full-screen page under the bar rather
 *                      than the desktop rail sliding in from the left: a large
 *                      title, the account card, the Admin | Retention switch,
 *                      every other page as grouped 52px rows, Preferences, and
 *                      Sign out.
 *   PhoneSectionChips — a page's own sections (useRegisterSidebarSections),
 *                      which a desktop shows in the rail, as a row of chips
 *                      that scrolls sideways under the top bar.
 *
 * Phone only (`md:hidden`). The rows are not computed here: they are the
 * same `useAdminNav()` the sidebar draws, so this can never offer a page the
 * rail would not.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ChevronRight, Ellipsis, LayoutGrid, LifeBuoy, LogOut, Moon, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useThemeMode } from '@/lib/theme';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ProfileDialog } from '@/components/admin/profile-dialog';
import { SidebarCustomizerDialog } from '@/components/admin/sidebar-customizer-dialog';
import { useSidebarSections } from '@/components/admin/sidebar-sections';
import { RETENTION_ROOT, isNavActive, useAdminNav, viewOf, type AdminNavItem } from '@/components/admin/admin-nav';

// ─── Open state ─────────────────────────────────────────────────────────────

const MoreContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MoreContext.Provider value={{ open, setOpen }}>{children}</MoreContext.Provider>;
}

function useMore() {
  const ctx = useContext(MoreContext);
  if (!ctx) throw new Error('useMore must be used within MobileNavProvider');
  return ctx;
}

// ─── Tab bar ────────────────────────────────────────────────────────────────

/** Short labels for the bar; the rail's names are too long for a fifth of a phone. */
const SHORT: Record<string, { label: string; icon?: LucideIcon }> = {
  '/admin/dashboard': { label: 'Home', icon: LayoutGrid },
  '/admin/rentals': { label: 'Companies', icon: Building2 },
  '/admin/onboarding-questions': { label: 'Questions' },
  '/admin/contacts': { label: 'Contacts' },
  '/admin/blacklist': { label: 'Blacklist' },
  '/admin/signup-plans': { label: 'Plans' },
  '/admin/promo-codes': { label: 'Promos' },
  '/admin/announcements': { label: 'Updates' },
  '/admin/sales': { label: 'Onboarding' },
};

/** The four pages the bar carries: the head of the rail as this user arranged it. */
function useTabs(): AdminNavItem[] {
  const nav = useAdminNav();
  return nav.topLevel.filter((i) => !i.newTab).slice(0, 4);
}

/**
 * Marked by colour and weight alone — the icon goes bold and takes the accent,
 * the label follows. No background shape behind it, as in Northwind.
 */
const ITEM =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[5px] text-[11.5px] leading-none font-medium tracking-[0.01em] transition-[color,transform] duration-200 ease-out active:scale-[0.94] motion-reduce:transition-none';
const ACTIVE_TEXT = 'font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]';
const IDLE_TEXT = 'text-muted-foreground';

export function MobileTabBar() {
  const pathname = usePathname();
  const { open, setOpen } = useMore();
  const tabs = useTabs();

  const anyTabActive = tabs.some((t) => isNavActive(pathname, t.href));
  const moreLit = open || !anyTabActive;

  return (
    <>
      <MobileMoreScreen />
      <div
        data-mobile-tab-bar=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      >
        <nav aria-label="Main" className="mx-auto flex h-[60px] max-w-lg items-stretch px-1">
          {tabs.map((tab) => {
            const short = SHORT[tab.href];
            const Icon = short?.icon ?? tab.icon;
            const active = !open && isNavActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                // A tab whose page is already open does not change the route,
                // so the More screen's route-change close would never fire.
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(ITEM, active ? ACTIVE_TEXT : IDLE_TEXT)}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 1.75} aria-hidden />
                <span className="max-w-full truncate px-0.5">{short?.label ?? tab.name}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label="More"
            aria-expanded={open}
            className={cn(ITEM, moreLit ? ACTIVE_TEXT : IDLE_TEXT)}
          >
            <Ellipsis className="size-5" strokeWidth={moreLit ? 2.4 : 1.75} aria-hidden />
            More
          </button>
        </nav>
      </div>
    </>
  );
}

// ─── More screen ────────────────────────────────────────────────────────────

const MOTION_IN =
  'visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out,visibility_0s]';
const MOTION_OUT =
  'invisible pointer-events-none translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms]';

const CARD = 'overflow-hidden rounded-2xl border border-border bg-card';
const ROW =
  'flex h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium transition-colors duration-200 active:bg-primary/[0.06]';
/** Inset hairline between rows, starting under the label rather than the icon. */
const DIVIDED =
  '[&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:left-12 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-border';

function MobileMoreScreen() {
  const { open, setOpen } = useMore();
  const pathname = usePathname();

  // Any navigation closes it — a row tap, a tab tap, a link elsewhere.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="More"
      aria-hidden={!open}
      data-mobile-more=""
      className={cn(
        'fixed inset-0 z-[39] flex flex-col bg-background md:hidden motion-reduce:transition-none',
        open ? MOTION_IN : MOTION_OUT,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
        <div className="mx-auto flex max-w-lg flex-col gap-5 px-4">
          <h1 className="pt-4 text-[30px] font-medium leading-tight tracking-[-0.01em] text-foreground">More</h1>
          <MoreBody />
        </div>
      </div>
    </div>
  );
}

function MoreBody() {
  const { setOpen } = useMore();
  const nav = useAdminNav();
  const tabs = useTabs();
  const pathname = usePathname();
  const router = useRouter();
  const registration = useSidebarSections();
  const close = () => setOpen(false);

  const canRetention = nav.all.some((i) => i.href === RETENTION_ROOT);
  const view = canRetention ? viewOf(pathname) : 'admin';
  const onTabs = new Set(tabs.map((t) => t.href));
  const rest = nav.topLevel.filter((i) => !onTabs.has(i.href) && !i.newTab);
  const actions = registration?.actions ?? [];

  return (
    <>
      <AccountCard onNavigate={close} />

      {canRetention && (
        <div className="grid grid-cols-2 rounded-full border border-border bg-card p-1" role="tablist">
          {([
            { key: 'admin', label: 'Admin', href: '/admin/dashboard' },
            { key: 'retention', label: 'Retention', href: RETENTION_ROOT },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => {
                close();
                if (view !== tab.key) router.push(tab.href);
              }}
              className={cn(
                'h-10 rounded-full text-[14px] font-medium transition-colors duration-200',
                view === tab.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* What the open record lets you do — suspend, delete, reset password…
          On a desktop these are in the account menu at the foot of the rail. */}
      {actions.length > 0 && (
        <Section label={registration?.title ?? 'This page'}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                close();
                registration?.onAction?.(action.id);
              }}
              className={cn(ROW, 'pl-12', action.tone === 'destructive' ? 'text-destructive' : 'text-foreground')}
            >
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {action.tone === 'active' && <span className="text-[13px] text-primary">On</span>}
            </button>
          ))}
        </Section>
      )}

      {rest.length > 0 && (
        <Section>
          {rest.map((item) => (
            <NavRow key={item.href} item={item} active={isNavActive(pathname, item.href)} onNavigate={close} />
          ))}
        </Section>
      )}

      {nav.more.length > 0 && (
        <Section label="More">
          {nav.more.map((item) => (
            <NavRow key={item.href} item={item} active={isNavActive(pathname, item.href)} onNavigate={close} />
          ))}
        </Section>
      )}

      {nav.groups.map((group) => (
        <Section key={group.label} label={group.label}>
          {group.items.map((item) => (
            <NavRow key={item.href} item={item} active={isNavActive(pathname, item.href)} onNavigate={close} />
          ))}
        </Section>
      ))}

      {(nav.settings || nav.support) && (
        <Section label="Account">
          {nav.support && (
            <NavRow
              item={{ ...nav.support, icon: LifeBuoy }}
              active={isNavActive(pathname, nav.support.href)}
              onNavigate={close}
            />
          )}
          {nav.settings && (
            <NavRow item={nav.settings} active={isNavActive(pathname, nav.settings.href)} onNavigate={close} />
          )}
        </Section>
      )}

      <PreferencesSection />
      <SignOutRow />
    </>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {label && <h2 className="truncate px-4 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</h2>}
      <div className={cn(CARD, DIVIDED)}>{children}</div>
    </section>
  );
}

function NavRow({ item, active, onNavigate }: { item: AdminNavItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon;
  const badge = item.badge ?? 0;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      target={item.newTab ? '_blank' : undefined}
      rel={item.newTab ? 'noopener noreferrer' : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(ROW, active ? 'text-primary' : 'text-foreground')}
    >
      <Icon className={cn('size-5 shrink-0', active ? '' : 'text-muted-foreground')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {(badge > 0 || item.badgeUnavailable) && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
          {item.badgeUnavailable ? '?' : badge > 99 ? '99+' : badge}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}

/** Who is signed in, and where. */
function AccountCard({ onNavigate }: { onNavigate: () => void }) {
  const { user } = useAuthStore();
  const nav = useAdminNav();
  const [profileOpen, setProfileOpen] = useState(false);
  if (!user) return null;

  const initials = (user.name || user.email || 'A')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <div className={cn(CARD, DIVIDED)}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <img src="/icons/icon-192.png" alt="" aria-hidden width={40} height={40} className="size-10 shrink-0 rounded-xl object-contain" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-medium text-foreground">Drive247</div>
            <div className="truncate text-[13px] text-muted-foreground">{nav.salesOnly ? 'Sales' : 'Super Admin'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onNavigate();
            setProfileOpen(true);
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-200 active:bg-primary/[0.06]"
        >
          <Avatar className="size-8 shrink-0 overflow-hidden rounded-full">
            <AvatarImage src={user.avatar_url || undefined} alt={user.name || 'Admin'} className="object-cover" />
            <AvatarFallback className="bg-primary/10 text-[12px] font-medium text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium text-foreground">{user.name || 'Admin'}</div>
            <div className="truncate text-[12px] text-muted-foreground">{user.email}</div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
        </button>
      </div>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

function PreferencesSection() {
  const { isDark, setDark } = useThemeMode();
  const nav = useAdminNav();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  return (
    <>
      <Section label="Preferences">
        <label className={cn(ROW, 'text-foreground')}>
          <Moon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">Dark mode</span>
          <Switch checked={isDark} onCheckedChange={setDark} aria-label="Dark mode" />
        </label>
        {/* The rail's "Customise sidebar" lives on the org row, which a phone
            never shows — and its order is also what fills the tab bar. */}
        {!nav.salesOnly && (
          <button type="button" onClick={() => setCustomizeOpen(true)} className={cn(ROW, 'text-foreground')}>
            <SlidersHorizontal className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">Customise navigation</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
          </button>
        )}
      </Section>
      {!nav.salesOnly && <SidebarCustomizerDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />}
    </>
  );
}

function SignOutRow() {
  const { logout } = useAuthStore();
  return (
    <div className={CARD}>
      <button type="button" onClick={() => void logout()} className={cn(ROW, 'justify-center text-destructive')}>
        <LogOut className="size-5 shrink-0" aria-hidden />
        Sign out
      </button>
    </div>
  );
}

// ─── A page's sections, on a phone ──────────────────────────────────────────

/**
 * A page's own sections — the rail's job on a desktop — as chips that scroll
 * sideways, the way Northwind's dashboard lays out a row too wide for a phone.
 * The open one is filled; tapping one scrolls it into view.
 */
export function PhoneSectionChips() {
  const registration = useSidebarSections();
  const sections = registration?.sections ?? [];
  const active = registration?.active;

  useEffect(() => {
    if (!active) return;
    document
      .querySelector<HTMLElement>(`[data-phone-section="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  if (sections.length === 0) return null;

  return (
    <div className="shrink-0 md:hidden">
      <div
        role="tablist"
        aria-label={registration?.title ?? 'Sections'}
        className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => {
          const on = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-phone-section={section.id}
              onClick={() => registration?.onSelect(section.id)}
              className={cn(
                'h-8 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground active:bg-primary/[0.06]',
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
