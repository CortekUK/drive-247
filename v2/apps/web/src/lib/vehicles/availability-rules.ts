/** Pure rules shared by V2 fleet browsing and TRAX's generated, parity-checked
 * server artifact. No database, pricing, checkout writes or customer data. */
export const OPEN_RENTAL_STATUSES = ['Pending', 'Active', 'Upcoming', 'Confirmed', 'Started'] as const;
export const RELEASED_RENTAL_STATUSES = '(Cancelled,Rejected,Closed,Completed)';
interface ClashFilters { not(column: string, op: string, value: string): ClashFilters; lte(column: string, value: string): ClashFilters; or(value: string): ClashFilters }
/** The V2 checkout courtesy precheck, distinct from the fleet date filter. */
export function applyCheckoutOverlap<T>(query: T, start: string, end: string): T {
  return (query as unknown as ClashFilters).not('status', 'in', '(Cancelled,Rejected,Closed)').lte('start_date', end).or(`end_date.gte.${start},end_date.is.null`) as unknown as T;
}
export const OUT_NOW_STATUSES = new Set(['Active', 'Started']);
export interface OccupancyRental { vehicle_id?: string | null; status?: string | null; start_date: string; end_date: string | null }
export function rentalOccupiesWindow(rental: OccupancyRental, reqStart: string, reqEnd: string, today: string): boolean {
  const overlaps = rental.start_date <= reqEnd && (rental.end_date === null || rental.end_date >= reqStart);
  const stillOut = !!rental.status && OUT_NOW_STATUSES.has(rental.status) && rental.end_date !== null && rental.end_date < today;
  return overlaps || stillOut;
}
export function bufferOccupiesPickup(pickupAt: number, endedAt: number, bufferMinutes: number): boolean {
  return pickupAt >= endedAt && pickupAt < endedAt + bufferMinutes * 60 * 1000;
}
export function durationTierForDays(days: number, monthlyTierDays: number): 'daily' | 'weekly' | 'monthly' {
  if (days >= monthlyTierDays) return 'monthly';
  return days >= 7 ? 'weekly' : 'daily';
}
export const WEBSITE_STATUS_FILTER = 'status.ilike.available,status.ilike.rented';
interface Filters { or(value: string): Filters; eq(column: string, value: boolean): Filters; not(column: string, op: string, value: boolean): Filters }
/** Preserve the caller's SDK builder type without importing the SDK at runtime. */
export function applyWebsiteVisibility<T>(query: T): T {
  const q = query as unknown as Filters;
  return q.or(WEBSITE_STATUS_FILTER).eq('is_paused', false).not('show_on_website', 'is', false).not('is_disposed', 'is', true) as unknown as T;
}
export interface WebsiteVehicle { status: string | null; is_paused: boolean | null; show_on_website: boolean | null; is_disposed: boolean | null }
/** Reasons corresponding to the exact query above; nullable flags intentionally
 * have different SQL semantics. Do not collapse null to false for is_paused. */
export function websiteVisibilityReasons(vehicle: WebsiteVehicle): string[] {
  const reasons: string[] = [];
  if (!vehicle.status || !['available', 'rented'].includes(vehicle.status.toLowerCase())) reasons.push('vehicle_status');
  if (vehicle.is_paused !== false) reasons.push(vehicle.is_paused === true ? 'paused' : 'pause_state_missing');
  if (vehicle.show_on_website === false) reasons.push('website_hidden');
  if (vehicle.is_disposed === true) reasons.push('disposed');
  return reasons;
}
