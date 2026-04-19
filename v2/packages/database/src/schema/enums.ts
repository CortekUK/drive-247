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

export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'active',
  'inactive',
]);

export const customerStatusEnum = pgEnum('customer_status', [
  'active',
  'inactive',
]);

export const rentalStatusEnum = pgEnum('rental_status', [
  'pending',
  'active',
  'completed',
  'cancelled',
]);

export const rentalPeriodTypeEnum = pgEnum('rental_period_type', [
  'daily',
  'weekly',
  'monthly',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'partially_paid',
  'paid',
  'overdue',
  'void',
  'refunded',
]);

export const discountTypeEnum = pgEnum('discount_type', [
  'percentage',
  'fixed',
]);

export const paymentTypeEnum = pgEnum('payment_type', [
  'payment',
  'refund',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'bank_transfer',
]);

export const paymentGatewayEnum = pgEnum('payment_gateway', [
  'manual',
  'stripe',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'succeeded',
  'failed',
  'refunded',
]);

export const bonzahModeEnum = pgEnum('bonzah_mode', ['test', 'live']);

export const bonzahPolicyStatusEnum = pgEnum('bonzah_policy_status', [
  'quoted',
  'payment_pending',
  'active',
  'cancelled',
  'failed',
  'insufficient_balance',
]);

export const insuranceStatusEnum = pgEnum('insurance_status', [
  'pending',
  'bonzah',
  'external',
  'not_required',
]);

export const reminderSeverityEnum = pgEnum('reminder_severity', [
  'info',
  'warning',
  'critical',
]);

export const coverageTierEnum = pgEnum('coverage_tier', [
  'cdw',
  'rcli',
  'sli',
  'pai',
]);

export const idVerificationStatusEnum = pgEnum('id_verification_status', [
  'initiated',
  'in_progress',
  'processing',
  'approved',
  'rejected',
  'review_required',
  'expired',
  'cancelled',
]);

export const idVerificationDecisionSourceEnum = pgEnum(
  'id_verification_decision_source',
  ['auto', 'manual'],
);

export const blockedIdentityTypeEnum = pgEnum('blocked_identity_type', [
  'driving_license',
  'passport',
  'id_card',
  'email',
]);

export const requiredDocumentTypeEnum = pgEnum('required_document_type', [
  'driving_license',
  'passport',
  'id_card',
]);
