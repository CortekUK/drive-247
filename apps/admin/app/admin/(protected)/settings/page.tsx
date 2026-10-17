'use client';

import { Suspense, type ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AdminSettingsIndex,
  ADMIN_SETTINGS_TABS,
  type AdminSettingsTab,
} from '@/components/admin/settings/settings-index';
import {
  BookingSiteSettingsPage,
  ContactFormSettingsPage,
  LandingSettingsPage,
  NotificationsSettingsPage,
  SessionsSettingsPage,
  SignupSettingsPage,
  SubscriptionSettingsPage,
} from '@/components/admin/settings/settings-pages';

/**
 * `/admin/settings` — the portal's v2 (northwind) settings, for the platform.
 * No `?tab=` (or one this build doesn't know) shows the index; a known `?tab=`
 * opens that page. Settings in the nav is the way back.
 */
const PAGES: Record<AdminSettingsTab, ComponentType> = {
  subscription: SubscriptionSettingsPage,
  'contact-form': ContactFormSettingsPage,
  landing: LandingSettingsPage,
  'booking-site': BookingSiteSettingsPage,
  signup: SignupSettingsPage,
  notifications: NotificationsSettingsPage,
  sessions: SessionsSettingsPage,
};

function SettingsRouter() {
  const tab = useSearchParams().get('tab');
  const Page = tab && (ADMIN_SETTINGS_TABS as string[]).includes(tab) ? PAGES[tab as AdminSettingsTab] : null;
  // Keyed so moving between pages starts each from the saved row, not a
  // draft left behind on the last one.
  return Page ? <Page key={tab} /> : <AdminSettingsIndex />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsRouter />
    </Suspense>
  );
}
