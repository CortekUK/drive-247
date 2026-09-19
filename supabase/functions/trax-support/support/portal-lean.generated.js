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
export function isAreaHiddenForLean(area, lean) {
    if (!lean)
        return false;
    return LEAN_HIDDEN_AREAS.includes(area);
}
export function isAreaHidden(area, tenantSlug, onV2 = false) {
    return isAreaHiddenForLean(area, isLeanTenant(tenantSlug, onV2));
}
export function isLeanTenant(tenantSlug, onV2 = false) {
    if (!tenantSlug)
        return false;
    if (onV2)
        return true;
    return LEAN_TENANTS.includes(tenantSlug);
}
export function resolveBoldSignMode(tenantMode, tenantSlug, onV2 = false) {
    return resolveBoldSignModeForLean(tenantMode, isLeanTenant(tenantSlug, onV2));
}
export function resolveBoldSignModeForLean(tenantMode, lean) {
    if (lean)
        return 'live';
    return tenantMode === 'live' ? 'live' : 'test';
}
export function isTestModeUiHidden(tenantSlug, onV2 = false) {
    return isLeanTenant(tenantSlug, onV2);
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
export function isSettingsTabHidden(tabValue, tenantSlug, onV2 = false) {
    return isSettingsTabHiddenForLean(tabValue, isLeanTenant(tenantSlug, onV2));
}
export function isSettingsTabHiddenForLean(tabValue, lean) {
    const area = SETTINGS_TAB_AREAS[tabValue];
    if (!area)
        return false;
    return isAreaHiddenForLean(area, lean);
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
