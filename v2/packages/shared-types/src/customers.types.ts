import type { CustomerStatus, IdVerificationStatus } from './enums';

// --- Request payloads ---

export type CreateCustomerPayload = {
  name: string;
  email?: string | null;
  phone?: string | null;
  status?: CustomerStatus;
};

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export type CustomerListQuery = {
  search?: string;
  status?: CustomerStatus;
  page?: number;
  limit?: number;
};

// --- Response shapes ---

export type CustomerResponse = {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  // Denormalized from id_verifications — reflects latest verification result.
  // null when the customer has never been verified.
  identityVerificationStatus: IdVerificationStatus | null;
  latestVerificationId: string | null;
  createdAt: string;
  updatedAt: string;
};

// List row includes calculated outstanding balance (in cents)
export type CustomerListItem = CustomerResponse & {
  outstandingBalance: number;
};

export type CustomerListResponse = {
  items: CustomerListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};

export type CustomerFinancialsResponse = {
  totalInvoiced: number;   // cents — SUM(total_amount) non-void
  totalPaid: number;       // cents — SUM(amount_paid) non-void
  outstanding: number;     // cents — SUM(amount_due) non-void-non-refunded
  lastPaymentAt: string | null;
};
