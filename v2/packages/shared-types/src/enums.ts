export enum UserRole {
  HEAD_ADMIN = 'head_admin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  OPS = 'ops',
  VIEWER = 'viewer',
}

export enum PermissionAccessLevel {
  VIEWER = 'viewer',
  EDITOR = 'editor',
}

export enum TenantType {
  PRODUCTION = 'production',
  TEST = 'test',
}

export enum TenantStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}
