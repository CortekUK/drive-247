import type {
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from './enums';

// --- Request payloads ---

export type RecordPaymentPayload = {
  amount: number; // cents, positive
  paymentMethod: PaymentMethod;
  paidAt?: string; // ISO datetime, defaults to now
  notes?: string | null;
};

export type RefundPaymentPayload = {
  amount: number; // cents, positive (service negates)
  notes?: string | null;
};

// --- Response shapes ---

export type PaymentResponse = {
  id: string;
  invoiceId: string;
  type: PaymentType;
  amount: number; // cents (negative for refunds)
  paymentMethod: PaymentMethod;
  paymentGateway: PaymentGateway;
  gatewayTransactionId: string | null;
  linkedPaymentId: string | null;
  status: PaymentStatus;
  notes: string | null;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
};
