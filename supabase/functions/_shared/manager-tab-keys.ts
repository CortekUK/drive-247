/**
 * Every tab a manager can be granted.
 *
 * The portal's picker (apps/portal/src/lib/permissions.ts: TAB_GROUPS,
 * SETTINGS_SUB_TABS, plus the 'settings' parent) and the three user-management
 * functions (admin-create-user, admin-update-role, update-manager-permissions)
 * must agree, or a manager who is given a newer tab is rejected with
 * "Invalid tab keys", which the portal showed as a save that "just spins"
 * (Luxurious Car Rentals, Nov 2026: ten tabs had been added to the picker since
 * Feb 2026 and none to the functions). The portal test
 * src/__tests__/lib/manager-tab-keys.test.ts fails when the two lists drift.
 *
 * Keys the picker no longer offers stay here so rows saved earlier keep validating.
 */
export const ALLOWED_TAB_KEYS: readonly string[] = [
  // Fleet & Bookings
  'vehicles', 'rentals', 'pending_bookings', 'availability', 'vehicle_owners', 'owner_payouts',
  // Customers
  'customers', 'blocked_customers', 'enquiries', 'messages',
  // Pipeline
  'leads', 'automations',
  // Finance
  'payments', 'invoices', 'fines', 'expenses',
  // Insights
  'insurances', 'agreements', 'reminders', 'reports', 'pl_dashboard',
  // Administration
  'cms', 'audit_logs',
  // Settings and its sub-tabs
  'settings',
  'settings.general', 'settings.locations', 'settings.branding', 'settings.rental',
  'settings.pricing', 'settings.extras', 'settings.payments', 'settings.reminders',
  'settings.templates', 'settings.integrations', 'settings.accounting', 'settings.subscription',
  // No longer in the picker; kept for rows saved before it was removed
  'documents',
];
