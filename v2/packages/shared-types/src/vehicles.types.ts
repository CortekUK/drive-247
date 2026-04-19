import type { VehicleStatus } from './enums';

// --- Request payloads ---

export type CreateVehiclePayload = {
  reg: string;
  make: string;
  model: string;
  year: number;
  dailyRent: number;
  weeklyRent: number;
  monthlyRent: number;
  status?: VehicleStatus;
};

export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

export type VehicleListQuery = {
  search?: string;
  status?: VehicleStatus;
  page?: number;
  limit?: number;
};

// --- Response shapes ---

export type VehicleResponse = {
  id: string;
  tenantId: string;
  reg: string;
  make: string;
  model: string;
  year: number;
  dailyRent: string;
  weeklyRent: string;
  monthlyRent: string;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
};

export type VehicleListResponse = {
  items: VehicleResponse[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};
