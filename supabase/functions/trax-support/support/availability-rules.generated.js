// Generated from v2/apps/web/src/lib/vehicles/availability-rules.ts; do not edit.
export const OPEN_RENTAL_STATUSES = ['Pending', 'Active', 'Upcoming', 'Confirmed', 'Started'];
export const RELEASED_RENTAL_STATUSES = '(Cancelled,Rejected,Closed,Completed)';
export function applyCheckoutOverlap(query, start, end) {
    return query.not('status', 'in', '(Cancelled,Rejected,Closed)').lte('start_date', end).or(`end_date.gte.${start},end_date.is.null`);
}
export const OUT_NOW_STATUSES = new Set(['Active', 'Started']);
export function rentalOccupiesWindow(rental, reqStart, reqEnd, today) {
    const overlaps = rental.start_date <= reqEnd && (rental.end_date === null || rental.end_date >= reqStart);
    const stillOut = !!rental.status && OUT_NOW_STATUSES.has(rental.status) && rental.end_date !== null && rental.end_date < today;
    return overlaps || stillOut;
}
export function bufferOccupiesPickup(pickupAt, endedAt, bufferMinutes) {
    return pickupAt >= endedAt && pickupAt < endedAt + bufferMinutes * 60 * 1000;
}
export function durationTierForDays(days, monthlyTierDays) {
    if (days >= monthlyTierDays)
        return 'monthly';
    return days >= 7 ? 'weekly' : 'daily';
}
export const WEBSITE_STATUS_FILTER = 'status.ilike.available,status.ilike.rented';
export function applyWebsiteVisibility(query) {
    const q = query;
    return q.or(WEBSITE_STATUS_FILTER).eq('is_paused', false).not('show_on_website', 'is', false).not('is_disposed', 'is', true);
}
export function websiteVisibilityReasons(vehicle) {
    const reasons = [];
    if (!vehicle.status || !['available', 'rented'].includes(vehicle.status.toLowerCase()))
        reasons.push('vehicle_status');
    if (vehicle.is_paused !== false)
        reasons.push(vehicle.is_paused === true ? 'paused' : 'pause_state_missing');
    if (vehicle.show_on_website === false)
        reasons.push('website_hidden');
    if (vehicle.is_disposed === true)
        reasons.push('disposed');
    return reasons;
}
