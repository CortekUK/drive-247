import { SetMetadata } from '@nestjs/common';

export const REQUIRE_TENANT_KEY = 'require_tenant';

export interface RequireTenantOptions {
  /**
   * Where to read the tenant ID from on the incoming request.
   * - 'param:<name>'  — URL route param (e.g. 'param:tenantId')
   * - 'query:<name>'  — query string (e.g. 'query:tenantId')
   * - 'body:<name>'   — request body (e.g. 'body:tenantId')
   * - 'user'          — the authenticated user's own tenantId (default)
   */
  from?: `param:${string}` | `query:${string}` | `body:${string}` | 'user';
}

/**
 * Marks a route as tenant-scoped. The TenantGuard will verify that the
 * authenticated user is allowed to operate on the tenant identified by the
 * resolved tenant ID. Super admins bypass all checks.
 */
export const RequireTenant = (options: RequireTenantOptions = {}) =>
  SetMetadata(REQUIRE_TENANT_KEY, { from: options.from ?? 'user' });
