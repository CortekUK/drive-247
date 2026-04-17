import type { UserListItem } from './users.types';

// --- Request payloads ---

export type CreateTenantPayload = {
  companyName: string;
  slug: string;
  contactEmail: string;
  adminName?: string;
  tenantType?: 'production' | 'test';
  adminEmail: string;
  adminPassword?: string;
};

export type UpdateTenantPayload = {
  companyName?: string;
  slug?: string;
  contactEmail?: string;
  contactPhone?: string | null;
  adminName?: string | null;
  status?: 'active' | 'inactive' | 'suspended';
};

// --- Response shapes ---

export type TenantListItem = {
  id: string;
  slug: string;
  companyName: string;
  contactEmail: string | null;
  adminName: string | null;
  tenantType: string;
  status: string;
  staffCount: number;
  createdAt: string;
};

export type TenantDetail = {
  id: string;
  slug: string;
  companyName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  adminName: string | null;
  tenantType: string;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  users: UserListItem[];
};

export type TenantStats = {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  production: number;
  test: number;
  totalUsers: number;
};

export type CreateTenantResponse = {
  tenant: TenantListItem;
  admin: {
    email: string;
    password: string;
  };
  portalUrl: string;
};
