'use client';

/**
 * /admin/customer-management — the scheduled operator emails.
 *
 * Its own route for the same reason /admin/notifications has one: this
 * dashboard is organised one page per subject, and `app/admin/(protected)/
 * settings/page.tsx` is a short list of platform switches behind ONE
 * `handleSave` writing ONE `admin_settings` row. Three automations, their
 * timelines, their templates and their send log do not belong inside that
 * list, and their writes go to three different tables.
 *
 * The protected layout handles auth and confines a sales-agent account to
 * /admin/sales. The page renders read-only for anyone who is not a super
 * admin, and the tables' RLS re-checks that server side — a read-only UI is a
 * courtesy, not the control.
 */

import { CustomerManagementPage } from '@/components/admin/customer-management/customer-management-page';

export default function AdminCustomerManagementRoute() {
  return <CustomerManagementPage />;
}
