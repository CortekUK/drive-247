'use client';

/**
 * The phone's "More" screen — the operator's (apps/portal components/shared/
 * layout/mobile-more-screen.tsx), for the customer, ditto (owner, Oct 23 2026):
 * its own full SCREEN under the tab bar, not a sheet. A large title, the
 * account at the top, then grouped cards of 52px rows, and Sign out last. The
 * tab bar stays on top with Account lit; any navigation closes it. Same Trax
 * motion: 200ms, fade plus a 12px lift, kept painted until it has left.
 *
 * It exists before it is full on purpose: more entries are coming (a portal /
 * website switch like the operator's), and the bar's tabs never scroll — the
 * tabs that do not fit the bar land here (`overflow`). New entries go in as a
 * <Section> of rows; nothing else needs to change.
 *
 * For now: Dark mode, Settings, Sign out.
 *
 * SETTINGS PLACEMENT IS PROVISIONAL (owner, Oct 23 2026): the Account tab used
 * to open Settings directly; the bar now ends in More, and Settings is a row
 * here with the gear, as on the operator's. Where Settings finally lives has to match the operator portal and
 * super admin — revisit when that is decided.
 *
 * Phone only (`md:hidden`); mounted by MobileTabBar.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ChevronRight, ExternalLink, LogOut, Moon, Settings } from 'lucide-react-nw';

import { Switch } from '@nw/components/ui/switch';
import { useCustomer } from '@nw/hooks/use-customer';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

import { isPortalV2Active, type PortalV2NavItem } from './nav';
import { usePortalTheme } from './theme';

const MOTION_IN =
  'visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out,visibility_0s]';
const MOTION_OUT =
  'invisible pointer-events-none translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms]';

const CARD = 'overflow-hidden rounded-2xl border border-pv-border bg-pv-card';
const ROW =
  'flex h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium transition-colors duration-200 active:bg-pv-primary/[0.06]';
/** Inset hairline between rows, starting under the label rather than the icon. */
const DIVIDED =
  '[&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:left-12 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-pv-border';

export function MobileMoreScreen({
  open,
  onClose,
  pathname,
  overflow,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string | null;
  /** Tabs that did not fit the bar. */
  overflow: PortalV2NavItem[];
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="More"
      aria-hidden={!open}
      data-mobile-more=""
      className={cn(
        'fixed inset-0 z-[39] flex flex-col bg-pv-bg md:hidden motion-reduce:transition-none',
        open ? MOTION_IN : MOTION_OUT,
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]">
        <div className="mx-auto flex max-w-lg flex-col gap-5 px-4">
          <h1 className="pt-4 font-heading text-[30px] font-medium leading-tight tracking-[-0.01em] text-pv-fg">More</h1>

          <AccountCard onNavigate={onClose} />

          {overflow.length > 0 ? (
            <Section>
              {overflow.map((item) => (
                <NavRow key={item.href} href={item.href} label={item.label} icon={item.icon} active={isPortalV2Active(item.href, pathname)} onNavigate={onClose} />
              ))}
            </Section>
          ) : null}

          <Section label="Account">
            <NavRow href="/portal/settings" label="Settings" icon={Settings} active={isPortalV2Active('/portal/settings', pathname)} onNavigate={onClose} />
          </Section>

          <PreferencesSection />

          <SignOutRow />
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {label ? <h2 className="px-4 text-[12px] font-medium uppercase tracking-[0.06em] text-pv-muted-fg">{label}</h2> : null}
      <div className={cn(CARD, DIVIDED)}>{children}</div>
    </section>
  );
}

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: PortalV2NavItem['icon'];
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(ROW, active ? 'text-pv-primary' : 'text-pv-fg')}
    >
      <Icon aria-hidden className={cn('size-5 shrink-0', active ? '' : 'text-pv-muted-fg')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-pv-muted-fg/60" />
    </Link>
  );
}

/** The business the customer rents from, and who is signed in — the operator's account card. */
function AccountCard({ onNavigate }: { onNavigate: () => void }) {
  const { displayName, email, initials, customer } = useCustomer();
  const { appName, faviconUrl } = useTenantBranding();
  const photo = customer?.profile_photo_url ?? null;
  const orgName = appName ?? 'Your rental company';
  const orgInitials =
    orgName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'A';

  return (
    <div className={cn(CARD, DIVIDED)}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {faviconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={faviconUrl} alt="" className="size-10 shrink-0 rounded-xl object-contain" />
        ) : (
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pv-primary text-[13px] font-semibold text-pv-primary-fg">
            {orgInitials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-medium text-pv-fg">{orgName}</div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${orgName} booking site (opens in a new tab)`}
            className="inline-flex items-center gap-1 text-[13px] text-pv-primary"
          >
            View booking site
            <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>
      </div>
      <Link href="/portal/settings" onClick={onNavigate} className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 active:bg-pv-primary/[0.06]">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-pv-primary/10 text-[12px] font-medium text-pv-primary">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="size-full object-cover" />
          ) : (
            initials ?? '·'
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-pv-fg">{displayName ?? 'Your account'}</div>
          {email ? <div className="truncate text-[12px] text-pv-muted-fg">{email}</div> : null}
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-pv-muted-fg/60" />
      </Link>
    </div>
  );
}

function PreferencesSection() {
  const portalTheme = usePortalTheme();
  if (!portalTheme) return null;
  const isDark = portalTheme.theme === 'dark';
  return (
    <Section label="Preferences">
      <label className={cn(ROW, 'text-pv-fg')}>
        <Moon aria-hidden className="size-5 shrink-0 text-pv-muted-fg" />
        <span className="min-w-0 flex-1">Dark mode</span>
        <Switch
          checked={isDark}
          onCheckedChange={(on) => portalTheme.setTheme(on ? 'dark' : 'light')}
          aria-label="Dark mode"
          className="data-[state=checked]:bg-pv-primary"
        />
      </label>
    </Section>
  );
}

function SignOutRow() {
  const router = useRouter();
  const { signOut } = useCustomer();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // As the desktop menu: home, not /login, and `replace` so Back does not land in the gate.
      router.replace('/');
    }
  }, [router, signOut]);

  return (
    <div className={CARD}>
      <button
        type="button"
        disabled={signingOut}
        onClick={() => void handleSignOut()}
        className={cn(ROW, 'justify-center text-pv-danger disabled:cursor-wait disabled:opacity-60')}
      >
        <LogOut aria-hidden className="size-5 shrink-0" />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
