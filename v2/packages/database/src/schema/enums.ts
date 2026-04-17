import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'head_admin',
  'admin',
  'manager',
  'ops',
  'viewer',
]);

export const permissionAccessLevelEnum = pgEnum('permission_access_level', [
  'viewer',
  'editor',
]);

export const tenantTypeEnum = pgEnum('tenant_type', [
  'production',
  'test',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active',
  'inactive',
  'suspended',
]);
