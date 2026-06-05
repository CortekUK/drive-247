/**
 * Manager Permission Constants
 *
 * Single source of truth for all tab keys, labels, groups, and route mappings
 * used by the manager role's granular permission system.
 */

export interface TabDefinition {
  key: string;
  label: string;
  group: string;
  /** When true, this tab has no mutation actions — only viewer access is available */
  viewOnly?: boolean;
}

export interface TabGroup {
  label: string;
  tabs: TabDefinition[];
}

// All assignable tab keys
export const TAB_KEYS = [
  'vehicles',
  'rentals',
  'pending_bookings',
  'availability',
  'vehicle_owners',
  'owner_payouts',
  'customers',
  'blocked_customers',
  'enquiries',
  'leads',
  'automations',
  'revenue_optimiser',
  'messages',
  'payments',
  'invoices',
  'fines',
  'expenses',
  'insurances',
  'agreements',
  'reminders',
  'reports',
  'pl_dashboard',
  'cms',
  'audit_logs',
  'settings',
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

// Settings sub-tab keys (only relevant when 'settings' parent is granted)
export const SETTINGS_SUB_TAB_KEYS = [
  'settings.general',
  'settings.locations',
  'settings.branding',
  'settings.rental',
  'settings.pricing',
  'settings.extras',
  'settings.payments',
  'settings.reminders',
  'settings.templates',
  'settings.integrations',
  'settings.subscription',
] as const;

export type SettingsSubTabKey = (typeof SETTINGS_SUB_TAB_KEYS)[number];

export type AllTabKey = TabKey | SettingsSubTabKey;

// Grouped tab definitions for the permissions selector UI
export const TAB_GROUPS: TabGroup[] = [
  {
    label: 'Fleet & Bookings',
    tabs: [
      { key: 'vehicles', label: 'Vehicles', group: 'Fleet & Bookings' },
      { key: 'rentals', label: 'Rentals', group: 'Fleet & Bookings' },
      { key: 'pending_bookings', label: 'Pending Bookings', group: 'Fleet & Bookings' },
      { key: 'availability', label: 'Availability', group: 'Fleet & Bookings' },
      { key: 'vehicle_owners', label: 'Vehicle Owners', group: 'Fleet & Bookings' },
      { key: 'owner_payouts', label: 'Owner Payouts', group: 'Fleet & Bookings' },
    ],
  },
  {
    label: 'Customers',
    tabs: [
      { key: 'customers', label: 'Customers', group: 'Customers' },
      { key: 'blocked_customers', label: 'Blocked Customers', group: 'Customers' },
      { key: 'enquiries', label: 'Enquiries', group: 'Customers' },
      { key: 'messages', label: 'Messages', group: 'Customers' },
    ],
  },
  {
    label: 'Pipeline',
    tabs: [
      { key: 'leads', label: 'Leads', group: 'Pipeline' },
      { key: 'automations', label: 'Automations', group: 'Pipeline' },
    ],
  },
  {
    label: 'Revenue',
    tabs: [
      { key: 'revenue_optimiser', label: 'Revenue Optimiser', group: 'Revenue' },
    ],
  },
  {
    label: 'Finance',
    tabs: [
      { key: 'payments', label: 'Payments', group: 'Finance' },
      { key: 'invoices', label: 'Invoices', group: 'Finance' },
      { key: 'fines', label: 'Fines', group: 'Finance' },
      { key: 'expenses', label: 'Expenses', group: 'Finance' },
    ],
  },
  {
    label: 'Insights',
    tabs: [
      { key: 'insurances', label: 'Insurances', group: 'Insights', viewOnly: true },
      { key: 'agreements', label: 'Agreements', group: 'Insights', viewOnly: true },
      { key: 'reminders', label: 'Reminders', group: 'Insights' },
      { key: 'reports', label: 'Reports', group: 'Insights', viewOnly: true },
      { key: 'pl_dashboard', label: 'P&L Dashboard', group: 'Insights', viewOnly: true },
    ],
  },
  {
    label: 'Administration',
    tabs: [
      { key: 'cms', label: 'Website Content', group: 'Administration' },
      { key: 'audit_logs', label: 'Audit Logs', group: 'Administration', viewOnly: true },
    ],
  },
];

// Settings sub-tabs for the permissions selector
export const SETTINGS_SUB_TABS: TabDefinition[] = [
  { key: 'settings.general', label: 'General', group: 'Settings' },
  { key: 'settings.locations', label: 'Locations', group: 'Settings' },
  { key: 'settings.branding', label: 'Branding', group: 'Settings' },
  { key: 'settings.rental', label: 'Bookings', group: 'Settings' },
  { key: 'settings.pricing', label: 'Dynamic Pricing', group: 'Settings' },
  { key: 'settings.extras', label: 'Extras', group: 'Settings' },
  { key: 'settings.payments', label: 'Payments', group: 'Settings' },
  { key: 'settings.reminders', label: 'Notifications', group: 'Settings' },
  { key: 'settings.templates', label: 'Templates', group: 'Settings' },
  { key: 'settings.integrations', label: 'Integrations', group: 'Settings' },
  { key: 'settings.subscription', label: 'Subscription', group: 'Settings' },
];

// Route → Tab key mapping (used by sidebar filtering and route protection)
export const ROUTE_TO_TAB: Record<string, string> = {
  '/vehicles': 'vehicles',
  '/rentals': 'rentals',
  '/pending-bookings': 'pending_bookings',
  '/blocked-dates': 'availability',
  '/vehicle-owners': 'vehicle_owners',
  '/owner-payouts': 'owner_payouts',
  '/customers': 'customers',
  '/blocked-customers': 'blocked_customers',
  '/enquiries': 'enquiries',
  '/leads': 'leads',
  '/automations': 'automations',
  '/revenue': 'revenue_optimiser',
  '/revenue/outcomes': 'revenue_optimiser',
  '/revenue/settings': 'revenue_optimiser',
  '/revenue/rules': 'revenue_optimiser',
  '/revenue/autopilot/setup': 'revenue_optimiser',
  '/messages': 'messages',
  '/payments': 'payments',
  '/invoices': 'invoices',
  '/fines': 'fines',
  '/expenses': 'expenses',
  '/insurances': 'insurances',
  '/agreements': 'agreements',
  '/reminders': 'reminders',
  '/reports': 'reports',
  '/pl-dashboard': 'pl_dashboard',
  '/cms': 'cms',
  '/audit-logs': 'audit_logs',
  '/settings': 'settings',
};

/**
 * Given a pathname, return the tab key it maps to.
 * Handles sub-routes like /rentals/new, /customers/[id], etc.
 */
export function getTabKeyForRoute(pathname: string): string | null {
  // Exact match first
  if (ROUTE_TO_TAB[pathname]) return ROUTE_TO_TAB[pathname];

  // Check prefix matches for nested routes
  for (const [route, tabKey] of Object.entries(ROUTE_TO_TAB)) {
    if (pathname.startsWith(route + '/')) return tabKey;
  }

  return null;
}

// Dashboard widget → required tab key mapping
export const WIDGET_TAB_REQUIREMENTS: Record<string, string | null> = {
  ActionItems: 'payments',
  CalendarWidget: 'rentals',
  FleetOverview: 'vehicles',
  BonzahBalanceWidget: 'payments',
  AIInsightsPanel: 'rentals',
  RecentActivity: null, // always shown
  SetupHub: null, // always shown
  GoLiveBanner: null, // always shown
};

// Settings tab value → settings sub-tab key mapping
// New granular tabs map back to existing DB permission keys (no migration needed)
export const SETTINGS_VALUE_TO_KEY: Record<string, string> = {
  // Business
  general: 'settings.general',
  locations: 'settings.locations',
  branding: 'settings.branding',
  // Booking Rules (all map to settings.rental)
  rental: 'settings.rental',
  requirements: 'settings.rental',
  duration: 'settings.rental',
  lockbox: 'settings.rental',
  // Pricing & Money
  pricing: 'settings.pricing',
  fees: 'settings.rental',
  preauth: 'settings.rental',
  installments: 'settings.rental',
  payg: 'settings.rental',
  'auto-extend': 'settings.rental',
  promos: 'settings.rental',
  extras: 'settings.extras',
  payments: 'settings.payments',
  // Communication
  reminders: 'settings.reminders',
  templates: 'settings.templates',
  // Integrations (all map to settings.integrations)
  integrations: 'settings.integrations',
  messaging: 'settings.integrations',
  insurance: 'settings.integrations',
  esign: 'settings.integrations',
  tesla: 'settings.integrations',
  blacklist: 'settings.integrations',
  // Account
  subscription: 'settings.subscription',
};
