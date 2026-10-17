'use client';

/**
 * Settings index — the landing page for `/admin/settings`.
 *
 * The same page as the portal's v2 (northwind) settings index
 * (apps/portal/src/components/settings-v2/settings-index.tsx): a few named
 * sections, each a grid of entries with a title and one line saying what is
 * behind it, laid out like Stripe's settings page. An entry opens a settings
 * page at `?tab=`, or — for subjects that already had a page of their own
 * (Legal pages, Onboarding questions, Setup checklist, Notifications, Audit logs, Team, OpenAI usage) — that page,
 * which is off the sidebar now that Settings lists it.
 *
 * Every description is 95–120 characters and wraps to two or three lines in
 * its 320px column.
 */

import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { SETTINGS_COLUMN, SETTINGS_PAGE_TITLE, SETTINGS_SECTION_TITLE } from './settings-kit';

export type AdminSettingsTab =
  | 'subscription'
  | 'contact-form'
  | 'landing'
  | 'booking-site'
  | 'signup'
  | 'notifications'
  | 'sessions';

interface SettingsIndexItem {
  title: string;
  description: string;
  /** Opens `/admin/settings?tab=…`, a settings page of its own. */
  tab?: AdminSettingsTab;
  /** Opens an existing admin page instead (as northwind's Team opens /users). */
  href?: string;
  /** Listed for the primary super admin only (Manage Admins refuses anyone else). */
  primaryOnly?: boolean;
  /** Listed for super admins only (the Developer pages send anyone else away). */
  superOnly?: boolean;
  /** Extra words ⌘K search matches on, beyond the title and description. */
  keywords?: string;
}

interface SettingsIndexSection {
  title: string;
  items: SettingsIndexItem[];
}

export const ADMIN_SETTINGS_SECTIONS: SettingsIndexSection[] = [
  {
    title: 'Platform',
    items: [
      {
        title: 'Subscription access',
        description:
          'Whether lapsed tenants see the blocking dialog, and how long they keep access after a subscription payment fails.',
        tab: 'subscription',
        keywords: 'payment grace period blocker blocking dialog lapsed expired past due',
      },
      {
        title: 'Contact form',
        description:
          'Turn the drive-247.com contact form on or off, and choose who is emailed whenever somebody sends a message.',
        tab: 'contact-form',
        keywords: 'notification emails recipients enquiries',
      },
      {
        title: 'OpenAI usage',
        description:
          'What the platform spends on OpenAI: tokens and cost per feature and per tenant, and where it is going.',
        href: '/admin/openai-usage',
      },
    ],
  },
  {
    title: 'Website',
    items: [
      {
        title: 'Landing page',
        description:
          'Which drive-247.com landing page is live, and whether it shows pricing and with it the self-serve signup.',
        tab: 'landing',
        keywords: 'landing version v1 v2 pricing self-serve signup',
      },
      {
        title: 'Northwind booking site',
        description:
          'Which booking site and customer portal Northwind’s customers see: the current one or the redesign.',
        tab: 'booking-site',
        keywords: 'northwind site version v1 v2 customer portal canary',
      },
      {
        title: 'Legal pages',
        description:
          'Write and publish the platform Terms of Service and Privacy Policy that drive-247.com serves to everyone.',
        href: '/admin/legal',
      },
    ],
  },
  {
    title: 'Signup',
    items: [
      {
        title: 'Email verification',
        description:
          'Whether a new signup must enter a 6-digit emailed code before the company details and the payment step.',
        tab: 'signup',
        keywords: 'otp code verify email signup',
      },
      {
        title: 'Onboarding questions',
        description:
          'The questions every new operator answers the first time they open the portal. One set, asked of everyone.',
        href: '/admin/onboarding-questions',
      },
      {
        title: 'Setup checklist',
        description:
          'The features an operator has to sit down with once, shown on their dashboard until each one is done.',
        href: '/admin/setup-checklist',
      },
    ],
  },
  {
    title: 'Notifications',
    items: [
      {
        title: 'Notifications',
        description:
          'Every email, SMS, push and in-app message the platform sends: what each says, when it goes, and to whom.',
        href: '/admin/notifications',
      },
      {
        title: 'Mobile notifications',
        description:
          'Get a push on your phone when something happens on any tenant, even while this dashboard is closed.',
        tab: 'notifications',
        keywords: 'push phone mobile alerts devices',
      },
    ],
  },
  {
    title: 'Security',
    items: [
      {
        title: 'Sessions',
        description:
          'Sign every portal user and booking customer out of every tenant at once. Super admins stay signed in.',
        tab: 'sessions',
        keywords: 'force logout sign out everyone',
      },
      {
        title: 'Audit logs',
        description:
          'Every meaningful action taken across every tenant and this dashboard: who did it, when, and on what.',
        href: '/admin/audit-logs',
      },
      {
        title: 'Team',
        description:
          'Who can sign in to this dashboard, what role each person has, and their passwords. Primary admin only.',
        href: '/admin/admins',
        primaryOnly: true,
      },
    ],
  },
];

export const ADMIN_SETTINGS_TABS = ADMIN_SETTINGS_SECTIONS.flatMap((s) =>
  s.items.flatMap((i) => (i.tab ? [i.tab] : [])),
);

const itemHref = (item: SettingsIndexItem) => item.href ?? `/admin/settings?tab=${item.tab}`;

export function AdminSettingsIndex() {
  const { user } = useAuthStore();
  const isPrimary = !!user?.is_primary_super_admin;
  const isSuper = !!user?.is_super_admin;
  const sections = ADMIN_SETTINGS_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => (!item.primaryOnly || isPrimary) && (!item.superOnly || isSuper),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className={cn(SETTINGS_COLUMN, 'md:pt-2')}>
      <h1 className={SETTINGS_PAGE_TITLE}>Settings</h1>

      {sections.map((section) => (
        <section key={section.title} aria-labelledby={`settings-${section.title}`}>
          <h2 id={`settings-${section.title}`} className={SETTINGS_SECTION_TITLE}>
            {section.title}
          </h2>
          <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <Link
                key={itemHref(item)}
                href={itemHref(item)}
                /* The tint IS the hover affordance — the whole card is the
                   target. Keyboard users get the ring. */
                className="group -mx-3 block rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-muted"
              >
                <span className="text-[15px] font-medium text-primary">{item.title}</span>
                <span className="mt-1 block max-w-[320px] text-[13px] leading-[1.45] text-muted-foreground">
                  {item.description}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
