// Generated from apps/portal/src/lib/permissions.ts; checked by scripts/trax-knowledge.mjs.
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
];
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
    'settings.accounting',
    'settings.subscription',
];
export const TAB_GROUPS = [
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
            { key: 'enquiries', label: 'Inquiries', group: 'Customers' },
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
export const SETTINGS_SUB_TABS = [
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
    { key: 'settings.accounting', label: 'Accounting', group: 'Settings' },
    { key: 'settings.subscription', label: 'Subscription', group: 'Settings' },
];
export const ROUTE_TO_TAB = {
    '/vehicles': 'vehicles',
    '/fleet-health': 'vehicles',
    '/rentals': 'rentals',
    '/turo-bridge': 'rentals',
    '/quotes': 'rentals',
    '/pending-bookings': 'pending_bookings',
    '/blocked-dates': 'availability',
    '/vehicle-owners': 'vehicle_owners',
    '/owner-payouts': 'owner_payouts',
    '/customers': 'customers',
    '/blocked-customers': 'blocked_customers',
    '/enquiries': 'enquiries',
    '/leads': 'leads',
    '/automations': 'automations',
    '/messages': 'messages',
    '/payments': 'payments',
    '/invoices': 'invoices',
    '/fines': 'fines',
    '/expenses': 'expenses',
    '/insurances': 'insurances',
    '/agreements': 'agreements',
    '/reminders': 'reminders',
    '/reports': 'reports',
    '/insights': 'reports',
    '/integrations': 'settings.integrations',
    '/pl-dashboard': 'pl_dashboard',
    '/cms': 'cms',
    '/audit-logs': 'audit_logs',
    '/settings': 'settings',
    '/dev': 'dev',
};
export function getTabKeyForRoute(pathname) {
    if (ROUTE_TO_TAB[pathname])
        return ROUTE_TO_TAB[pathname];
    for (const [route, tabKey] of Object.entries(ROUTE_TO_TAB)) {
        if (pathname.startsWith(route + '/'))
            return tabKey;
    }
    return null;
}
export const ROUTE_ALSO_ALLOWED_BY = {
    '/integrations': ['settings.payments'],
};
export function getTabKeysForRoute(pathname) {
    const primary = getTabKeyForRoute(pathname);
    if (!primary)
        return [];
    const extras = Object.entries(ROUTE_ALSO_ALLOWED_BY)
        .filter(([route]) => pathname === route || pathname.startsWith(route + '/'))
        .flatMap(([, keys]) => keys);
    return [primary, ...extras.filter((k) => k !== primary)];
}
export const WIDGET_TAB_REQUIREMENTS = {
    ActionItems: 'payments',
    CalendarWidget: 'rentals',
    FleetOverview: 'vehicles',
    BonzahBalanceWidget: 'payments',
    AIInsightsPanel: 'rentals',
    RecentActivity: null,
    SetupHub: null,
    GoLiveBanner: null,
};
export const SETTINGS_VALUE_TO_KEY = {
    general: 'settings.general',
    locations: 'settings.locations',
    branding: 'settings.branding',
    rental: 'settings.rental',
    requirements: 'settings.rental',
    duration: 'settings.rental',
    lockbox: 'settings.rental',
    pricing: 'settings.pricing',
    fees: 'settings.rental',
    preauth: 'settings.rental',
    installments: 'settings.rental',
    payg: 'settings.rental',
    'auto-extend': 'settings.rental',
    promos: 'settings.rental',
    extras: 'settings.extras',
    payments: 'settings.payments',
    accounting: 'settings.accounting',
    reminders: 'settings.reminders',
    push: 'settings.reminders',
    notifications: 'settings.reminders',
    templates: 'settings.templates',
    integrations: 'settings.integrations',
    messaging: 'settings.integrations',
    insurance: 'settings.integrations',
    inshur: 'settings.integrations',
    esign: 'settings.integrations',
    tesla: 'settings.integrations',
    blacklist: 'settings.integrations',
    subscription: 'settings.subscription',
};
