'use client';

/**
 * /admin/notifications — the platform's own notification set.
 *
 * WHY A ROUTE OF ITS OWN, AND NOT A SECTION OF /admin/settings.
 *
 * This dashboard is organised one page per subject, each with its own nav
 * entry: Announcements, Welcome Pack, Legal Pages, Onboarding Questions, Setup
 * Checklist, Audit Logs. `app/admin/(protected)/settings/page.tsx` is not a
 * tabbed shell like the operator portal's settings page — it is a short list of
 * platform switches (notification recipients, the maintenance banner, the
 * subscription gate, the grace period, the contact form) behind ONE
 * `handleSave` that writes one `admin_settings` row.
 *
 * Twenty notifications, sixty-odd templates, three previews and a Send test do
 * not belong inside that list, and their save is a different one: it writes
 * `platform_notification_settings` with its own dirty guard and its own
 * storage-off state. Two save buttons on one page, each writing a different
 * table and each able to fail on its own, is the kind of thing an operator
 * discovers by losing work.
 *
 * So: its own route, its own nav entry, next to Settings in Configuration —
 * and the portal's own equivalent stays where IT belongs, inside that app's
 * multi-tab settings shell.
 *
 * The protected layout already handles auth and confines a sales-agent account
 * to /admin/sales; the page itself renders read-only for anyone who is not a
 * super admin, and the table's RLS and notification-test-v2 both re-check that
 * server side.
 */

import { SystemNotificationsPage } from '@/components/admin/notifications-v2/system-notifications-page';

export default function AdminNotificationsRoute() {
  return <SystemNotificationsPage />;
}
