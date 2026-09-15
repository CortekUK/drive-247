// Generated from apps/portal/src/lib/lean-areas.ts; checked by scripts/trax-knowledge.mjs.
const LEAN_TENANTS = ['northwind'];
export const LEAN_HIDDEN_AREAS = [
    'enquiries',
    'leads',
    'automations',
    'quotes',
    'tesla',
    'welcome',
    'owners',
    'expenses',
    'accounting',
    'fleet-health',
    'cmd',
    'inshur',
    'tenant-health',
    'settings-payments',
    'settings-messaging',
    'settings-insurance',
    'settings-esign',
    'reports',
    'pl-dashboard',
    'reminders',
];
export function isAreaHidden(area, tenantSlug) {
    if (!tenantSlug)
        return false;
    if (!LEAN_HIDDEN_AREAS.includes(area))
        return false;
    return isLeanTenant(tenantSlug);
}
export function isLeanTenant(tenantSlug) {
    if (!tenantSlug)
        return false;
    return LEAN_TENANTS.includes(tenantSlug);
}
export function resolveBoldSignMode(tenantMode, tenantSlug) {
    if (isLeanTenant(tenantSlug))
        return 'live';
    return tenantMode === 'live' ? 'live' : 'test';
}
export function isTestModeUiHidden(tenantSlug) {
    return isLeanTenant(tenantSlug);
}
const SETTINGS_TAB_AREAS = {
    payments: 'settings-payments',
    messaging: 'settings-messaging',
    insurance: 'settings-insurance',
    esign: 'settings-esign',
    accounting: 'accounting',
    inshur: 'inshur',
    tesla: 'tesla',
};
export function isSettingsTabHidden(tabValue, tenantSlug) {
    const area = SETTINGS_TAB_AREAS[tabValue];
    if (!area)
        return false;
    return isAreaHidden(area, tenantSlug);
}
export const SETTINGS_TAB_BOARD_ROUTE = '/integrations';
export function settingsTabBoardCard(tabValue) {
    switch (tabValue) {
        case 'payments':
            return '';
        case 'messaging':
            return 'Twilio Messages';
        case 'esign':
            return 'BoldSign';
        case 'tesla':
            return 'Tesla';
        default:
            return null;
    }
}
