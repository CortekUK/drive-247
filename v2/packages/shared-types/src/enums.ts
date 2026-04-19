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

export enum VehicleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum RentalStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum RentalPeriodType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
  OVERDUE = 'overdue',
  VOID = 'void',
  REFUNDED = 'refunded',
}

export enum DiscountType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export enum PaymentType {
  PAYMENT = 'payment',
  REFUND = 'refund',
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
}

export enum PaymentGateway {
  MANUAL = 'manual',
  STRIPE = 'stripe',
}

export enum PaymentStatus {
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum BonzahMode {
  TEST = 'test',
  LIVE = 'live',
}

export enum BonzahPolicyStatus {
  QUOTED = 'quoted',
  PAYMENT_PENDING = 'payment_pending',
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  INSUFFICIENT_BALANCE = 'insufficient_balance',
}

export enum InsuranceStatus {
  PENDING = 'pending',
  BONZAH = 'bonzah',
  EXTERNAL = 'external',
  NOT_REQUIRED = 'not_required',
}

export enum ReminderSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum CoverageTier {
  CDW = 'cdw',
  RCLI = 'rcli',
  SLI = 'sli',
  PAI = 'pai',
}

export enum IdVerificationStatus {
  INITIATED = 'initiated',
  IN_PROGRESS = 'in_progress',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVIEW_REQUIRED = 'review_required',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum IdVerificationDecisionSource {
  AUTO = 'auto',
  MANUAL = 'manual',
}

export enum BlockedIdentityType {
  DRIVING_LICENSE = 'driving_license',
  PASSPORT = 'passport',
  ID_CARD = 'id_card',
  EMAIL = 'email',
}

export enum RequiredDocumentType {
  DRIVING_LICENSE = 'driving_license',
  PASSPORT = 'passport',
  ID_CARD = 'id_card',
}
