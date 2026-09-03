/**
 * One place that decides what a CUSTOMER may learn about a vehicle.
 *
 * Two separate problems live here, and they are easy to confuse:
 *
 * 1. WHAT WE SERVE. Public vehicle queries were `select('*')` on a table with
 *    RLS disabled and a table-level SELECT grant to `anon`. RLS filters rows,
 *    never columns — so every one of the 70 columns reached the browser,
 *    including `lockbox_code` and `lockbox_instructions` (the key-safe code and
 *    where the safe is hidden), `purchase_price`, `monthly_payment`,
 *    `security_notes`, `spare_key_holder` and `owner_id`. Anyone holding the
 *    public anon key — which ships inside every booking site's JS bundle —
 *    could read them directly. VEHICLE_PUBLIC_COLUMNS is an allowlist so a new
 *    column is private by default rather than published by default.
 *
 * 2. WHAT WE SHOW. A tenant can switch on `hide_vehicle_registration` to keep
 *    plates off their public site. That is a display preference, NOT the
 *    security boundary above — `vehicles.reg` is NOT NULL and globally unique,
 *    so it can never be blanked in storage; it is only ever withheld.
 *
 * Because there is no shared vehicle-name helper in this app, the plate had
 * leaked into ~77 places. Route new display code through here rather than
 * inlining `${make} ${model}` again.
 */

/** A tenant-shaped object; only the flag matters, so callers can pass any tenant. */
type TenantLike = { hide_vehicle_registration?: boolean | null } | null | undefined;

export type VehicleIdentity = {
  make?: string | null;
  model?: string | null;
  reg?: string | null;
  year?: number | string | null;
  colour?: string | null;
  color?: string | null;
};

/**
 * True when this tenant has asked us to keep plates away from customers.
 *
 * Defaults to SHOWING the plate: the column is `NOT NULL DEFAULT false`, and a
 * tenant that has never touched the setting must keep the behaviour they
 * already had. Deliberately `=== true` rather than truthy — the flag arrives
 * over PostgREST and a stray string would otherwise silently enable it.
 */
export function isRegistrationHidden(tenant: TenantLike): boolean {
  return tenant?.hide_vehicle_registration === true;
}

/**
 * May we reveal the plate *right now*?
 *
 * Distinct from `!isRegistrationHidden()`, and the distinction is the whole
 * point. TenantContext starts as `null` and fills in after an async round-trip,
 * so "the tenant has not opted in" and "we do not yet know what the tenant
 * wants" are different states that a plain `=== true` check collapses into one.
 * Collapsing them fails OPEN on a privacy control: the pages that query on
 * mount would serve the plate during that window, which for a `useEffect(…, [])`
 * that never re-runs means always.
 *
 * So: reveal only when we have a resolved tenant that permits it. Unknown means
 * withhold. Callers must therefore wait for the tenant before querying, or a
 * plate-showing tenant would never get its plates back.
 */
export function canRevealRegistration(tenant: TenantLike): boolean {
  if (!tenant) return false;
  return !isRegistrationHidden(tenant);
}

/**
 * Columns a customer-facing vehicle query may read.
 *
 * `reg` is appended only when the tenant permits it, so a hidden plate is never
 * sent to the browser at all — not merely hidden with CSS or skipped in JSX.
 * `vin` is NEVER here: no customer surface displays it, and it is the identity
 * key insurance and registration systems bind against.
 *
 * Anything absent is absent on purpose. Before adding one, ask whether a
 * stranger reading it would harm the operator — see the lockbox note above.
 */
const VEHICLE_PUBLIC_COLUMN_LIST = [
  'id',
  'tenant_id',
  'make',
  'model',
  'year',
  'colour',
  'color',
  'category',
  'description',
  'fuel_type',
  'status',
  'photo_url',
  'is_disposed',
  // Operator has taken this vehicle off the road (repair etc). Every public
  // surface must exclude it. The operator's private note lives in
  // `paused_reason` and is deliberately NOT in this allowlist.
  'is_paused',
  'pickup_location_id',
  'tesla_fleet_enabled',
  // Pricing the customer is being quoted
  'daily_rent',
  'weekly_rent',
  'monthly_rent',
  'security_deposit',
  'excess_mileage_rate',
  'daily_mileage',
  'weekly_mileage',
  'monthly_mileage',
  'unlimited_mileage_available',
  'unlimited_mileage_price_daily',
  'unlimited_mileage_price_weekly',
  'unlimited_mileage_price_monthly',
  // Which durations this vehicle can be booked for
  'available_daily',
  'available_weekly',
  'available_monthly',
] as const;

