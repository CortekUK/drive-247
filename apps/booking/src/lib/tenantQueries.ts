/**
 * Tenant-Aware Query Utilities for Drive917 Client
 *
 * This module provides utilities for making tenant-scoped database queries
 * in the customer-facing booking application.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

// Type helper for table names
type TableName = keyof Database['public']['Tables'];

/**
 * Create a tenant-scoped query builder for vehicles
 * @param tenantId - The tenant ID to filter by
 */
export function getTenantVehicles(tenantId: string) {
  return supabase
    .from('vehicles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'Available')
    .order('created_at', { ascending: false });
}

/**
 * Get a single vehicle by ID with tenant validation
 * @param tenantId - The tenant ID
 * @param vehicleId - The vehicle ID
 */
export function getTenantVehicleById(tenantId: string, vehicleId: string) {
  return supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .eq('tenant_id', tenantId)
    .single();
}

/**
 * Create a booking with tenant context
 * @param tenantId - The tenant ID
 * @param bookingData - The booking data
 */
export async function createTenantBooking(
  tenantId: string,
  bookingData: Omit<Database['public']['Tables']['rentals']['Insert'], 'tenant_id'>
) {
  return supabase
    .from('rentals')
    .insert({
      ...bookingData,
      tenant_id: tenantId,
    })
    .select()
    .single();
}

/**
 * Get tenant settings/configuration
 * @param tenantId - The tenant ID
 */
export function getTenantSettings(tenantId: string) {
  return supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .eq('status', 'active')
    .single();
}

/**
 * Get blocked dates for a tenant
 * @param tenantId - The tenant ID
 */
export function getTenantBlockedDates(tenantId: string) {
  return supabase
    .from('blocked_dates')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('end_date', new Date().toISOString());
}

/**
 * Check if a customer is blocked for a tenant
 * @param tenantId - The tenant ID
 * @param customerId - The customer ID
 */
export async function isCustomerBlocked(tenantId: string, customerId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('is_blocked, blocked_reason')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .single();

  return {
    isBlocked: data?.is_blocked ?? false,
    reason: data?.blocked_reason,
    error
  };
}

/**
 * Check if an identity (license number, ID number) is blocked for a tenant
 * @param tenantId - The tenant ID
 * @param identityNumber - The license number or ID number to check
 */
export async function isIdentityBlocked(tenantId: string, identityNumber: string) {
  if (!identityNumber || identityNumber.trim() === '') {
    return { isBlocked: false, reason: null, identityType: null, error: null };
  }

  const { data, error } = await supabase
    .from('blocked_identities')
    .select('reason, identity_type')
    .eq('tenant_id', tenantId)
    .eq('identity_number', identityNumber.trim())
    .eq('is_active', true)
    .in('identity_type', ['license', 'id_card', 'passport'])
    .maybeSingle();

  return {
    isBlocked: !!data,
    reason: data?.reason ?? null,
    identityType: data?.identity_type ?? null,
    error
  };
}

/**
 * Check if a customer can book (not blocked by customer record or identity)
 * @param tenantId - The tenant ID
 * @param customerEmail - Customer email to look up existing customer
 * @param licenseNumber - License number to check against blocked identities
 */
export async function canCustomerBook(
  tenantId: string,
  customerEmail: string,
  licenseNumber?: string
): Promise<{ canBook: boolean; reason: string | null }> {
  // Check if existing customer is blocked
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('id, is_blocked, blocked_reason')
    .eq('tenant_id', tenantId)
    .eq('email', customerEmail)
    .maybeSingle();

  if (existingCustomer?.is_blocked) {
    return {
      canBook: false,
      reason: existingCustomer.blocked_reason || 'Your account has been blocked. Please contact support.'
    };
  }

  // Check if license number is in blocked identities
  if (licenseNumber && licenseNumber.trim() !== '') {
    const identityCheck = await isIdentityBlocked(tenantId, licenseNumber);
    if (identityCheck.isBlocked) {
      return {
        canBook: false,
        reason: identityCheck.reason || 'This identity has been blocked. Please contact support.'
      };
    }
  }

  return { canBook: true, reason: null };
}

/**
 * Get tenant promotions
 * @param tenantId - The tenant ID
 */
export function getTenantPromotions(tenantId: string) {
  const now = new Date().toISOString();

  return supabase
    .from('promotions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('start_date', now)
    .gte('end_date', now);
}

/**
 * Get tenant testimonials for display
 * @param tenantId - The tenant ID
 */
export function getTenantTestimonials(tenantId: string) {
  return supabase
    .from('testimonials')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(10);
}

/**
 * Create a contact request for a tenant
 * @param tenantId - The tenant ID
 * @param contactData - The contact form data
 */
export async function createTenantContactRequest(
  tenantId: string,
  contactData: {
    name: string;
    email: string;
    phone?: string;
    message: string;
  }
) {
  return supabase
    .from('contact_requests')
    .insert({
      ...contactData,
      tenant_id: tenantId,
      status: 'pending',
    })
    .select()
    .single();
}

/**
 * Generic tenant-scoped query builder
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 */
export function tenantQuery<T extends TableName>(
  tableName: T,
  tenantId: string
) {
  return supabase
    .from(tableName)
    .select('*')
    .eq('tenant_id', tenantId);
}
