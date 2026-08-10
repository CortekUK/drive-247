/**
 * Server-side counterpart to apps/booking/src/lib/vehicle-identity.ts.
 *
 * The client had one chokepoint and the server had none, which is why the plate
 * kept reappearing in edge functions: `_shared/email-template-service.ts` covers
 * the ~17 functions that render through it, but three PAYG senders are FORKS of
 * that renderer with the guard absent, and several others compose the plate into
 * a `vehicleName` string that a `vehicle_reg` guard is structurally blind to.
 *
 * Use `hidePlateForTenant()` wherever a vehicle string is COMPOSED, not where it
 * is rendered — composition is the last point at which one call covers every
 * downstream branch, including a tenant's own saved template.
 */

/**
 * Does this tenant keep plates away from their customers?
 *
 * FAILS CLOSED. If the flag cannot be read we withhold, because the alternative
 * — reverting to "show" whenever a lookup blips — makes the control unreliable
 * in exactly the situation where it is load-bearing. Same rule as
 * canRevealRegistration() on the client and the catch path in
 * email-template-service.ts.
 *
 * Also tolerates the column being absent: this file is shared across Supabase
 * projects and staging is behind production's schema. A missing column is a
 * schema gap, not a privacy request, so that specific case returns false.
 */
export async function hidePlateForTenant(
  supabaseClient: any,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('hide_vehicle_registration')
      .eq('id', tenantId)
      .single();

    if (error) {
      // 42703 = undefined_column. The project simply predates the feature, so
      // no tenant on it can have opted in.
      if (error.code === '42703' || /column .* does not exist/i.test(error.message || '')) {
        return false;
      }
      console.warn('[vehicle-privacy] Flag unreadable; withholding the plate:', error.message);
      return true;
    }
    return data?.hide_vehicle_registration === true;
  } catch (e) {
    console.warn('[vehicle-privacy] Flag lookup threw; withholding the plate:', e);
    return true;
  }
}

/** The plate to use, or '' when it must be withheld. */
export function plateOrBlank(reg: string | null | undefined, hidden: boolean): string {
  return hidden ? '' : (reg || '');
}

/**
 * "BMW X5 (AB12 XYZ)", or "BMW X5" when withheld — never "BMW X5 ()".
 *
 * The empty-bracket case is the one that actually shipped to customers on the
 * checkout and invoice before it was caught, so it is handled here rather than
 * left to each caller to remember.
 */
export function vehicleLabel(
  vehicle: { make?: string | null; model?: string | null; reg?: string | null } | null | undefined,
  hidden: boolean,
  fallback = 'Vehicle',
): string {
  const name = [vehicle?.make, vehicle?.model]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  const plate = plateOrBlank(vehicle?.reg, hidden);
  if (!name) return plate || fallback;
  return plate ? `${name} (${plate})` : name;
}
