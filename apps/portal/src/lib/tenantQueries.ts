/**
 * Tenant-Aware Query Utilities
 *
 * This module provides utilities for making tenant-scoped database queries.
 * All queries automatically filter by the current tenant context.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

// Type helper for table names
type TableName = keyof Database['public']['Tables'];

// Type helper for table row
type TableRow<T extends TableName> = Database['public']['Tables'][T]['Row'];

/**
 * Create a tenant-scoped query builder
 * @param tableName - The name of the table to query
 * @param tenantId - The tenant ID to filter by
 * @returns A Supabase query builder with tenant filtering applied
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

/**
 * Insert a record with tenant_id automatically included
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 * @param data - The data to insert (tenant_id will be added automatically)
 */
export async function tenantInsert<T extends TableName>(
  tableName: T,
  tenantId: string,
  data: Omit<Database['public']['Tables'][T]['Insert'], 'tenant_id'> | Omit<Database['public']['Tables'][T]['Insert'], 'tenant_id'>[]
) {
  const dataWithTenant = Array.isArray(data)
    ? data.map(item => ({ ...item, tenant_id: tenantId }))
    : { ...data, tenant_id: tenantId };

  return supabase
    .from(tableName)
    .insert(dataWithTenant as any)
    .select();
}

/**
 * Update a record with tenant validation
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 * @param id - The record ID to update
 * @param data - The data to update
 */
export async function tenantUpdate<T extends TableName>(
  tableName: T,
  tenantId: string,
  id: string,
  data: Partial<Database['public']['Tables'][T]['Update']>
) {
  return supabase
    .from(tableName)
    .update(data as any)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select();
}

/**
 * Delete a record with tenant validation
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 * @param id - The record ID to delete
 */
export async function tenantDelete<T extends TableName>(
  tableName: T,
  tenantId: string,
  id: string
) {
  return supabase
    .from(tableName)
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);
}

/**
 * Get a single record by ID with tenant validation
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 * @param id - The record ID
 */
export async function tenantGetById<T extends TableName>(
  tableName: T,
  tenantId: string,
  id: string
) {
  return supabase
    .from(tableName)
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();
}

/**
 * Count records for a tenant
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID
 */
export async function tenantCount<T extends TableName>(
  tableName: T,
  tenantId: string
) {
  const { count, error } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  return { count, error };
}

/**
 * Custom hook-friendly query builder that throws on missing tenant
 * @param tableName - The name of the table
 * @param tenantId - The tenant ID (optional, will throw if not provided)
 */
export function useTenantQuery<T extends TableName>(
  tableName: T,
  tenantId: string | null | undefined
) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for tenant-scoped queries');
  }

  return tenantQuery(tableName, tenantId);
}
