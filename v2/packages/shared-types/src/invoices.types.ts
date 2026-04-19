import type { DiscountType, InvoiceStatus } from './enums';
import type { PaymentResponse } from './payments.types';

// --- Request payloads ---

export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unitPrice: number; // cents
  discountType?: DiscountType | null;
  discountValue?: number | null;
};

export type CreateInvoicePayload = {
  customerId: string;
  rentalId?: string | null;
  dueDate: string; // ISO date
  notes?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  items: InvoiceItemInput[]; // at least 1 required
};

export type UpdateInvoicePayload = {
  dueDate?: string;
  notes?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
};

export type CreateInvoiceItemPayload = InvoiceItemInput;
export type UpdateInvoiceItemPayload = Partial<InvoiceItemInput>;

export type InvoiceListQuery = {
  search?: string;
  status?: InvoiceStatus;
  customerId?: string;
  rentalId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

// --- Response shapes ---

export type InvoiceCustomerRef = {
  id: string;
  name: string;
  email: string | null;
};

export type InvoiceRentalRef = {
  id: string;
  startDate: string;
  endDate: string;
};

export type InvoiceItemResponse = {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  lineTotal: number;
  createdAt: string;
};

export type InvoiceListItem = {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  discountAmount: number;
  taxRate: string;
  taxLabel: string;
  taxInclusive: boolean;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  customer: InvoiceCustomerRef;
  rental: InvoiceRentalRef | null;
};

export type InvoiceDetail = InvoiceListItem & {
  discountType: DiscountType | null;
  discountValue: number | null;
  notes: string | null;
  items: InvoiceItemResponse[];
  payments: PaymentResponse[];
};

export type InvoiceListResponse = {
  items: InvoiceListItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
};
