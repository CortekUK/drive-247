import type { UserRole, PermissionAccessLevel } from './enums';

// --- Request payloads ---

export type CreateUserPayload = {
  email: string;
  name: string;
  role: UserRole | string;
  password: string;
  permissions?: ManagerPermissionInput[];
};

export type UpdateRolePayload = {
  role: UserRole | string;
  permissions?: ManagerPermissionInput[];
};

export type ManagerPermissionInput = {
  tabKey: string;
  accessLevel: PermissionAccessLevel | string;
};

// --- Response shapes ---

export type UserListItem = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

export type UserDetail = UserListItem & {
  permissions: {
    id: string;
    tabKey: string;
    accessLevel: string;
  }[];
};

export type CreateUserResponse = {
  id: string;
  email: string;
  role: string;
};