/**
 * Build the select list for a customer-facing vehicle query.
 *
 * @param tenant  the tenant whose site is being browsed
 * @param extra   related-table selections, e.g. 'vehicle_photos(photo_url, display_order)'
 */
export function vehiclePublicColumns(tenant: TenantLike, ...extra: string[]): string {
  const columns: string[] = [...VEHICLE_PUBLIC_COLUMN_LIST];
  if (canRevealRegistration(tenant)) {
    columns.push('reg');
  }
  return [...columns, ...extra.filter(Boolean)].join(', ');
}

/** The same allowlist for callers that need it nested, e.g. `vehicles:vehicle_id (…)`. */
export function vehiclePublicColumnsNested(tenant: TenantLike, alias: string): string {
  return `${alias} (${vehiclePublicColumns(tenant)})`;
}

/**
 * The plate to render, or null when it must not be shown.
 *
 * Callers should treat null as "omit the element entirely" rather than
 * rendering an empty chip or a dangling "Reg:" label.
 */
export function displayRegistration(
  vehicle: VehicleIdentity | null | undefined,
  tenant: TenantLike,
): string | null {
  if (!vehicle?.reg) return null;
  if (!canRevealRegistration(tenant)) return null;
  return vehicle.reg;
}

/**
 * A customer-safe name for a vehicle.
 *
 * The subtle bug this exists to prevent: many screens used the plate as the
 * FALLBACK when make/model were blank. Suppressing the plate without fixing
 * those turns a vehicle heading into an empty string — the customer loses the
 * name of the car they are booking. So the fallback chain never ends at the
 * plate for a tenant who hides it; it ends at a neutral word.
 */
export function vehicleDisplayName(
  vehicle: VehicleIdentity | null | undefined,
  tenant: TenantLike,
  fallback = 'Vehicle',
): string {
  const name = [vehicle?.make, vehicle?.model]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();

  if (name) return name;

  const plate = displayRegistration(vehicle, tenant);
  if (plate) return plate;

  return fallback;
}

/**
 * Name plus plate for summaries — "BMW X5 (AB12 XYZ)", or just "BMW X5" when
 * the plate is withheld. Never leaves empty brackets behind.
 */
export function vehicleDisplayLabel(
  vehicle: VehicleIdentity | null | undefined,
  tenant: TenantLike,
  fallback = 'Vehicle',
): string {
  const name = vehicleDisplayName(vehicle, tenant, fallback);
  const plate = displayRegistration(vehicle, tenant);
  return plate && plate !== name ? `${name} (${plate})` : name;
}

/**
 * Should a customer-facing search match against the plate?
 *
 * A hidden field that is still searchable is not hidden: typing a plate into
 * the fleet search and watching one car appear confirms that car's plate. Both
 * customer search boxes must consult this.
 */
export function canSearchByRegistration(tenant: TenantLike): boolean {
  return canRevealRegistration(tenant);
}

/* ────────────────────────── vehicle photos ──────────────────────────
 * The plate can also be legible INSIDE a photo, which no text rule can fix.
 * The operator marks photos one at a time from the vehicle page; this is the
 * serving half of that.
 */

/** Sub-select for a customer-facing vehicle_photos join. */
export const VEHICLE_PHOTO_COLUMNS =
  'vehicle_photos ( photo_url, redacted_url, redaction_status, display_order )';

export type VehiclePhoto = {
  photo_url?: string | null;
  redacted_url?: string | null;
  redaction_status?: string | null;
};

/**
 * Which image a CUSTOMER should see.
 *
 * Deliberately NOT deny-by-default, and the reason matters. The operator
 * reviews photos one at a time, so `none` means "not looked at yet", not
 * "unsafe" — and blanking a whole gallery the moment someone flips the text
 * toggle would be a worse surprise than the thing it guards against. Most
 * fleet photos contain no plate at all: of the eight real ones measured on this
 * platform, none did.
 *
 * So: a photo the operator has redacted serves the redacted copy; everything
 * else serves the original. What makes that honest is the UI — the button is
 * per photo, and the operator is the one asserting a photo is fine.
 *
 * Staff never call this; apps/portal always shows the original.
 */
export function customerPhotoUrl(
  photo: VehiclePhoto | null | undefined,
  tenant: TenantLike,
): string | null {
  if (!photo) return null;
  if (isRegistrationHidden(tenant) && photo.redaction_status === 'redacted' && photo.redacted_url) {
    return photo.redacted_url;
  }
  return photo.photo_url ?? null;
}

/** True when this tenant may use the per-photo plate-blurring controls. */
export function canRedactPhotos(tenant: TenantLike): boolean {
  return isRegistrationHidden(tenant);
}
