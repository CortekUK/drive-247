import type { RentalPeriodType, RentalStatus } from './enums';

// --- Request payloads ---

export type CreateRentalPayload = {
  customerId: string;
  vehicleId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  endDate: string;
  periodType: RentalPeriodType;
  totalAmount: number;
  status?: RentalStatus;
};

export type UpdateRentalPayload = Partial<
  Pick<
    CreateRentalPayload,
    'startDate' | 'endDate' | 'periodType' | 'totalAmount'
  >
>;

export type TransitionRentalPayload = {
  status: Exclude<RentalStatus, RentalStatus.PENDING>;
};

export type RentalListQuery = {
  search?: string;
  status?: RentalStatus;
  customerId?: string;
  vehicleId?: string;
  page?: number;
  limit?: number;
};

// --- Response shapes ---

export type RentalCustomerRef = {
  id: string;
  name: string;
  email: string | null;
};

export type RentalVehicleRef = {
  id: string;
  reg: string;
  make: string;
  model: string;
};

export type RentalListItem = {
  id: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  periodType: RentalPeriodType;
  totalAmount: string;
  status: RentalStatus;
  createdAt: string;
  updatedAt: string;
  customer: RentalCustomerRef;
  vehicle: RentalVehicleRef;
};

export type RentalDetail = RentalListItem;

export type RentalListResponse = {
  items: RentalListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};
