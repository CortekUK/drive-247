// Generated from apps/portal/src/lib/v2.ts; checked by scripts/trax-knowledge.mjs.
export const NORTHWIND = 'northwind';
const V2_AREAS = {
    appearance: [NORTHWIND],
    theme: [NORTHWIND],
    dashboard: [NORTHWIND],
    chrome: [NORTHWIND],
    login: [NORTHWIND],
    rentals: [NORTHWIND],
    customers: [NORTHWIND],
    cms: [NORTHWIND],
    vehicles: [NORTHWIND],
    insights: [NORTHWIND],
    availability: [NORTHWIND],
    turo: [NORTHWIND],
    agreements: [NORTHWIND],
};
export const V2_AREA_LIST = Object.keys(V2_AREAS);
const V2_EXPERIENCE = 'v2';
export function isV2Experience(portalExperience) {
    return portalExperience === V2_EXPERIENCE;
}
export function isV2(area, tenantSlug, onV2 = false) {
    if (!tenantSlug)
        return false;
    if (onV2)
        return true;
    return V2_AREAS[area]?.includes(tenantSlug) ?? false;
}
